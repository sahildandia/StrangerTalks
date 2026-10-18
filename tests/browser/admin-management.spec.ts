import { expect, test, type Page } from '@playwright/test';

const fixture = `
export const configured=true, TERMS_VERSION='2026-10-17';
export const friendlyError=e=>e?.message||'Test error';
export const clientId=()=> '00000000-0000-4000-8000-000000000099';
const own='00000000-0000-4000-8000-000000000001';
const colleges=[{id:'college-one',name:'M KUMARASAMY COLLEGE OF ENGINEERING, KARUR, TAMIL NADU'},{id:'college-two',name:'MAM College Jammu'}];
let profile={id:own,display_name:'Sahil',college_id:window.__admin?null:'college-one',college_name:window.__admin?null:colleges[0].name,college_locked:!window.__admin,is_admin:!!window.__admin};
let users=[{...profile,email:'admin@example.test',is_admin:true,is_anonymous:false,is_banned:false,created_at:'2026-10-18T08:00:00Z'},
{id:'00000000-0000-4000-8000-000000000002',display_name:'Asha',email:'asha@example.test',college_id:'college-two',college_name:colleges[1].name,is_admin:false,is_anonymous:false,is_banned:false,created_at:'2026-10-18T09:00:00Z',last_sign_in_at:'2026-10-18T09:30:00Z',last_active_at:'2026-10-18T09:35:00Z'},
{id:'00000000-0000-4000-8000-000000000003',display_name:'',email:null,college_id:'college-one',college_name:colleges[0].name,is_admin:false,is_anonymous:true,is_banned:true,created_at:'2026-10-18T09:10:00Z'}];
window.__actions=[];
export async function rpc(name,args={}) {
 if(name==='st_begin')return {state:'idle',session:null};
 if(name==='cm_my_account')return {...profile};
 if(name==='cm_save_profile'){if(!profile.is_admin&&args.p_college_id!==profile.college_id)throw Error('Your college cannot be changed.');profile={...profile,display_name:args.p_name};return {...profile};}
 if(name==='ce_is_admin')return profile.is_admin;
 if(name==='cm_list_colleges'||name==='cm_admin_colleges')return colleges;
 if(name==='cm_admin_users'){
  let filtered=users.filter(u=>(!args.p_college_id||u.college_id===args.p_college_id)&&(!args.p_query||JSON.stringify(u).toLowerCase().includes(args.p_query.toLowerCase()))&&(args.p_status==='all'||args.p_status==='banned'&&u.is_banned||args.p_status==='active'&&!u.is_banned||args.p_status==='registered'&&!u.is_anonymous||args.p_status==='guest'&&u.is_anonymous));
  return {total:filtered.length,counts:{registered:users.filter(u=>!u.is_anonymous).length,guests:users.filter(u=>u.is_anonymous).length,banned:users.filter(u=>u.is_banned).length,total:users.length},users:filtered.slice(args.p_page*25,args.p_page*25+25)};
 }
 if(name==='gc_list')return [{id:'room-one',name:'College General',description:'Meet students from every department.',topic:'college',capacity:1000,member_count:4,college_name:colleges[0].name}];
 if(name==='gc_admin_list_rooms')return [];
 if(name==='ce_list'||name==='ce_my_events'||name==='ce_admin_events'||name==='cm_admin_college_requests')return [];
 return true;
}
export const db={auth:{getSession:async()=>({data:{session:{user:{id:own,email:'sahil@example.test',is_anonymous:false}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
 functions:{invoke:async(name,{body})=>{window.__actions.push(body);if(body.action==='delete')users=users.filter(u=>u.id!==body.user_id);else users=users.map(u=>u.id===body.user_id?{...u,is_banned:body.action==='ban'}:u);return {data:{ok:true},error:null};}},
 storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:''},error:null})})},channel:()=>({on(){return this},subscribe(){return this}}),removeChannel:async()=>{}};
`;

async function openDashboard(page: Page, admin: boolean) {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.addInitScript(value => { localStorage.setItem('st-onboarding-v1', 'done'); (window as unknown as { __admin: boolean }).__admin = value; }, admin);
  await page.route('**/src/lib.ts*', route => route.fulfill({ contentType: 'application/javascript', body: fixture }));
  await page.goto('/');
  await page.getByRole('checkbox').nth(0).check(); await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('button', { name: 'Continue as Guest' }).click();
  await expect(page.getByRole('heading', { name: 'Hi, Sahil!' })).toBeVisible();
}

test('student college is read-only while profile name stays editable', async ({ page }) => {
  await openDashboard(page, false);
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(page.getByText('Your college is saved and cannot be changed.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'College name', exact: true })).toHaveCount(0);
  await page.getByLabel('Name', { exact: true }).fill('Updated student');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('heading', { name: 'Updated student', exact: true })).toBeVisible();
});

test('admin sees all colleges and can review, ban, reactivate and confirm deletion', async ({ page }) => {
  await openDashboard(page, true);
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(page.getByText('Manage every college from the Admin dashboard.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'College name', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Admin Manage campus features' }).click();
  await page.getByRole('button', { name: 'Users', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Manage accounts' })).toBeVisible();
  await expect(page.getByText('Registered', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'deliverables/CampusMate-admin-users.png', fullPage: true });
  await page.getByRole('button', { name: /Asha asha@example.test/ }).click();
  await expect(page.getByRole('dialog', { name: 'Account details' })).toContainText('MAM College Jammu');
  await page.getByRole('button', { name: 'Ban account', exact: true }).click();
  await page.getByLabel('Reason', { exact: true }).fill('Reviewed a reported account');
  await page.getByRole('button', { name: 'Ban account', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Account banned');
  await page.getByRole('button', { name: /Asha asha@example.test/ }).click();
  await page.getByRole('button', { name: 'Reactivate', exact: true }).click();
  await page.getByLabel('Reason', { exact: true }).fill('Appeal reviewed and accepted');
  await page.getByRole('button', { name: 'Reactivate account', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Account reactivated');
  await page.getByRole('button', { name: /Asha asha@example.test/ }).click();
  await page.getByRole('button', { name: 'Delete account', exact: true }).click();
  await page.getByLabel('Reason', { exact: true }).fill('Account deletion request');
  await expect(page.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
  await page.getByLabel('Type the full user ID to confirm').fill('00000000-0000-4000-8000-000000000002');
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByRole('button', { name: /Asha asha@example.test/ })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __actions: { action: string }[] }).__actions.map(item => item.action))).toEqual(['ban', 'reactivate', 'delete']);
});

test('phone selectors use themed options and accept a custom group member limit', async ({ page }) => {
  await openDashboard(page, false);
  await page.getByRole('button', { name: 'Group Chat Join communities' }).click();
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await page.getByRole('button', { name: 'Group category', exact: true }).click();
  await page.getByRole('option', { name: 'Study', exact: true }).click();
  await page.getByLabel('Member limit', { exact: true }).fill('5000');
  await expect(page.getByLabel('Member limit', { exact: true })).toHaveValue('5000');
  await page.screenshot({ path: 'deliverables/CampusMate-custom-member-limit.png', fullPage: true });
  expect(await page.locator('select').count()).toBe(0);
  await page.getByRole('button', { name: 'Close group dialog' }).click();
  await page.getByRole('button', { name: 'Back to dashboard' }).click();
  await page.getByRole('button', { name: 'Campus Events Discover & Register' }).click();
  await page.getByRole('button', { name: 'Submit event', exact: true }).click();
  await page.getByRole('button', { name: 'Who can see this event?', exact: true }).click();
  await expect(page.getByRole('option', { name: /Intra-college/ })).toBeVisible();
  await page.screenshot({ path: 'deliverables/CampusMate-themed-event-audience.png', fullPage: true });
  await page.getByRole('option', { name: /Inter-college/ }).click();
  expect(await page.locator('select').count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});
