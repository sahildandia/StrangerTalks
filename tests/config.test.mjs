import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../scripts/check-config.mjs';
const valid = {VITE_SUPABASE_URL:'https://abc123.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test_public', VITE_SUPPORT_EMAIL:'owner@example.org'};
test('build accepts public configuration', () => assert.doesNotThrow(() => validateConfig(valid)));
test('build rejects administrator credentials and malformed supplied contact', () => {
  assert.throws(() => validateConfig({...valid,VITE_SUPABASE_PUBLISHABLE_KEY:'sb_secret_do_not_bundle'}));
  const jwt = `eyJ.${Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')}.signature`;
  assert.throws(() => validateConfig({...valid,VITE_SUPABASE_PUBLISHABLE_KEY:jwt}));
  assert.doesNotThrow(() => validateConfig({...valid,VITE_SUPPORT_EMAIL:''}));
  assert.doesNotThrow(() => validateConfig({...valid,VITE_SUPPORT_EMAIL:undefined}));
  assert.throws(() => validateConfig({...valid,VITE_SUPPORT_EMAIL:'invalid'}));
  assert.throws(() => validateConfig({...valid,VITE_SUPABASE_URL:'http://localhost:54321'}));
  assert.throws(() => validateConfig({...valid,VITE_HCAPTCHA_SITE_KEY:'site-key'}));
  assert.doesNotThrow(() => validateConfig({...valid,VITE_HCAPTCHA_SITE_KEY:'site-key',CAPACITOR_HOSTNAME:'chat.example.org'}));
});
