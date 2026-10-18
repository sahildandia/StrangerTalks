import { useCallback, useEffect, useRef, useState } from 'react';
import { Ban, CheckCircle2, ChevronLeft, ChevronRight, RefreshCw, Search, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import { clientId, db, friendlyError, rpc } from './lib';
import ThemedSelect from './ThemedSelect';

type Account = { id: string; email: string | null; display_name: string; college_id: string | null; college_name: string | null; is_anonymous: boolean; is_admin: boolean; is_banned: boolean; banned_until: string | null; created_at: string; last_sign_in_at: string | null; last_active_at: string | null };
type Directory = { total: number; counts: { total: number; registered: number; guests: number; banned: number }; users: Account[] };
type Action = 'ban' | 'reactivate' | 'delete';
const date = (value: string | null) => value ? new Date(value).toLocaleString() : 'Not yet';

export default function AdminUsers({ uid, colleges }: { uid: string; colleges: { id: string; name: string }[] }) {
  const [data, setData] = useState<Directory | null>(null); const [query, setQuery] = useState(''); const [search, setSearch] = useState('');
  const [college, setCollege] = useState(''); const [status, setStatus] = useState('all'); const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<Account | null>(null); const [action, setAction] = useState<Action | null>(null); const [note, setNote] = useState(''); const [confirmation, setConfirmation] = useState('');
  const requestVersion = useRef(0);
  useEffect(() => { const timer = window.setTimeout(() => { setSearch(query); setPage(0); }, 300); return () => window.clearTimeout(timer); }, [query]);
  const load = useCallback(async (signal?: AbortSignal) => {
    const version = ++requestVersion.current;
    setLoading(true); setError('');
    try { const result = await rpc<Directory>('cm_admin_users', { p_query: search, p_college_id: college || null, p_status: status, p_page: page, p_page_size: 25 }); if (!signal?.aborted && version === requestVersion.current) setData(result); }
    catch (failure) { if (!signal?.aborted && version === requestVersion.current) setError(friendlyError(failure)); }
    finally { if (!signal?.aborted && version === requestVersion.current) setLoading(false); }
  }, [search, college, status, page]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus({ preventScroll: true });
  }, [selected]);
  async function applyAction() {
    if (!db || !selected || !action) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const { data: result, error: failure } = await db.functions.invoke('admin-users', { body: { client_id: clientId(), user_id: selected.id, action, note: note.trim(), confirmation } });
      if (failure) {
        const response = (failure as { context?: Response }).context;
        const detail = response ? await response.clone().json().catch(() => null) : null;
        throw new Error(detail?.error ?? failure.message);
      }
      if (!result?.ok) throw new Error(result?.error ?? 'Account action failed.');
      setNotice(action === 'delete' ? 'Account deleted.' : action === 'ban' ? 'Account banned. Sign-in and chat access are blocked.' : 'Account reactivated.');
      setSelected(null); setAction(null); setNote(''); setConfirmation(''); await load();
    } catch (failure) { setError(friendlyError(failure)); }
    finally { setBusy(false); }
  }
  return <section className="admin-users" aria-label="User management">
    <div className="event-admin-intro"><div><span className="campus-eyebrow">ALL COLLEGES</span><h2>Manage accounts</h2><p>View registered students and guest identities across every college.</p></div><Users size={24}/></div>
    <div className="event-admin-stats">{data ? [['Registered', data.counts.registered], ['Guest identities', data.counts.guests], ['Banned', data.counts.banned], ['All accounts', data.counts.total]].map(([label, count]) => <div className="event-admin-stat" key={label}><span>{label}</span><strong>{count}</strong></div>) : null}</div>
    <div className="admin-user-filters"><label className="events-search"><Search size={16}/><input aria-label="Search users" placeholder="Name, email, user ID or college" maxLength={120} value={query} onChange={event => setQuery(event.target.value)}/></label><ThemedSelect label="Filter users by college" value={college} onChange={value => { setCollege(value); setPage(0); }} options={[{ value: '', label: 'All colleges' }, ...colleges.map(item => ({ value: item.id, label: item.name }))]}/><ThemedSelect label="Filter users by status" value={status} onChange={value => { setStatus(value); setPage(0); }} options={['all', 'registered', 'guest', 'active', 'banned'].map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))}/><button type="button" className="button secondary" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={15}/>Refresh</button></div>
    {error ? <p role="alert" className="college-admin-error">{error}</p> : null}{notice ? <p role="status" className="profile-save-message">{notice}</p> : null}
    {loading ? <p role="status">Loading accounts…</p> : <div className="admin-user-list">{data?.users.map(user => <button type="button" className="admin-user-row" key={user.id} onClick={() => { setSelected(user); setAction(null); setNote(''); setConfirmation(''); }}><span className="admin-user-avatar">{user.is_admin ? <ShieldCheck size={20}/> : <Users size={20}/>}</span><span><strong>{user.display_name || user.email || 'Guest student'}</strong><small>{user.email || user.id}</small><small>{user.is_admin ? 'Admin · All colleges' : user.college_name || 'College not selected'}</small></span><span className={`account-status ${user.is_banned ? 'banned' : ''}`}>{user.is_banned ? 'Banned' : user.is_anonymous ? 'Guest' : 'Active'}</span><ChevronRight size={16}/></button>)}{!data?.users.length ? <p className="college-admin-empty">No accounts match these filters.</p> : null}</div>}
    <div className="admin-user-pagination"><button type="button" className="button secondary" disabled={!page || loading} onClick={() => setPage(value => value - 1)}><ChevronLeft size={15}/>Previous</button><span>{data?.total ?? 0} accounts · Page {page + 1}</span><button type="button" className="button secondary" disabled={loading || (page + 1) * 25 >= (data?.total ?? 0)} onClick={() => setPage(value => value + 1)}>Next<ChevronRight size={15}/></button></div>
    {selected ? <div className="account-dialog-backdrop"><div className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); if (!busy) { setSelected(null); setAction(null); } } if (event.key === 'Tab') { const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea')); const index = controls.indexOf(document.activeElement as HTMLElement); if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus(); } else if (!event.shiftKey && index === controls.length - 1) { event.preventDefault(); controls[0]?.focus(); } } }}><header><h2 id="account-dialog-title">{action ? `${action === 'reactivate' ? 'Reactivate' : action === 'ban' ? 'Ban' : 'Delete'} account` : 'Account details'}</h2><button autoFocus type="button" className="icon-button" aria-label="Close account details" disabled={busy} onClick={() => { setSelected(null); setAction(null); }}><X size={20}/></button></header>
      <dl>{[['Name', selected.display_name || 'Not provided'], ['Email', selected.email || 'Guest · no email'], ['User ID', selected.id], ['College', selected.is_admin ? 'All colleges · administrator' : selected.college_name || 'Not selected'], ['Account', selected.is_anonymous ? 'Guest identity' : 'Registered'], ['Status', selected.is_banned ? 'Banned' : 'Active'], ['Registered', date(selected.created_at)], ['Last sign-in', date(selected.last_sign_in_at)], ['Last active', date(selected.last_active_at)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {selected.is_admin || selected.id === uid ? <p className="profile-save-message">This administrator account is protected.</p> : action ? <form className="account-action-form" onSubmit={event => { event.preventDefault(); void applyAction(); }}><p>{action === 'delete' ? 'Permanently removes this identity, its profile, event submissions and associated chat records. This cannot be undone.' : action === 'ban' ? 'Blocks sign-in and immediately removes this user from active conversations and groups.' : 'Restores sign-in and chat access. The selected college remains unchanged.'}</p><label htmlFor="account-action-note">Reason</label><textarea id="account-action-note" required minLength={3} maxLength={300} value={note} onChange={event => setNote(event.target.value)}/>{action === 'delete' ? <><label htmlFor="account-delete-confirm">Type the full user ID to confirm</label><input id="account-delete-confirm" required autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)}/></> : null}{error ? <p role="alert" className="college-admin-error">{error}</p> : null}<div className="account-action-buttons"><button type="button" className="button secondary" disabled={busy} onClick={() => setAction(null)}>Cancel</button><button className={`button ${action === 'delete' ? 'danger' : 'primary'}`} disabled={busy || note.trim().length < 3 || (action === 'delete' && confirmation !== selected.id)}>{busy ? 'Applying…' : action === 'delete' ? 'Delete permanently' : action === 'ban' ? 'Ban account' : 'Reactivate account'}</button></div></form> : <div className="account-action-buttons"><button type="button" className="button secondary" onClick={() => setAction(selected.is_banned ? 'reactivate' : 'ban')}>{selected.is_banned ? <CheckCircle2 size={16}/> : <Ban size={16}/>}{selected.is_banned ? 'Reactivate' : 'Ban account'}</button><button type="button" className="button danger" onClick={() => setAction('delete')}><Trash2 size={16}/>Delete account</button></div>}
    </div></div> : null}
  </section>;
}
