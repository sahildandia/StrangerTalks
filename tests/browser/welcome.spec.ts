import { test, expect } from '@playwright/test';

async function openAuth(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', {name:/Meet\./})).toBeVisible();
  await page.getByRole('button', {name:'Skip'}).click();
  await expect(page.getByRole('heading', {name:'Good to see you.'})).toBeVisible();
}

test('onboarding leads to login and guest requires adult and policy consent', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await openAuth(page);
  const guest=page.getByRole('button',{name:'Continue as Guest'});
  await expect(guest).toBeDisabled();
  await page.getByRole('checkbox').nth(0).check();
  await page.getByRole('checkbox').nth(1).check();
  await expect(guest).toBeEnabled();
  await page.screenshot({path:'deliverables/CampusMate-auth.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight)).toBe(true);
});

for (const viewport of [{width:320,height:568},{width:360,height:640},{width:390,height:844},{width:412,height:915},{width:740,height:360}]) {
  test(`welcome and login fit the phone width at ${viewport.width}x${viewport.height}`, async ({page}) => {
    await page.setViewportSize(viewport);
    await openAuth(page);
    await expect(page.getByLabel('College or personal email')).toBeVisible();
    await expect(page.getByRole('button',{name:'Continue as Guest'})).toBeVisible();
    await expect(page.getByRole('tab',{name:'Register'})).toBeVisible();
    await page.getByRole('tab',{name:'Register'}).click();
    await expect(page.getByRole('button',{name:'Create account'})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    expect(await page.evaluate(()=>window.scrollY)).toBe(0);
  });
}

test('privacy and safety documents open from the login screen',async ({page})=>{
  await openAuth(page);
  await page.getByRole('button',{name:'Privacy Policy'}).click();
  await expect(page.getByRole('dialog')).toContainText('You may create an account with an email address');
  await page.getByRole('button',{name:'Close dialog'}).click();
  await page.getByRole('button',{name:'Community Guidelines'}).click();
  await expect(page.getByRole('dialog')).toContainText('18 and older');
});
