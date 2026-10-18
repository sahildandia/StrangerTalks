import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, Ban, BriefcaseBusiness, Check, Flag, Gamepad2, Hash, LogOut, MessageCircle, Music2, Search, Send, ShieldCheck, Sun, Users, WifiOff, X, BookOpen, Building2, CalendarDays, Laugh, Code2 } from 'lucide-react';
import { db, friendlyError, rpc, type GroupMessage, type GroupRoom, type GroupSnapshot } from './lib';
import CollegePicker from './CollegePicker';

type Joined = Extract<GroupSnapshot, {state: 'joined'}>;
type Dialog = 'members' | 'safety' | 'leave' | 'create' | null;
type College = {id:string;name:string;is_active:boolean};
const alias = (id: string) => `Stranger ${id.slice(0, 6).toUpperCase()}`;
const time = (date: string) => new Date(date).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
const topicIcon = (topic: string) => topic === 'music' ? <Music2/> : topic === 'gaming' ? <Gamepad2/> : topic === 'life' ? <Sun/> : topic === 'department' ? <Code2/> : topic === 'college' ? <Building2/> : topic === 'career' ? <BriefcaseBusiness/> : topic === 'study' ? <BookOpen/> : topic === 'events' ? <CalendarDays/> : topic === 'social' ? <Laugh/> : <MessageCircle/>;
const recentTime = (value?: string | null) => {
  if (!value) return 'Be the first to say hello';
  const minutes=Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/60000));
  return minutes<1?'Just now':minutes<60?`${minutes}m ago`:minutes<1440?`${Math.floor(minutes/60)}h ago`:'Yesterday';
};
const roomFilters=['All','My Groups','College','Department','Interests'] as const;

export default function GroupChat({uid, collegeName, onBack}: {uid: string; collegeName: string; onBack: () => void}) {
  const [rooms, setRooms] = useState<GroupRoom[]>([]);
  const [search,setSearch]=useState(''); const [filter,setFilter]=useState<typeof roomFilters[number]>('All');
  const [myRoomIds,setMyRoomIds]=useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem('st-my-groups')??'[]')}catch{return []}});
  const [group, setGroup] = useState<Joined | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [connected, setConnected] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [dialog, setDialog] = useState<Dialog>(null);
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('harassment');
  const [isAdmin,setIsAdmin]=useState(false);
  const [adminView,setAdminView]=useState(false);
  const [adminRooms,setAdminRooms]=useState<GroupRoom[]>([]);
  const [colleges,setColleges]=useState<College[]>([]);
  const [collegeFilter,setCollegeFilter]=useState('');
  const [statusFilter,setStatusFilter]=useState('pending');
  const [groupName,setGroupName]=useState('');
  const [groupDescription,setGroupDescription]=useState('');
  const [groupTopic,setGroupTopic]=useState('general');
  const [groupCapacity,setGroupCapacity]=useState('30');
  const [unread, setUnread] = useState(false);
  const groupRef = useRef<Joined | null>(null);
  const alive = useRef(true);
  const locked = useRef(false);
  const fetching = useRef(false);
  const revision = useRef(0);
  const list = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const pending = useRef<{room: string; body: string; nonce: string} | null>(null);
  const lastTyping = useRef(0);
  const blocked = !online || !connected;
  useEffect(()=>{let active=true;void rpc<boolean>('ce_is_admin').then(value=>{if(active)setIsAdmin(value);}).catch(()=>{});return()=>{active=false;};},[]);
  useEffect(()=>{if(!isAdmin)return;let active=true;void rpc<College[]>('cm_admin_colleges').then(value=>{if(active)setColleges(value??[]);}).catch(e=>{if(active)setError(friendlyError(e));});return()=>{active=false;};},[isAdmin]);
  const loadAdminRooms=useCallback(async()=>{
    if(!isAdmin)return;
    setLoading(true);
    try { setAdminRooms(await rpc<GroupRoom[]>('gc_admin_list_rooms',{p_college_id:collegeFilter||null,p_status:statusFilter})??[]); setConnected(true); }
    catch(e){setError(friendlyError(e));setConnected(false);}
    finally{setLoading(false);}
  },[isAdmin,collegeFilter,statusFilter]);
  useEffect(()=>{if(adminView&&isAdmin&&!group)void loadAdminRooms();},[adminView,isAdmin,group,loadAdminRooms]);
  const shownRooms=rooms.filter(room=>{
    const matchesSearch=`${room.name} ${room.description} ${room.topic}`.toLowerCase().includes(search.toLowerCase());
    const matchesFilter=filter==='All'||(filter==='My Groups'&&myRoomIds.includes(room.id))||(filter==='College'&&['college','events'].includes(room.topic))||(filter==='Department'&&['department','career','study'].includes(room.topic))||(filter==='Interests'&&['general','music','gaming','life','social'].includes(room.topic));
    return matchesSearch&&matchesFilter;
  });

  const apply = useCallback((next: Joined | null) => { groupRef.current = next; setGroup(next); }, []);
  const refresh = useCallback(async () => {
    if (fetching.current || locked.current || document.hidden || !navigator.onLine || (adminView && !groupRef.current)) return;
    fetching.current = true;
    const version = revision.current;
    try {
      const current = groupRef.current;
      if (current) {
        const snapshot = await rpc<GroupSnapshot>('gc_poll', {p_room_id: current.room.id});
        if (!alive.current || version !== revision.current) return;
        if (snapshot.state === 'joined') apply(snapshot);
        else { apply(null); setDraft(''); setDialog(null); pending.current = null; setNotice('You left the group or your connection expired. Choose a room to join again.'); }
      } else {
        const data = await rpc<GroupRoom[]>('gc_list');
        if (alive.current && version === revision.current) setRooms(data);
      }
      if (alive.current) { setConnected(true); setLoading(false); }
    } catch(e) {
      if (alive.current && version === revision.current) { setConnected(false); setLoading(false); setError(friendlyError(e)); }
    } finally { fetching.current = false; }
  }, [apply, adminView]);
  useEffect(() => {
    alive.current = true; void refresh();
    const timer = setInterval(() => { setNow(Date.now()); void refresh(); }, 3000);
    const network = () => { setOnline(navigator.onLine); if (navigator.onLine) void refresh(); };
    const visible = () => { if (!document.hidden) void refresh(); };
    window.addEventListener('online', network); window.addEventListener('offline', network);
    document.addEventListener('visibilitychange', visible);
    return () => { alive.current = false; revision.current++; clearInterval(timer); window.removeEventListener('online', network); window.removeEventListener('offline', network); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  const roomId = group?.room.id;
  useEffect(() => {
    if (!roomId || !db) return;
    const channel = db.channel(`group:${roomId}`).on('postgres_changes', {event: 'INSERT', schema: 'public', table: 'gc_messages', filter: `room_id=eq.${roomId}`}, payload => {
      const message = payload.new as GroupMessage;
      const current = groupRef.current;
      if (current?.room.id === message.room_id && !current.messages.some(m => m.id === message.id)) {
        apply({...current, messages: [...current.messages, message].sort((a,b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).slice(-200)});
      }
    }).subscribe();
    return () => { void db?.removeChannel(channel); };
  }, [roomId, apply]);
  const lastMessage = group?.messages.at(-1)?.id;
  useEffect(() => {
    if (!list.current) return;
    if (following.current) list.current.scrollTop = list.current.scrollHeight;
    else if (lastMessage) setUnread(true);
  }, [lastMessage, roomId]);
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const observer = new ResizeObserver(() => { if (following.current) element.scrollTop = element.scrollHeight; });
    observer.observe(element); return () => observer.disconnect();
  }, [roomId]);
  useEffect(() => {
    const back = () => { if (dialog) setDialog(null); else if (groupRef.current) setDialog('leave'); else onBack(); };
    window.addEventListener('st-group-back', back);
    return () => window.removeEventListener('st-group-back', back);
  }, [dialog, onBack]);
  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const element = document.querySelector('[data-group-dialog]');
    const buttons = () => Array.from(element?.querySelectorAll<HTMLElement>('button:not(:disabled),select') ?? []);
    buttons()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !locked.current) setDialog(null);
      if (e.key !== 'Tab') return;
      const items = buttons(); const first = items[0]; const last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [dialog]);

  async function act(work: () => Promise<void>) {
    if (locked.current || sending) return;
    locked.current = true; revision.current++; setBusy(true); setError('');
    try { await work(); } catch(e) { if (alive.current) setError(friendlyError(e)); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  function join(room: GroupRoom) {
    void act(async () => {
      const snapshot = await rpc<GroupSnapshot>('gc_join', {p_room_id: room.id});
      if (!alive.current || snapshot.state !== 'joined') return;
      following.current = true; setUnread(false); setDraft(''); pending.current = null;
      const recent=[room.id,...myRoomIds.filter(id=>id!==room.id)].slice(0,20);setMyRoomIds(recent);localStorage.setItem('st-my-groups',JSON.stringify(recent));
      apply(snapshot); setConnected(true); setNotice('');
    });
  }
  function leave() {
    void act(async () => {
      if (groupRef.current) await rpc('gc_leave', {p_room_id: groupRef.current.room.id});
      apply(null); setDraft(''); pending.current = null; setDialog(null); setLoading(true);
      setRooms(await rpc<GroupRoom[]>('gc_list')); setLoading(false);
    });
  }
  async function send(e: FormEvent) {
    e.preventDefault(); const current = groupRef.current; const body = draft.trim();
    if (!current || !body || locked.current || sending || blocked) return;
    setSending(true); setError('');
    const item = pending.current?.room === current.room.id && pending.current.body === body ? pending.current : {room: current.room.id, body, nonce: crypto.randomUUID()};
    pending.current = item;
    try {
      const message = await rpc<GroupMessage>('gc_send', {p_room_id: item.room, p_body: item.body, p_nonce: item.nonce});
      const latest = groupRef.current;
      if (alive.current && latest?.room.id === item.room) {
        following.current = true; setUnread(false);
        if (!latest.messages.some(m => m.id === message.id)) apply({...latest, messages: [...latest.messages, message].slice(-200)});
        setDraft(value => value.trim() === body ? '' : value); pending.current = null;
      }
    } catch(e) { if (alive.current) setError(friendlyError(e)); }
    finally { if (alive.current) setSending(false); }
  }
  function type(value: string) {
    setDraft(value);
    if (!roomId || blocked || Date.now()-lastTyping.current<1500) return;
    lastTyping.current = Date.now();
    void rpc('gc_typing', {p_room_id: roomId, p_typing: !!value.trim()}).catch(() => {});
  }
  function safety(report: boolean) {
    void act(async () => {
      if (!roomId || !target) return;
      await rpc('gc_safety', {p_room_id: roomId, p_target: target, p_reason: report ? reason : null});
      apply(null); setDialog(null); setDraft(''); pending.current = null;
      setNotice(report ? 'Report saved. Identity blocked. You have left the group.' : 'Identity blocked. You have left the group.');
      setRooms(await rpc<GroupRoom[]>('gc_list'));
    });
  }
  function submitRoom(event:FormEvent){
    event.preventDefault();
    void act(async()=>{
      await rpc('gc_submit_room',{p_name:groupName,p_description:groupDescription,p_topic:groupTopic,p_capacity:Number(groupCapacity)});
      setGroupName('');setGroupDescription('');setGroupTopic('general');setGroupCapacity('30');setDialog(null);
      setNotice('Your group was submitted. It will appear to your college after admin approval.');
      if(isAdmin)await loadAdminRooms();
    });
  }
  function reviewRoom(room:GroupRoom,status:'approved'|'rejected'|'disabled'){
    void act(async()=>{await rpc('gc_admin_review_room',{p_room_id:room.id,p_status:status});await loadAdminRooms();setNotice(status==='approved'?`${room.name} is now visible to ${room.college_name} students.`:status==='disabled'?`${room.name} has been paused.`:`${room.name} was rejected.`);});
  }
  const typingCount = group?.members.filter(m => m.user_id !== uid && m.typing_until && new Date(m.typing_until).getTime()>now).length ?? 0;
  const targets = group ? [...new Set([...group.members.map(m => m.user_id), ...group.messages.map(m => m.sender_id)])].filter(id => id !== uid) : [];
  return <section className={`groups-screen ${group ? 'in-group' : ''}`} aria-label="Group Chat">
    {!group ? <header className="groups-title"><button className="icon-button" aria-label="Back to dashboard" onClick={onBack}><ArrowLeft/></button><div><h1>{adminView?'Group Admin':'Group Chat'}</h1><p>{adminView?'Review and manage groups across every college.':'Find your people and join the conversation.'}</p></div><span className="groups-title-action"><MessageCircle size={18}/></span></header> : null}
    {blocked ? <div className="network-banner" role="status"><WifiOff size={16}/>{!online ? 'You’re offline. Messages are paused.' : 'Reconnecting to groups…'}<button onClick={() => void refresh()}>Retry</button></div> : null}
    {error ? <div className="feedback error" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss group error" onClick={() => setError('')}><X size={16}/></button></div> : null}
    {notice ? <div className="feedback notice" role="status"><span>{notice}</span><button className="icon-button" aria-label="Dismiss group notification" onClick={() => setNotice('')}><X size={16}/></button></div> : null}
    {!group ? <div className="room-list"><div className="room-intro"><span className="eyebrow">{adminView?'ALL COLLEGES':'FIND YOUR PEOPLE'}</span><h2>{adminView?'Manage campus groups.':'Pick your corner.'}</h2><p>{adminView?'Approve student proposals and manage active groups at every college.':collegeName?`Groups for ${collegeName} students.`:'Choose your college in Profile to see your campus groups.'}</p></div>
      {isAdmin?<div className="group-view-tabs"><button className={!adminView?'selected':''} onClick={()=>setAdminView(false)}>My college</button><button className={adminView?'selected':''} onClick={()=>setAdminView(true)}><ShieldCheck size={13}/>Admin · All colleges</button></div>:null}
      {adminView&&isAdmin?<><label className="group-search admin-group-search"><Search size={16}/><input aria-label="Search college groups" placeholder="Search every college’s groups…" value={search} onChange={e=>setSearch(e.target.value)}/></label><div className="admin-group-filters"><label id="admin-college-label">College<CollegePicker id="admin-college" label="Filter by college" colleges={colleges} value={collegeFilter} placeholder="All colleges" onChange={setCollegeFilter}/></label><label>Status<select aria-label="Filter groups by status" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>{['pending','approved','rejected','disabled','all'].map(item=><option key={item} value={item}>{item==='all'?'All statuses':item[0].toUpperCase()+item.slice(1)}</option>)}</select></label><button className="button secondary" onClick={()=>void loadAdminRooms()}>Refresh</button></div>{loading?<p className="room-loading">Loading groups…</p>:adminRooms.filter(room=>`${room.name} ${room.description} ${room.college_name??''}`.toLowerCase().includes(search.toLowerCase())).map(room=><article className="admin-group-card" key={room.id}><div className="admin-group-copy"><div><strong>{room.name}</strong><span className={`admin-status status-${room.status}`}>{room.status}</span></div><small><Building2 size={13}/>{room.college_name} · {room.member_count} active members</small><p>{room.description}</p></div><div className="admin-group-actions">{room.status!=='approved'?<button className="button primary" disabled={busy} onClick={()=>reviewRoom(room,'approved')}><Check size={15}/>{room.status==='disabled'?'Restore':'Approve'}</button>:<button className="button secondary" disabled={busy} onClick={()=>reviewRoom(room,'disabled')}>Pause</button>}{room.status==='pending'?<button className="button secondary" disabled={busy} onClick={()=>reviewRoom(room,'rejected')}>Reject</button>:null}</div></article>)}{!loading&&!adminRooms.length?<div className="room-no-results"><ShieldCheck size={22}/><strong>No groups in this view</strong><small>Try another college or status filter.</small></div>:null}</>:<>
      {!adminView?<><div className="group-list-toolbar"><label className="group-search"><Search size={16}/><input aria-label="Search groups" placeholder="Search groups…" value={search} onChange={e=>setSearch(e.target.value)}/></label><button className="button primary create-group-button" onClick={()=>setDialog('create')} disabled={!collegeName}><Users size={15}/>Create group</button></div><div className="group-filter-row" aria-label="Filter groups">{roomFilters.map(item=><button key={item} className={filter===item?'selected':''} onClick={()=>setFilter(item)}>{item}</button>)}</div>{loading ? <p className="room-loading" role="status">Finding your groups…</p> : shownRooms.map((room,index) => <article className={`room-card topic-${room.topic}`} key={room.id}><span className="room-icon"><span className="room-emoji">{topicIcon(room.topic)}</span></span><div className="room-card-copy"><div className="room-card-top"><h3>{room.name}</h3><time>{recentTime(room.last_message_at)}</time></div><p>{room.last_message||room.description}</p><small><Users size={12}/>{room.member_count} online <span>·</span> {room.capacity} max</small></div><button className="icon-button room-join" aria-label={`Join ${room.name}`} disabled={busy || !online || room.member_count>=room.capacity} onClick={() => join(room)}>{myRoomIds.includes(room.id)?<Check size={18}/>:<ArrowRight size={21}/>}</button>{index===0&&room.member_count>0?<i className="room-live-indicator" aria-label="Members are active"/>:null}</article>)}{!loading&&!shownRooms.length?<div className="room-no-results"><Users size={22}/><strong>{collegeName?'No groups found':'College selection needed'}</strong><small>{collegeName?'Try another search or group filter.':'Go to Profile, select your college, and save it to load its private group rooms.'}</small></div>:null}<p className="room-footnote"><ShieldCheck size={15}/>Only students assigned to {collegeName||'their own college'} can join these groups. Your identity stays anonymous.</p></>:null}</>}
      </div> : <section className="chat-area group-conversation" aria-label="Group conversation"><header className="chat-heading"><button className="icon-button" aria-label="Leave group" disabled={busy || sending} onClick={() => setDialog('leave')}><ArrowLeft size={21}/></button><span className="room-icon">{topicIcon(group.room.topic)}</span><div><h2>{group.room.name}</h2><button className="text-button member-summary" onClick={() => setDialog('members')}><Users size={12}/>{group.members.length} members · View members</button></div><button className="icon-button" aria-label="Group safety options" onClick={() => setDialog('members')}><ShieldCheck size={21}/></button></header>
      <div className="conversation-body"><div className="message-list" ref={list} role="log" aria-label="Group messages" onScroll={e => { const el=e.currentTarget; following.current=el.scrollHeight-el.scrollTop-el.clientHeight<80; if (following.current) setUnread(false); }}><div className="chat-start"><Hash size={23}/><strong>Welcome to {group.room.name}</strong><p>{group.room.description}<br/>Messages are temporary, not end-to-end encrypted.</p>{group.members.length === 1 ? <p className="empty-room">You’re the first one here. Others can join this room.</p> : null}</div>{group.messages.map(message => <div key={message.id} className={`message ${message.sender_id === uid ? 'mine' : 'theirs'}`}><button className="sender-label" disabled={message.sender_id === uid} onClick={() => { setTarget(message.sender_id); setDialog('safety'); }}>{message.sender_id === uid ? 'You' : alias(message.sender_id)}</button><span>{message.body}</span><time dateTime={message.created_at}>{time(message.created_at)}{message.sender_id === uid ? <Check size={12}/> : null}</time></div>)}{typingCount ? <div className="typing"><span className="dots"><i/><i/><i/></span>{typingCount === 1 ? 'Someone is typing…' : `${typingCount} people are typing…`}</div> : null}</div>{unread ? <button className="jump-latest" onClick={() => {following.current=true; setUnread(false); if (list.current) list.current.scrollTop=list.current.scrollHeight;}}><ArrowDown size={15}/>New messages</button> : null}</div>
      <div className="chat-composer"><form onSubmit={e => void send(e)}><label className="sr-only" htmlFor="group-message">Group message</label><input id="group-message" enterKeyHint="send" autoComplete="off" maxLength={2000} placeholder="Say hello to the group…" value={draft} onChange={e => type(e.target.value)} disabled={busy || blocked}/><button type="submit" className="send-button" aria-label={sending ? 'Sending group message' : 'Send group message'} onPointerDown={e => e.preventDefault()} disabled={busy || sending || blocked || !draft.trim()}><Send size={20}/></button></form><div className="chat-actions"><button className="button secondary" disabled={busy || sending} onClick={() => setDialog('leave')}><LogOut size={16}/>Leave group</button><span className="group-privacy"><ShieldCheck size={13}/>Anonymous · 18+</span><button className="icon-button" aria-label="Report or block a group member" onClick={() => setDialog('members')}><Flag size={18}/></button></div></div>
    </section>}
    {dialog ? <div className="modal-backdrop" onClick={e => { if (e.currentTarget === e.target && !busy) setDialog(null); }}><dialog open data-group-dialog className="modal" aria-modal="true" aria-labelledby="group-dialog-title"><div className="modal-heading"><h2 id="group-dialog-title">{dialog === 'members' ? 'People in this conversation' : dialog === 'safety' ? 'Keep the group safe' : dialog === 'create' ? 'Suggest a campus group' : 'Leave this group?'}</h2><button className="icon-button" aria-label="Close group dialog" disabled={busy} onClick={() => setDialog(null)}><X size={20}/></button></div>
      {dialog === 'create' ? <form className="group-create-form" onSubmit={submitRoom}><p>Your suggestion goes to CampusMate admins. Students at {collegeName||'your college'} can join after approval.</p><label htmlFor="new-group-name">Group name</label><input id="new-group-name" minLength={3} maxLength={48} required value={groupName} onChange={e=>setGroupName(e.target.value)} placeholder="e.g. Design & Art Club"/><label htmlFor="new-group-description">What is this group for?</label><textarea id="new-group-description" minLength={10} maxLength={240} required value={groupDescription} onChange={e=>setGroupDescription(e.target.value)} placeholder="Describe the conversations or activities…"/><label htmlFor="new-group-topic">Category</label><select id="new-group-topic" value={groupTopic} onChange={e=>setGroupTopic(e.target.value)}>{[['general','General'],['study','Study'],['department','Department'],['career','Career'],['events','Events'],['social','Social'],['music','Music'],['gaming','Gaming'],['life','Daily life'],['college','College']].map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><label htmlFor="new-group-capacity">Member limit</label><select id="new-group-capacity" value={groupCapacity} onChange={e=>setGroupCapacity(e.target.value)}>{['10','20','30','50','100'].map(value=><option key={value} value={value}>{value} members</option>)}</select><button className="button primary" type="submit" disabled={busy||!collegeName}>{busy?'Submitting…':'Submit for approval'}</button><small>All groups must follow the CampusMate Community Guidelines.</small></form>:null}
      {dialog === 'members' ? <div className="legal"><p>You’re {alias(uid)}. Tap a member to report or block them.</p><div className="member-list">{targets.length ? targets.map(id => <button key={id} onClick={() => {setTarget(id); setDialog('safety');}}><span className="member-avatar"><Users size={17}/></span><span>{alias(id)}<small>{group?.members.some(m => m.user_id === id) ? 'In this room' : 'Recently spoke'}</small></span><Flag size={16}/></button>) : <p>No other members yet. People will appear here when they join.</p>}</div></div> : null}
      {dialog === 'safety' ? <div className="legal"><p><strong>{alias(target)}</strong></p><p>Blocking leaves this group and prevents sharing a room with this identity. Reporting also saves up to 20 visible messages privately for review for up to 30 days.</p><label htmlFor="group-reason">Reason</label><select id="group-reason" value={reason} onChange={e => setReason(e.target.value)}><option value="harassment">Harassment or hate</option><option value="sexual_content">Sexual content or solicitation</option><option value="underage">Person appears under 18</option><option value="spam">Spam or scam</option><option value="other">Other safety concern</option></select><button className="button primary" disabled={busy} onClick={() => safety(true)}><Flag size={17}/>{busy ? 'Saving…' : 'Report and block'}</button><button className="button secondary" disabled={busy} onClick={() => safety(false)}><Ban size={17}/>Block without reporting</button><p className="micro">A person can create a new anonymous identity.</p></div> : null}
      {dialog === 'leave' ? <div className="legal"><p>You can join again later. You’ll see messages sent after you rejoin.</p><button className="button primary" disabled={busy || sending} onClick={leave}>{busy ? 'Leaving…' : 'Leave group'}</button><button className="button secondary" disabled={busy} onClick={() => setDialog(null)}>Stay in group</button></div> : null}
      {error ? <p className="modal-error" role="alert">{error}</p> : null}
    </dialog></div> : null}
  </section>;
}
