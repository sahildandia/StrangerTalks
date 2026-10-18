import { test, expect } from '@playwright/test';

// Isolated layout fixture. It replaces the client module only in this test's
// browser; it never signs in, queues a user, or writes to the hosted backend.
const backendFixture = `
export const configured=true, TERMS_VERSION='2026-10-17';
export const friendlyError=e=>e.message;
const session={id:'layout-session',user_a:'layout-a',user_b:'layout-b',ended_at:null,typing_a_until:null,typing_b_until:null};
const messages=Array.from({length:45},(_,i)=>({id:String(i),session_id:session.id,sender_id:i%2?'layout-a':'layout-b',body:'Layout test message '+i+' — checking readable messages and scroll boundaries.',created_at:new Date(1700000000000+i*1000).toISOString()}));
let state='chat', listener;
window.addEventListener('layout-incoming', e=>{messages.push(e.detail);listener?.({new:e.detail});});
export async function rpc(name,args={}) {
 if(name==='st_next') state='waiting';
 if(name==='st_leave') state='idle';
 if(name==='st_send') {const m={id:crypto.randomUUID(),session_id:session.id,sender_id:'layout-a',body:args.p_body,created_at:new Date().toISOString()};messages.push(m);return m;}
 return {state,session:state==='chat'?session:null};
}
export const db={
 auth:{getSession:async()=>({data:{session:{user:{id:'layout-a'}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
 from(){return {select(){return this},eq(){return this},order(){return this},limit:async()=>({data:[...messages].reverse(),error:null})}},
 channel(){return {on(type,filter,callback){if(filter.event==='INSERT')listener=callback;return this},subscribe(){return this}}},
 removeChannel:async()=>{listener=null}
};`;

test('chat keeps its composer fixed during history scroll, incoming messages and keyboard resize', async ({page}) => {
  await page.setViewportSize({width:360,height:740});
  await page.route('**/src/lib.ts*', route=>route.fulfill({contentType:'application/javascript',body:backendFixture}));
  await page.goto('/');
  await page.getByRole('button',{name:'Skip'}).click();
  await page.getByRole('checkbox').nth(0).check();
  await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('button',{name:'Continue as Guest'}).click();
  await page.getByRole('button',{name:/Stranger Talk/}).click();
  const log=page.getByRole('log',{name:'Conversation'});
  const input=page.getByRole('textbox',{name:'Message',exact:true});
  await expect(page.locator('.message')).toHaveCount(45);
  const composerBefore=await page.locator('.chat-composer').boundingBox();
  expect(await log.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
  await log.evaluate(el=>el.scrollTop=0);
  await expect.poll(()=>log.evaluate(el=>el.scrollTop)).toBe(0);
  await page.waitForTimeout(100);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('layout-incoming',{detail:{id:'new-layout-message',session_id:'layout-session',sender_id:'layout-b',body:'An incoming test message',created_at:new Date().toISOString()}})));
  await expect(page.getByRole('button',{name:'New messages'})).toBeVisible();
  expect(await log.evaluate(el=>el.scrollTop)).toBe(0);
  expect(await page.locator('.chat-composer').boundingBox()).toEqual(composerBefore);
  expect(await page.evaluate(()=>window.scrollY)).toBe(0);
  await page.getByRole('button',{name:'New messages'}).click();
  await expect.poll(()=>log.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight)).toBeLessThan(2);
  await input.focus();
  await page.setViewportSize({width:360,height:360});
  await expect.poll(async()=>{
    const box=await input.boundingBox();return box!.y+box!.height;
  }).toBeLessThanOrEqual(360);
  expect((await log.boundingBox())!.height).toBeGreaterThan(40);
  await input.fill('A keyboard layout check');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(log).toContainText('A keyboard layout check');
  expect(await page.evaluate(()=>window.scrollY)).toBe(0);
  await page.setViewportSize({width:360,height:740});
  await page.context().setOffline(true);
  await expect(page.getByText(/Reconnecting… Messages are paused/)).toBeVisible();
  const inputBounds=await input.boundingBox();
  expect(inputBounds!.y+inputBounds!.height).toBeLessThanOrEqual(740);
  expect(await page.evaluate(()=>document.documentElement.scrollHeight)).toBeLessThanOrEqual(740);
  await page.context().setOffline(false);
  await page.getByRole('button',{name:'Keep in Chats'}).click();
  await expect(page.getByRole('heading',{name:'Pick up the conversation.'})).toBeVisible();
  await expect(page.getByText('Stranger Talk',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Open',exact:true}).click();
  await expect(page.getByRole('log',{name:'Conversation'})).toBeVisible();
  await page.getByRole('button',{name:'Keep in Chats'}).click();
  await page.getByRole('button',{name:'Leave and clear this chat'}).click();
  await expect(page.getByText('No active chats',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Profile',exact:true}).click();
  await page.getByLabel('Name',{exact:true}).fill('Asha');
  await page.getByLabel('College name',{exact:true}).fill('North Campus College');
  await page.getByRole('button',{name:'Save profile'}).click();
  await expect(page.getByRole('heading',{name:'Asha',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Home',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Hi, Asha!'})).toBeVisible();
});
