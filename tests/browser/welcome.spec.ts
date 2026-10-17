import { test, expect } from '@playwright/test';
test('mobile welcome enforces consent and exposes an honest setup error', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.getByRole('heading', {name:'Someone new. Something unexpected.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Start a conversation'})).toBeDisabled();
  await page.getByRole('checkbox').nth(0).check(); await page.getByRole('checkbox').nth(1).check();
  await expect(page.getByRole('button',{name:'Start a conversation'})).toBeEnabled();
  await page.screenshot({path:'deliverables/StrangerTalk-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Start a conversation'}).click();
  await expect(page.getByRole('alert')).toContainText('connect Supabase');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('settings, theme and safety documents are available without login',async ({page})=>{
  await page.goto('/'); await page.getByRole('button',{name:'Open settings'}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button',{name:/Appearance/}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.getByRole('button',{name:/Privacy policy/}).click();
  await expect(page.getByRole('dialog')).toContainText('not end-to-end encrypted');
  await page.getByRole('button',{name:'Close dialog'}).click();
  await page.getByRole('button',{name:'Stay safe'}).click();
  await expect(page.getByRole('dialog')).toContainText('18 and older');
});
