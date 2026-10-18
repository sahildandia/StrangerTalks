import { createClient } from '@supabase/supabase-js';
import { Preferences } from '@capacitor/preferences';
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const configured = !!url?.match(/^https:\/\/[a-z0-9-]+\.supabase\.co$/) && !!key && !key.includes('your_');
const storage = {
  async getItem(key: string) { return (await Preferences.get({ key })).value; },
  async setItem(key: string, value: string) { await Preferences.set({ key, value }); },
  async removeItem(key: string) { await Preferences.remove({ key }); }
};
export const db = configured ? createClient(url!, key!, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage },
  global: { fetch: (input, init) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    const abort = () => controller.abort();
    if (init?.signal?.aborted) abort();
    else init?.signal?.addEventListener('abort', abort, { once: true });
    return fetch(input, { ...init, signal: controller.signal }).finally(() => {
      window.clearTimeout(timeout);
      init?.signal?.removeEventListener('abort', abort);
    });
  } }
}) : null;
export const TERMS_VERSION = '2026-10-17';
export function clientId() {
  let id = sessionStorage.getItem('st-controller');
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('st-controller', id); }
  return id;
}
export type ChatSession = { id: string; user_a: string; user_b: string; created_at: string; ended_at: string | null; end_reason: string | null; typing_a_until: string | null; typing_b_until: string | null };
export type Message = { id: string; session_id: string; sender_id: string; body: string; created_at: string; client_nonce: string };
export type Snapshot = { state: 'idle' | 'waiting' | 'chat'; session: ChatSession | null };
export type GroupRoom = { id: string; name: string; description: string; topic: string; capacity: number; member_count: number; status?: 'pending'|'approved'|'rejected'|'disabled'; college_id?: string|null; college_name?: string|null; created_at?: string; review_note?: string|null; last_message?: string | null; last_message_at?: string | null };
export type GroupMessage = Omit<Message, 'session_id'> & { room_id: string; image_data?: string | null };
export type GroupMember = { user_id: string; typing_until: string | null };
export type AccountProfile = { id: string; display_name: string; college_id: string | null; college_name: string | null; college_locked: boolean; is_admin: boolean };
export type GroupSnapshot = { state: 'joined'; room: GroupRoom; members: GroupMember[]; messages: GroupMessage[] } | { state: 'left' };
export async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!db) throw new Error('Connect your Supabase project before starting a chat.');
  const { data, error } = await db.rpc(name, { p_client_id: clientId(), ...args });
  if (error) throw new Error(error.message);
  return data as T;
}
export function friendlyError(error: unknown) {
  const raw = error instanceof Error ? error.message : 'Something went wrong. Please try again.';
  if (/fetch|network|timeout|timed out|abort/i.test(raw)) return 'Connection timed out. Check your mobile signal or Wi-Fi, then try again.';
  return raw;
}
