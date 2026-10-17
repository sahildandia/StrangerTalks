import { test, expect } from '@playwright/test';
test('mobile welcome enforces consent without moving the document', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.getByRole('heading', {name:'Someone new. A fresh perspective.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Start a conversation'})).toBeDisabled();
  await page.getByRole('checkbox').nth(0).check(); await page.getByRole('checkbox').nth(1).check();
  await expect(page.getByRole('button',{name:'Start a conversation'})).toBeEnabled();
  await page.screenshot({path:'deliverables/StrangerTalk-mobile.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight)).toBe(true);
});

for (const viewport of [{width:320,height:568},{width:360,height:640},{width:390,height:844},{width:412,height:915},{width:740,height:360}]) {
  test(`phone controls stay inside ${viewport.width}x${viewport.height}`, async ({page}) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const start = page.getByRole('button',{name:'Start a conversation',exact:true});
    await expect(start).toBeVisible();
    const bounds = await start.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    await page.mouse.wheel(0,500);
    expect(await page.evaluate(()=>window.scrollY)).toBe(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.getByRole('button',{name:'Open settings'}).click();
    await page.getByRole('button',{name:/Privacy policy/}).click();
    const dialog = page.getByRole('dialog');
    const box = await dialog.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
    await dialog.evaluate(el=>el.scrollTop=el.scrollHeight);
    expect(await page.evaluate(()=>window.scrollY)).toBe(0);
  });
}
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
