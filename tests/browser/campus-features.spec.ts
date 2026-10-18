import { test, expect } from '@playwright/test';

const fixture=`
export const configured=true, TERMS_VERSION='2026-10-17';
export const friendlyError=e=>e?.message||'Test error';
const userId='feature-student';
const rooms=[
 {id:'room-college',name:'College General',description:'Meet students from every department.',topic:'college',capacity:20,member_count:4,last_message:'Anyone at the tech fest?',last_message_at:new Date().toISOString()},
 {id:'room-cse',name:'CSE Students',description:'Projects, coding, labs, and campus life.',topic:'department',capacity:20,member_count:2,last_message:null,last_message_at:null},
 {id:'room-music',name:'Music & Mood',description:'Songs, artists, and what is on repeat.',topic:'music',capacity:20,member_count:0,last_message:null,last_message_at:null}
];
let admin=!!window.__eventAdmin;
let events=window.__eventSeed||[];
let colleges=window.__collegeSeed||[{id:'college-mkce',name:'MKCE',is_active:true}];
let collegeRequests=window.__collegeRequestSeed||[{id:'college-request-1',name:'Example College',status:'pending',created_at:new Date().toISOString()}];
window.setEventAdmin=value=>{admin=value};
export async function rpc(name,args={}){
 if(name==='st_begin')return {state:'idle',session:null};
 if(name==='cm_list_colleges')return colleges.filter(college=>college.is_active!==false);
 if(name==='cm_request_college'){window.__requestedCollege=args.p_name;return 'pending';}
 if(name==='cm_set_my_college'){return (colleges.find(college=>college.id===args.p_college_id)||colleges[0]).name;}
 if(name==='cm_admin_colleges'){if(!admin)throw Error('Admin access required.');return colleges.map(college=>({...college}));}
 if(name==='cm_admin_college_requests'){if(!admin)throw Error('Admin access required.');return collegeRequests.map(request=>({...request}));}
 if(name==='cm_admin_add_college'){if(!admin)throw Error('Admin access required.');const college={id:'college-'+(colleges.length+1),name:args.p_name,is_active:true};colleges.push(college);return [college];}
 if(name==='cm_review_college_request'){if(!admin)throw Error('Admin access required.');const request=collegeRequests.find(item=>item.id===args.p_request_id);request.status=args.p_status;if(args.p_status==='approved')colleges.push({id:'college-approved',name:request.name,is_active:true});return true;}
 if(name==='gc_list')return rooms;
 if(name==='ce_is_admin')return admin;
 if(name==='ce_list')return events.filter(event=>event.status==='approved');
 if(name==='ce_my_events')return events.filter(event=>event.submitted_by===userId);
 if(name==='ce_admin_events'){if(!admin)throw Error('Admin access required.');return events.map(event=>({...event}))}
 if(name==='ce_submit'){
  const event={id:'event-'+(events.length+1),submitted_by:userId,title:args.p_title,organizer:args.p_organizer,category:args.p_category,event_date:args.p_event_date,start_time:args.p_start_time,end_time:args.p_end_time,venue:args.p_venue,description:args.p_description,registration_url:args.p_registration_url,poster_path:args.p_poster_path,audience:args.p_audience,college_id:args.p_audience==='intra_college'?'college-mkce':null,status:'pending',review_note:null,created_at:new Date().toISOString()};events.push(event);return event;
 }
 if(name==='ce_review'){const event=events.find(item=>item.id===args.p_event_id);event.status=args.p_status;event.review_note=args.p_note;return event;}
 return {state:'idle',session:null};
}
export const db={
 auth:{getSession:async()=>({data:{session:{user:{id:userId}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
 storage:{from:()=>({upload:async()=>({data:{path:'uploaded'},error:null}),remove:async()=>({data:[],error:null}),createSignedUrl:async path=>({data:{signedUrl:'/mock-poster.png?'+path},error:null})})},
 channel:()=>({on(){return this},subscribe(){return this}}),removeChannel:async()=>{}
};`;

async function enterGuestDashboard(page){
 await page.route('**/src/lib.ts*',route=>route.fulfill({contentType:'application/javascript',body:fixture}));
 await page.goto('/');await page.getByRole('button',{name:'Skip'}).click();
 await page.getByRole('checkbox').nth(0).check();await page.getByRole('checkbox').nth(1).check();
 await page.getByRole('button',{name:'Continue as Guest'}).click();await expect(page.getByRole('heading',{name:/Hi,/})).toBeVisible();
}

test('registration selects a listed college and can request a missing college',async({page})=>{
 await page.route('**/src/lib.ts*',route=>route.fulfill({contentType:'application/javascript',body:fixture}));
 await page.goto('/');await page.getByRole('button',{name:'Skip'}).click();
 await page.getByRole('tab',{name:'Register'}).click();
 await expect(page.getByLabel('Your college',{exact:true})).toBeVisible();
 await expect(page.getByRole('option',{name:'MKCE'})).toBeAttached();
 await page.getByLabel('Your college',{exact:true}).selectOption('college-mkce');
 await expect(page.getByRole('button',{name:'Create account'})).toBeDisabled();
 await page.getByLabel('Can’t find your college?').locator('..').getByRole('textbox').fill('Sample Institute');
 await page.getByRole('button',{name:'Request',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Request sent for admin review');
});

test('settings is available from Profile only',async({page})=>{
 await enterGuestDashboard(page);
 await expect(page.getByRole('button',{name:'Open settings'})).toHaveCount(0);
 await page.getByRole('button',{name:'Profile'}).click();
 await page.getByRole('button',{name:/Settings Appearance, privacy and community guidelines/}).click();
 await expect(page.getByRole('dialog').getByRole('heading',{name:'Make yourself at home'})).toBeVisible();
});

test('group list matches the reference with filters and searchable rooms',async({page})=>{
 await enterGuestDashboard(page);
 await page.locator('.tile-groups').click();
 await expect(page.getByRole('heading',{name:'Group Chat'})).toBeVisible();
 await expect(page.getByRole('article')).toHaveCount(3);
 await page.getByRole('button',{name:'Department',exact:true}).click();
 await expect(page.getByRole('article')).toHaveCount(1);await expect(page.getByText('CSE Students',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'All',exact:true}).click();
 await page.getByRole('textbox',{name:'Search groups'}).fill('music');
 await expect(page.getByRole('article')).toHaveCount(1);await expect(page.getByText('Music & Mood',{exact:true})).toBeVisible();
});

test('admin gets a dashboard module that opens the admin workspace directly',async({page})=>{
 await page.addInitScript(()=>{window.__eventAdmin=true;});
 await enterGuestDashboard(page);
 await expect(page.locator('.tile-admin')).toBeVisible();
 await page.locator('.tile-admin').click();
 await expect(page.getByRole('heading',{name:'Event Admin Dashboard'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Colleges'})).toBeVisible();
});

test('profile college selection is saved before college-scoped chat',async({page})=>{
 await enterGuestDashboard(page);
 await page.getByRole('button',{name:'Profile'}).click();
 await page.getByLabel('College name').selectOption('college-mkce');
 await page.getByRole('button',{name:'Save profile'}).click();
 await expect(page.locator('.profile-save-message')).toContainText('Profile and college saved');
 await page.getByRole('button',{name:'Home'}).click();
 await page.locator('.tile-groups').click();
 await expect(page.getByText('Groups for MKCE students.')).toBeVisible();
});

test('students submit event posters for review and admins can approve them',async({page})=>{
 await enterGuestDashboard(page);
 await page.locator('.tile-events').click();
 await expect(page.getByRole('heading',{name:'Campus Events'})).toBeVisible();
 await page.getByRole('button',{name:'Submit event'}).click();
 await page.getByLabel('Event name').fill('TechnoFest 2026');
 await page.getByLabel('Organizer').fill('Department of CSE');
 await page.getByLabel('Date').fill('2026-10-20');
 await page.getByLabel('Venue').fill('Main Block, MKCE');
 await page.getByLabel('Description').fill('A campus technology festival with talks, workshops, and student projects.');
 await page.getByLabel('Registration link').fill('https://example.org/register');
 await page.getByLabel('Who can see this event?').selectOption('inter_college');
 await page.getByLabel('Upload event poster').setInputFiles({name:'poster.png',mimeType:'image/png',buffer:Buffer.from('poster')});
 await page.getByRole('button',{name:'Submit for approval'}).click();
 await expect(page.getByText('TechnoFest 2026',{exact:true})).toBeVisible();
 await expect(page.getByText('Under review',{exact:true})).toBeVisible();
 await expect(page.getByText('Register Now')).toHaveCount(0);

 await page.evaluate(()=>window.setEventAdmin(true));
 await page.getByRole('button',{name:'Discover',exact:true}).click();
 await expect(page.getByRole('button',{name:'Admin Dashboard'})).toBeVisible();
 await page.getByRole('button',{name:'Admin Dashboard'}).click();
 await expect(page.getByRole('heading',{name:'Event Admin Dashboard'})).toBeVisible();
 await expect(page.getByRole('button',{name:/Pending 1/})).toBeVisible();
 await expect(page.getByText('TechnoFest 2026',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Approve',exact:true}).click();
 await expect(page.getByRole('button',{name:/Approved 1/})).toBeVisible();
 await page.getByRole('button',{name:/Approved 1/}).click();
 await expect(page.getByRole('article').getByText('Approved',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Colleges'}).click();
 await expect(page.getByRole('heading',{name:'Manage colleges'})).toBeVisible();
 await page.getByLabel('Add a college').locator('..').getByRole('textbox').fill('New University');
 await page.getByRole('button',{name:'Add college'}).click();
 await expect(page.getByText('New University',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Approve',exact:true}).click();
 await expect(page.locator('.college-admin-item').getByText('Example College',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Discover',exact:true}).click();
 await page.locator('.campus-event-open').click();
 await expect(page.getByRole('heading',{name:'Event Details'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'TechnoFest 2026'})).toBeVisible();
 await expect(page.getByText('A campus technology festival with talks, workshops, and student projects.')).toBeVisible();
 await expect(page.getByRole('link',{name:/Register Now/})).toHaveAttribute('href','https://example.org/register');
 await page.getByRole('button',{name:'Back to events'}).click();
 await page.getByRole('button',{name:'Back to dashboard'}).click();
 await expect(page.locator('.event-dashboard-card')).toBeVisible();
});
