export function validateConfig(env) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(env.VITE_SUPABASE_URL ?? '')) throw new Error('Set VITE_SUPABASE_URL to your Supabase project URL.');
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
  if (!key || key.includes('your_') || key.startsWith('sb_secret_')) throw new Error('Use the public publishable key. Never use a secret/service-role key.');
  if (key.startsWith('eyJ')) {
    let claims;
    try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')); } catch { throw new Error('The legacy public anon key is invalid.'); }
    if (claims.role !== 'anon') throw new Error('Only the public anon key is allowed in the app.');
  } else if (!key.startsWith('sb_publishable_')) throw new Error('Use a Supabase publishable key or legacy anon key.');
  if (env.VITE_SUPPORT_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.VITE_SUPPORT_EMAIL)) throw new Error('VITE_SUPPORT_EMAIL must be a valid email address when supplied.');
  if (env.VITE_HCAPTCHA_SITE_KEY && (!/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/i.test(env.CAPACITOR_HOSTNAME ?? '') || /localhost|\.local$|\.invalid$/i.test(env.CAPACITOR_HOSTNAME ?? ''))) throw new Error('Native hCaptcha requires CAPACITOR_HOSTNAME set to an HTTPS hostname you control and allow in hCaptcha. localhost is unsupported.');
}
if (process.argv[1]?.replaceAll('\\','/').endsWith('/check-config.mjs')) {
  try { validateConfig(process.env); console.log('Public app configuration is valid.'); }
  catch (e) { console.error(e.message); process.exit(1); }
}
