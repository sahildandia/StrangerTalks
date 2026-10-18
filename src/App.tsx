import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Ban, Check, Flag, Globe2, Heart, LockKeyhole, MessageCircle, MessageSquare, Moon, Send, ShieldCheck, Shuffle, Sparkles, Sun, Users, WifiOff, X } from 'lucide-react';
import { App as NativeApp } from '@capacitor/app';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { db, friendlyError, rpc, TERMS_VERSION, type ChatSession, type Message, type Snapshot } from './lib';
import { useViewport } from './useViewport';
import Dashboard from './Dashboard';
import GroupChat from './GroupChat';
import CampusEvents from './CampusEvents';
import Onboarding from './Onboarding';
import AuthScreen, { type AuthMode } from './AuthScreen';
import CampusMateLogo from './CampusMateLogo';

type Modal = 'settings' | 'privacy' | 'guidelines' | 'report' | 'end' | 'feature' | null;
type Screen = 'onboarding' | 'home' | 'dashboard' | 'groups' | 'events' | 'searching' | 'chat' | 'disconnected';
const support = import.meta.env.VITE_SUPPORT_EMAIL as string | undefined;
const time = (date: string) => new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function App() {
  useViewport();
  const [splash, setSplash] = useState(true);
  const [screen, setScreen] = useState<Screen>(() => localStorage.getItem('st-onboarding-v1') === 'done' ? 'home' : 'onboarding');
  const [modal, setModal] = useState<Modal>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [adminLaunch, setAdminLaunch] = useState(false);
  const [featureName, setFeatureName] = useState('');
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [uid, setUid] = useState('');
  const [displayName, setDisplayName] = useState('Student');
  const [profileName, setProfileName] = useState(() => localStorage.getItem('st-profile-name') ?? '');
  const [collegeName, setCollegeName] = useState(() => localStorage.getItem('st-college-name') ?? '');
  const [guest, setGuest] = useState(true);
  const [adult, setAdult] = useState(false);
  const [consent, setConsent] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaKey, setCaptchaKey] = useState(0);
  const [needsCaptcha, setNeedsCaptcha] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [connected, setConnected] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [reason, setReason] = useState('harassment');
  const [light, setLight] = useState(() => localStorage.getItem('st-theme') === 'light');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const engaged = useRef(false);
  const alive = useRef(true);
  const refreshing = useRef(false);
  const lastRefresh = useRef(0);
  const actionLock = useRef(false);
  const sessionRef = useRef<ChatSession | null>(null);
  const messageList = useRef<HTMLDivElement>(null);
  const followMessages = useRef(true);
  const [newMessages, setNewMessages] = useState(false);
  const chatParked = useRef(false);
  const lastTyping = useRef(0);
  const pendingMessage = useRef<{ body: string; nonce: string; sid: string } | null>(null);
  const generation = useRef(0);

  useEffect(() => { alive.current = true; const t = setTimeout(() => setSplash(false), 1200); return () => { alive.current = false; clearTimeout(t); }; }, []);
  useEffect(() => { document.documentElement.dataset.theme = light ? 'light' : 'dark'; localStorage.setItem('st-theme', light ? 'light' : 'dark'); }, [light]);
  useEffect(() => { if (Capacitor.isNativePlatform()) void SystemBars.setStyle({style:SystemBarsStyle.Dark}).catch(()=>{}); }, []);
  useEffect(() => {
    if (!error && !notice) return;
    const timer = window.setTimeout(() => { setError(''); setNotice(''); }, error ? 7000 : 4200);
    return () => window.clearTimeout(timer);
  }, [error, notice]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector('dialog');
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select,[tabindex="0"]') ?? []);
    focusable()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!busy) setModal(null); }
      if (event.key !== 'Tab') return;
      const items = focusable(); const first = items[0]; const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); previous?.focus(); };
  }, [modal, busy]);
  useEffect(() => {
    void db?.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      setUid(user?.id ?? ''); setGuest(!user || !!user.is_anonymous); setDisplayName(user?.email ?? 'Student');
      setNeedsCaptcha(!data.session && !!import.meta.env.VITE_HCAPTCHA_SITE_KEY);
    });
    const listener = db?.auth.onAuthStateChange((_event, authSession) => {
      const user = authSession?.user;
      setUid(user?.id ?? ''); setGuest(!user || !!user.is_anonymous); setDisplayName(user?.email ?? 'Student');
    });
    return () => listener?.data.subscription.unsubscribe();
  }, []);

  const apply = useCallback((snapshot: Snapshot) => {
    if (!alive.current || !engaged.current) return;
    if (sessionRef.current?.id !== snapshot.session?.id) { setMessages([]); setDraft(''); pendingMessage.current = null; followMessages.current = true; setNewMessages(false); }
    sessionRef.current = snapshot.session;
    setSession(snapshot.session);
    if (chatParked.current && snapshot.state === 'chat') return;
    if (chatParked.current) chatParked.current = false;
    setScreen(snapshot.state === 'chat' ? 'chat' : snapshot.state === 'waiting' ? 'searching' : 'disconnected');
  }, []);

  const loadMessages = useCallback(async (sid: string, gen: number) => {
    if (!db) return;
    const { data, error: readError } = await db.from('chat_messages').select('*').eq('session_id', sid).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(200);
    if (readError) throw readError;
    if (alive.current && engaged.current && gen === generation.current && sessionRef.current?.id === sid) setMessages((data as Message[]).reverse());
  }, []);

  const refresh = useCallback(async () => {
    if (!engaged.current || refreshing.current || actionLock.current || document.hidden || Date.now() - lastRefresh.current < 1000) return;
    refreshing.current = true;
    lastRefresh.current = Date.now();
    const gen = generation.current;
    try {
      const snapshot = await rpc<Snapshot>('st_heartbeat');
      if (gen !== generation.current) return;
      apply(snapshot);
      if (snapshot.session?.id && snapshot.state === 'chat') await loadMessages(snapshot.session.id, gen);
      setConnected(true);
    } catch (e) {
      if (gen === generation.current) {
        setConnected(false);
        if (/another tab|restricted|guidelines|JWT|expired|refresh token/i.test(friendlyError(e))) setError(friendlyError(e));
      }
    } finally { refreshing.current = false; }
  }, [apply, loadMessages]);

  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()); void refresh(); }, 3000);
    const net = () => { setOnline(navigator.onLine); if (navigator.onLine) void refresh(); };
    const visible = () => { if (!document.hidden) void refresh(); };
    window.addEventListener('online', net); window.addEventListener('offline', net); document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(timer); window.removeEventListener('online', net); window.removeEventListener('offline', net); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);

  useEffect(() => {
    if (!db || !session?.id || screen !== 'chat') return;
    const channel = db.channel(`conversation:${session.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `session_id=eq.${session.id}` }, payload => {
        const incoming = payload.new as Message;
        if (engaged.current && sessionRef.current?.id === incoming.session_id && !sessionRef.current.ended_at) {
          setMessages(previous => previous.some(m => m.id === incoming.id) ? previous : [...previous, incoming].sort((a,b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).slice(-200));
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_sessions', filter: `id=eq.${session.id}` }, payload => {
        const updated = payload.new as ChatSession;
        if (engaged.current && sessionRef.current?.id === updated.id) {
          sessionRef.current = updated; setSession(updated); setNow(Date.now());
          if (updated.ended_at) { chatParked.current = false; setScreen('disconnected'); }
        }
      })
      .subscribe();
    return () => { void db?.removeChannel(channel); };
  }, [session?.id, screen, refresh]);

  const latestMessage = messages.at(-1)?.id;
  useEffect(() => {
    const list = messageList.current;
    if (!list || screen !== 'chat') return;
    if (followMessages.current) list.scrollTop = list.scrollHeight;
    else if (latestMessage) setNewMessages(true);
  }, [latestMessage, screen]);
  useEffect(() => {
    const list = messageList.current;
    if (list && followMessages.current) list.scrollTop = list.scrollHeight;
  }, [session?.typing_a_until, session?.typing_b_until]);
  useEffect(() => {
    const list = messageList.current;
    if (!list) return;
    const observer = new ResizeObserver(() => {
      if (followMessages.current) list.scrollTop = list.scrollHeight;
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [screen]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handler = NativeApp.addListener('backButton', () => {
      if (modal) setModal(null);
      else if (screen === 'groups') window.dispatchEvent(new Event('st-group-back'));
      else if (screen === 'events') setScreen('dashboard');
      else if (screen === 'dashboard' && chatParked.current) setModal('end');
      else if (screen === 'dashboard') setScreen('home');
      else if (screen === 'chat' || screen === 'searching') setModal('end');
      else if (screen === 'disconnected') { engaged.current = false; setScreen('home'); }
      else if (screen === 'home') setScreen('onboarding');
      else if (screen === 'onboarding') void NativeApp.exitApp();
      else void NativeApp.exitApp();
    });
    return () => { void handler.then(h => h.remove()); };
  }, [modal, screen]);

  async function action(work: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true; generation.current++; setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (e) { setError(friendlyError(e)); }
    finally { actionLock.current = false; setBusy(false); }
  }
  function start() {
    void action(async () => {
      if (!adult || !consent) throw new Error('Confirm you are 18 or older and accept the guidelines to start.');
      if (!db) throw new Error('The app owner needs to connect Supabase before chatting is available.');
      const { data: authData, error: sessionError } = await db.auth.getSession();
      if (sessionError) throw sessionError;
      if (!authData.session) {
        const { data, error: authError } = await db.auth.signInAnonymously({ options: { captchaToken: captchaToken || undefined } });
        setCaptchaToken(''); setCaptchaKey(k => k + 1);
        if (authError) throw authError;
        setUid(data.user?.id ?? ''); setDisplayName('Student'); setGuest(true); setNeedsCaptcha(false);
      }
      await rpc('st_begin', { p_adult: true, p_terms_version: TERMS_VERSION });
      setScreen('dashboard'); setConnected(true);
    });
  }
  function authenticate(email: string, password: string, mode: AuthMode, college = '') {
    void action(async () => {
      if (!adult || !consent) throw new Error('Confirm you are 18 or older and accept the Community Guidelines and Privacy Policy.');
      if (!online) throw new Error('Connect to the internet before continuing.');
      if (!db) throw new Error('The app owner needs to connect Supabase before sign-in is available.');
      const captcha = captchaToken || undefined;
      const result = mode === 'register'
        ? await db.auth.signUp({ email, password, options: { captchaToken: captcha, data: { college_name: college } } })
        : await db.auth.signInWithPassword({ email, password, options: { captchaToken: captcha } });
      setCaptchaToken(''); setCaptchaKey(k => k + 1);
      if (result.error) throw result.error;
      if (mode === 'register' && !result.data.session) {
        throw new Error('Your account was created, but Supabase did not start a session. Email confirmation may still be enabled; try logging in or contact support.');
      }
      if (!result.data.user) throw new Error('Sign-in did not return a user. Please try again.');
      await rpc('st_begin', { p_adult: true, p_terms_version: TERMS_VERSION });
      const accountCollege = college || (typeof result.data.user.user_metadata?.college_name === 'string' ? result.data.user.user_metadata.college_name : '');
      if (accountCollege) { localStorage.setItem('st-college-name',accountCollege); setCollegeName(accountCollege); }
      setUid(result.data.user.id); setDisplayName(result.data.user.email ?? 'Student'); setGuest(false); setNeedsCaptcha(false); setScreen('dashboard');
    });
  }
  function finishOnboarding() { localStorage.setItem('st-onboarding-v1', 'done'); setScreen('home'); }
  function showFeature(name: string) { setFeatureName(name); setModal('feature'); }
  async function saveProfile(name: string, collegeId: string, college: string) {
    await rpc<string>('cm_set_my_college',{p_college_id:collegeId});
    localStorage.setItem('st-profile-name', name); localStorage.setItem('st-college-name', college);
    setProfileName(name); setCollegeName(college); setNotice('Profile and college saved. Your groups are now limited to your college.');
  }
  function logout() {
    void action(async () => {
      if (!db) throw new Error('Sign-out is unavailable right now. Please try again.');
      if (engaged.current) {
        try { await rpc('st_leave', { p_session_id: sessionRef.current?.id ?? null }); } catch { /* Sign out even if an offline chat cannot be closed immediately. */ }
      }
      const { error: signOutError } = await db.auth.signOut();
      if (signOutError) throw signOutError;
      generation.current++; engaged.current = false; chatParked.current = false;
      sessionRef.current = null; setSession(null); setMessages([]); setDraft(''); pendingMessage.current = null;
      localStorage.removeItem('st-profile-name'); localStorage.removeItem('st-college-name');
      setProfileName(''); setCollegeName(''); setUid(''); setDisplayName('Student'); setGuest(true);
      setScreen('home'); setModal(null); setError(''); setNotice('You have been logged out.');
    });
  }
  function changePassword(event: FormEvent) {
    event.preventDefault();
    void action(async () => {
      if (!db || guest) throw new Error('Sign in with an account to change its password.');
      if (newPassword.length < 8) throw new Error('Use at least 8 characters for your new password.');
      if (newPassword !== confirmPassword) throw new Error('The passwords do not match.');
      const { error: passwordError } = await db.auth.updateUser({ password: newPassword });
      if (passwordError) throw passwordError;
      setNewPassword(''); setConfirmPassword(''); setNotice('Your password has been changed.');
    });
  }
  function parkChat() {
    if (!sessionRef.current || sessionRef.current.ended_at) return;
    chatParked.current = true; setModal(null); setScreen('dashboard');
    setNotice('Conversation kept in Chats while it stays active. Leaving or choosing Next removes it from your list; server cleanup clears messages shortly after.');
  }
  function resumeChat() {
    if (!sessionRef.current || sessionRef.current.ended_at) { chatParked.current = false; setScreen('disconnected'); return; }
    chatParked.current = false; setScreen('chat'); setNotice(''); void refresh();
  }
  function startRandom() {
    void action(async () => {
      if (!collegeName) throw new Error('Choose your college in Profile before starting a random chat. Matches stay within your college.');
      if (engaged.current && sessionRef.current && !sessionRef.current.ended_at) {
        chatParked.current = false; setScreen('chat'); await loadMessages(sessionRef.current.id, generation.current); return;
      }
      await rpc('st_begin', { p_adult: true, p_terms_version: TERMS_VERSION });
      const snapshot = await rpc<Snapshot>('st_join');
      engaged.current = true; chatParked.current = false; apply(snapshot); setConnected(true);
      if (snapshot.state === 'chat' && snapshot.session) await loadMessages(snapshot.session.id, generation.current);
    });
  }
  function leave() {
    void action(async () => {
      await rpc('st_leave', { p_session_id: sessionRef.current?.id ?? null });
      chatParked.current = false;
      engaged.current = false; sessionRef.current = null; setSession(null); setMessages([]); setDraft(''); pendingMessage.current = null;
      setScreen('dashboard'); setModal(null);
    });
  }
  function next() {
    void action(async () => {
      chatParked.current = false;
      const snapshot = await rpc<Snapshot>('st_next', { p_session_id: sessionRef.current?.id ?? null });
      apply(snapshot); setConnected(true);
      if (snapshot.state === 'chat' && snapshot.session) await loadMessages(snapshot.session.id, generation.current);
    });
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim(); const current = sessionRef.current;
    if (!body || !current || sending || actionLock.current || current.ended_at) return;
    setSending(true); setError('');
    const pending = pendingMessage.current;
    const item = pending?.body === body && pending.sid === current.id ? pending : { body, nonce: crypto.randomUUID(), sid: current.id };
    pendingMessage.current = item;
    try {
      const message = await rpc<Message>('st_send', { p_session_id: current.id, p_body: item.body, p_nonce: item.nonce });
      if (sessionRef.current?.id === current.id) {
        followMessages.current = true; setNewMessages(false);
        setMessages(previous => previous.some(m => m.id === message.id) ? previous : [...previous, message].slice(-200));
        setDraft(currentDraft => currentDraft.trim() === item.body ? '' : currentDraft); pendingMessage.current = null;
      }
    } catch (e) { setError(friendlyError(e)); }
    finally { setSending(false); }
  }
  function type(value: string) {
    setDraft(value);
    if (!session || actionLock.current || Date.now() - lastTyping.current < 1500) return;
    lastTyping.current = Date.now();
    void rpc('st_typing', { p_session_id: session.id, p_typing: !!value.trim() }).catch(() => {});
  }
  function safety(report: boolean) {
    void action(async () => {
      if (!sessionRef.current) return;
      const id = await rpc<string | null>('st_safety', { p_session_id: sessionRef.current.id, p_reason: report ? reason : null });
      setNotice(report ? `Report saved${id ? ` · ${id.slice(0, 8)}` : ''}. This identity is blocked.` : 'This identity is blocked. You will not be matched with it again.');
      const snapshot = await rpc<Snapshot>('st_heartbeat'); apply(snapshot); setModal(null);
    });
  }
  const typingUntil = session ? session.user_a === uid ? session.typing_b_until : session.typing_a_until : null;
  const typing = !!typingUntil && new Date(typingUntil).getTime() > now && screen === 'chat';
  const broken = !online || !connected;

  if (splash) return <div className="splash campus-splash"><span className="brand-icon"><CampusMateLogo/></span><h1>Campus<span>Mate</span></h1><p>Your campus. Your community.</p><i className="splash-progress"/></div>;
  return <div className={`app-shell screen-${screen}`}>
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); if (screen === 'home') setModal(null); }}><span className="brand-icon"><CampusMateLogo/></span>CampusMate</a>
      <div className="side-main"><span className="eyebrow">A LITTLE HELLO CAN</span><h1>Open up<br />a whole<br /><em>new world.</em></h1><p>Different lives. Fresh perspectives.<br />One conversation at a time.</p><div className="orb-art" aria-hidden="true"><div className="orbit o1"/><div className="orbit o2"/><div className="planet"><Globe2 size={88} strokeWidth={1}/></div><span className="orbit-label label-a">hello <span>✦</span></span><span className="orbit-label label-b">नमस्ते</span><span className="orbit-label label-c">hola <Heart size={14}/></span><i className="star s1">✦</i><i className="star s2">✦</i></div></div>
      <div className="side-footer"><ShieldCheck size={17}/><span>Anonymous by design. Kindness by choice.</span></div>
    </aside>
    <main className="main-panel">
      {broken && engaged.current ? <div className="network-banner" role="status"><WifiOff size={16}/> Reconnecting… Messages are paused. Chats close after 75 seconds offline.<button onClick={() => void refresh()}>Retry</button></div> : null}
      {!online && (screen === 'home' || screen === 'dashboard') ? <div className="network-banner" role="status"><WifiOff size={16}/> You’re offline. Connect to the internet to start a conversation.</div> : null}
      {error ? <div className="feedback error" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16}/></button></div> : null}
      {notice ? <div className="feedback notice" role="status"><Check size={18}/><span>{notice}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16}/></button></div> : null}

      {screen === 'onboarding' ? <Onboarding onDone={finishOnboarding}/>:null}
      {screen === 'home' ? <AuthScreen mode={authMode} onModeChange={setAuthMode} onAuth={authenticate} onGuest={start} busy={busy} online={online} adult={adult} consent={consent} onAdultChange={setAdult} onConsentChange={setConsent} onPrivacy={()=>setModal('privacy')} onGuidelines={()=>setModal('guidelines')} needsCaptcha={needsCaptcha} captchaToken={captchaToken} captchaKey={captchaKey} onCaptcha={setCaptchaToken}/>:null}

      {screen === 'dashboard' ? <Dashboard name={displayName} guest={guest} busy={busy || !online} logoutBusy={busy} onRandom={startRandom} onFeature={showFeature} onOpenSettings={()=>setModal('settings')} onLogout={logout} onEvents={()=>{setAdminLaunch(false);setScreen('events');}} onAdmin={()=>{setAdminLaunch(true);setScreen('events');}} onGroups={() => { void action(async () => { await rpc('st_begin', { p_adult: true, p_terms_version: TERMS_VERSION }); setScreen('groups'); }); }} activeChat={chatParked.current && !!session && !session.ended_at} onResumeChat={resumeChat} onLeaveChat={leave} focusChats={chatParked.current} profileName={profileName} collegeName={collegeName} onSaveProfile={saveProfile}/>:null}
      {screen === 'groups' ? <GroupChat uid={uid} collegeName={collegeName} onBack={() => setScreen('dashboard')}/>:null}
      {screen === 'events' ? <CampusEvents uid={uid} collegeName={collegeName} openAdmin={adminLaunch} onBack={()=>{setAdminLaunch(false);setScreen('dashboard');}}/>:null}

      {screen === 'searching' ? <section className="center-state"><div className="search-art" aria-hidden="true"><div/><div/><span className="hero-icon"><Shuffle size={45}/></span></div><span className="pill">A new perspective is on its way</span><h2>Searching for<br /><span>a stranger…</span></h2><p>We’re looking for another available adult.<br />If nobody else is here, we’ll keep waiting.</p><div className="dots" aria-label="Searching"><i/><i/><i/></div><button className="button secondary" disabled={busy} onClick={leave}><X size={18}/> Cancel search</button><p className="micro">Only real people. No bots or simulated matches.</p></section> : null}

      {screen === 'chat' ? <section className="chat-area" aria-label="Live chat"><div className="chat-heading"><div className="stranger-avatar"><MessageCircle size={25}/><i/></div><div><h2>New stranger <Sparkles size={15}/></h2><p><i className={`status-dot ${broken ? 'muted' : ''}`}/>{broken ? 'Reconnecting' : 'Connected'} <span>· Anonymous text chat</span></p></div><button className="icon-button" aria-label="Report this stranger" onClick={() => setModal('report')}><Flag size={19}/></button></div>
        <div className="conversation-body"><div ref={messageList} className="message-list" role="log" aria-label="Conversation" onScroll={e => { const list = e.currentTarget; followMessages.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80; if (followMessages.current) setNewMessages(false); }}><div className="chat-start"><ShieldCheck size={22}/><strong>You’re connected. Say hello!</strong><p>Be respectful. Keep personal details private.<br />Temporary chat · Not end-to-end encrypted</p></div>{messages.map(message => <div key={message.id} className={`message ${message.sender_id === uid ? 'mine' : 'theirs'}`}><span>{message.body}</span><time dateTime={message.created_at}>{time(message.created_at)}{message.sender_id === uid ? <Check size={12}/> : null}</time></div>)}{typing ? <div className="typing"><div className="dots"><i/><i/><i/></div> Stranger is typing…</div> : null}</div>{newMessages ? <button className="jump-latest" onClick={() => { followMessages.current = true; setNewMessages(false); const list = messageList.current; if (list) list.scrollTop = list.scrollHeight; }}><ArrowDown size={15}/>New messages</button> : null}</div>
        <div className="chat-composer"><form onSubmit={e => void send(e)}><label className="sr-only" htmlFor="message">Message</label><input id="message" autoComplete="off" enterKeyHint="send" maxLength={2000} placeholder="Say something kind…" value={draft} onChange={e => type(e.target.value)} disabled={broken || busy}/><button className="send-button" type="submit" onPointerDown={e => e.preventDefault()} aria-label={sending ? 'Sending message' : 'Send message'} disabled={!draft.trim() || broken || busy || sending}><Send size={20}/></button></form><div className="chat-actions"><button className="button secondary" disabled={busy || broken || sending} onClick={next}><Shuffle size={17}/>Next stranger</button><button className="button secondary keep-chat-button" disabled={busy || sending || broken} onClick={parkChat}><MessageSquare size={16}/>Keep in Chats</button><button className="text-button end-button" disabled={busy || sending} onClick={() => setModal('end')}>End chat</button><button className="icon-button" disabled={busy} aria-label="Block this stranger" onClick={() => { setReason('other'); setModal('report'); }}><Ban size={17}/></button></div></div>
      </section> : null}

      {screen === 'disconnected' ? <section className="center-state"><div className="hero-icon"><MessageCircle size={45}/></div><span className="pill">Every hello is a new beginning</span><h2>This conversation<br /><span>has ended.</span></h2><p>{session?.end_reason === 'timeout' ? 'The connection timed out or reached its one-hour limit.' : 'Ready for another perspective?'}<br />Your next conversation is a tap away.</p><button className="button primary" disabled={busy || !online} onClick={next}><Shuffle size={18}/>Find a new stranger<ArrowRight size={18}/></button><button className="text-button" disabled={busy} onClick={() => { generation.current++; engaged.current = false; setScreen('home'); setError(''); setMessages([]); }}>Back to home</button>{session ? <button className="text-button" onClick={() => setModal('report')}><Flag size={14}/> Report or block last stranger</button> : null}</section> : null}
      <footer className="bottom-bar"><span><LockKeyhole size={13}/>No profiles. Just conversations.</span><button className="text-button" onClick={() => setModal('guidelines')}>Stay safe <ArrowUpRight size={13}/></button></footer>
    </main>

    {modal ? <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !busy) setModal(null); }}><dialog open className="modal" aria-modal="true" aria-labelledby="modal-title" onCancel={e => { e.preventDefault(); if (!busy) setModal(null); }}><div className="modal-heading"><h2 id="modal-title">{modal === 'settings' ? 'Make yourself at home' : modal === 'privacy' ? 'Your privacy matters' : modal === 'guidelines' ? 'A kinder corner of the internet' : modal === 'report' ? 'Keep the community safe' : modal === 'feature' ? featureName : 'End this conversation?'}</h2><button className="icon-button" disabled={busy} aria-label="Close dialog" onClick={() => setModal(null)}><X size={20}/></button></div>
      {modal === 'settings' ? <div className="settings-list"><p>A little space for a fresh perspective.</p><button onClick={() => setLight(v => !v)}>{light ? <Sun/> : <Moon/>}<span>Appearance<small>{light ? 'Light' : 'Midnight'} theme</small></span><span className="pill">Switch</span></button>{!guest ? <form className="settings-password" onSubmit={changePassword}><strong>Change password</strong><small>Use at least 8 characters.</small><label htmlFor="settings-new-password">New password</label><input id="settings-new-password" type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={e=>setNewPassword(e.target.value)} required/><label htmlFor="settings-confirm-password">Confirm new password</label><input id="settings-confirm-password" type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} required/><button className="button primary" type="submit" disabled={busy}>{busy?'Saving…':'Update password'}</button></form>:<p className="settings-guest-note">Sign in with an account to change a password.</p>}<button onClick={() => setModal('privacy')}><LockKeyhole/><span>Privacy policy<small>How your data is handled</small></span><ArrowRight size={18}/></button><button onClick={() => setModal('guidelines')}><ShieldCheck/><span>Community guidelines<small>Be kind. Stay safe.</small></span><ArrowRight size={18}/></button><div className="about"><CampusMateLogo/><strong>CampusMate</strong><p>Meet your people. Find your campus.</p><small>For adults 18+ · Student communities and chats</small></div></div> : null}
      {modal === 'privacy' ? <div className="legal"><p>Policy version {TERMS_VERSION}. You may create an account with an email address or continue as a guest with a random Supabase identity. Guest sessions are stored on this device. The service provider can process IP addresses and technical security logs. Anonymous does not mean untraceable.</p><h3>Temporary conversations</h3><p>Messages travel over encrypted connections (HTTPS/WSS), but are readable by the service operator. They are not end-to-end encrypted. Chats last at most one hour. When someone deliberately leaves or skips, ordinary messages disappear from the app immediately and server cleanup removes them shortly after. If a chat times out or the app closes unexpectedly, scheduled cleanup deletes them within about 11 minutes after the chat ends, or about 61 minutes after sending, whichever comes first. Ended session records last up to a day.</p><h3>Campus events</h3><p>Posters stay private until an event is approved. Approved event details, poster, and registration link are visible to signed-in students. Submitters can see their submission status and review note.</p><h3>Reports and blocks</h3><p>A report saves up to the last 20 messages as private evidence for up to 30 days. Only the operator can review reports. Blocked identity pairs and consent records are retained with your identity, which expires after 90 days of inactivity. Moderation action logs expire after 90 days. Provider logs and backups can follow separate provider retention schedules.</p><h3>Your device and choices</h3><p>Session credentials and appearance settings are stored in the app’s private device storage (browser storage on web). Clearing app data removes your guest identity and blocks on this device. Blocks and bans apply to an identity; a person can return with a new identity. No advertising or analytics SDK is included.</p><p>The 18+ confirmation is a self-attestation, not verified age. Do not send names, phone numbers, addresses, passwords, or sensitive information.</p><h3>Contact and deletion</h3><p>{support ? <>Contact <a href={`mailto:${support}`}>{support}</a> for privacy or safety requests. </> : 'No support email is configured. Use the in-chat Report and Block controls for safety concerns. '}Your anonymous reference: <code>{uid || 'Not signed in'}</code>. {support ? 'Include it in an owner request. ' : null}The app contains no automatic emergency response.</p><p><a href="https://supabase.com/privacy" target="_blank" rel="noreferrer">Supabase privacy information</a>. If CAPTCHA is enabled, hCaptcha also processes challenge data under <a href="https://www.hcaptcha.com/privacy" target="_blank" rel="noreferrer">its privacy policy</a>.</p></div> : null}
      {modal === 'guidelines' ? <div className="legal"><div className="safety-icon"><ShieldCheck/></div><p>CampusMate is for adults 18 and older. By continuing, you agree to these rules.</p><ul><li>Treat people with respect. No harassment, hate, threats, or bullying.</li><li>No sexual solicitation, exploitation, grooming, or content involving minors.</li><li>No scams, spam, links, or illegal activity.</li><li>Keep personal details private. Never send money or share your location.</li><li>If someone makes you uncomfortable, end the chat, report, and block them.</li></ul><p>Basic automated filters and message limits reduce some abuse; they cannot detect every harmful message. Reports go to the app operator for manual review. A report also blocks that anonymous identity.</p><p>If someone appears under 18, end and report the chat. If there is immediate danger, contact your local emergency services.</p>{support ? <p>Safety contact: <a href={`mailto:${support}`}>{support}</a></p> : null}</div> : null}
      {modal === 'report' ? <div className="legal"><p>Reporting sends up to the last 20 messages to the app owner for review, ends the chat, and blocks this anonymous identity.</p><label htmlFor="reason">Reason</label><select id="reason" value={reason} onChange={e => setReason(e.target.value)}><option value="harassment">Harassment or hate</option><option value="sexual_content">Sexual content or solicitation</option><option value="underage">Person appears under 18</option><option value="spam">Spam or scam</option><option value="other">Other safety concern</option></select><button className="button primary" disabled={busy} onClick={() => safety(true)}><Flag size={17}/>{busy ? 'Saving…' : 'Report and block'}</button><button className="button secondary" disabled={busy} onClick={() => safety(false)}><Ban size={17}/>Block without reporting</button><p className="micro">Blocking lasts for this anonymous identity. It cannot stop someone creating a new identity.</p></div> : null}
      {modal === 'end' ? <div className="legal"><p>{screen === 'searching' ? 'This will cancel your search or end a match if one was just found.' : 'The other person will be disconnected. You can start fresh whenever you like.'}</p><button className="button primary" disabled={busy || sending} onClick={leave}>{busy ? 'Ending…' : 'End and go home'}</button><button className="button secondary" disabled={busy} onClick={() => setModal(null)}>Keep chatting</button></div> : null}
      {modal === 'feature' ? <div className="legal"><div className="safety-icon"><Sparkles/></div><p><strong>{featureName}</strong> is coming soon to CampusMate. The dashboard preview is here while this feature is being prepared.</p><button className="button primary" onClick={()=>setModal(null)}>Got it</button></div> : null}
      {error ? <p className="modal-error" role="alert">{error}</p> : null}
    </dialog></div> : null}
  </div>;
}
