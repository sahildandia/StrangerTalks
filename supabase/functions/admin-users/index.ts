import { createClient } from 'npm:@supabase/supabase-js@2.90.0';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' });
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return reply(401, { error: 'Sign in as an administrator.' });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
    const { data: session, error: authError } = await caller.auth.getUser(authorization.slice(7));
    if (authError || !session.user) return reply(401, { error: 'Your session expired. Please sign in again.' });
    const { client_id, user_id, action, note, confirmation } = await request.json();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(user_id ?? '') || !uuid.test(client_id ?? '') || !['ban', 'reactivate', 'delete'].includes(action)
      || typeof note !== 'string' || note.trim().length < 3 || note.trim().length > 300) return reply(400, { error: 'Check the action and reason.' });
    if (action === 'delete' && confirmation !== user_id) return reply(400, { error: 'Confirm deletion with the full user ID.' });
    const { data: permitted, error: denied } = await caller.rpc('cm_admin_check_user_action', { p_client_id: client_id, p_user_id: user_id, p_action: action, p_note: note.trim() });
    if (denied || permitted?.actor_id !== session.user.id) return reply(403, { error: denied?.message ?? 'Admin access required.' });
    // The service credential is available only inside this server function.
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    if (action === 'delete') {
      // Remove posters through Storage, so no files are orphaned by Auth deletion.
      for (let batch = 0; batch < 100; batch++) {
        const { data: files, error } = await admin.storage.from('event-posters').list(user_id, { limit: 100 });
        if (error) throw error;
        if (!files?.length) break;
        const { error: removalError } = await admin.storage.from('event-posters').remove(files.map(file => `${user_id}/${file.name}`));
        if (removalError) throw removalError;
        if (batch === 99) throw new Error('Some posters remain. Please retry account deletion.');
      }
      const { error } = await admin.auth.admin.deleteUser(user_id);
      if (error) throw error;
    } else {
      const { error } = await admin.auth.admin.updateUserById(user_id, { ban_duration: action === 'ban' ? '876000h' : 'none' });
      if (error) throw error;
    }
    const { error: auditError } = await admin.rpc('cm_admin_record_user_action', { p_actor_id: session.user.id, p_user_id: user_id, p_action: action, p_note: note.trim() });
    if (auditError) console.error('Account action audit failed', { action, user_id, actor_id: session.user.id, message: auditError.message });
    return reply(200, { ok: true });
  } catch (error) {
    console.error('Account management failed', error instanceof Error ? error.message : 'Unknown error');
    return reply(400, { error: error instanceof Error ? error.message : 'Account action failed. Please refresh and try again.' });
  }
});
