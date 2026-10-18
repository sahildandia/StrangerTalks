import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowUpRight, CalendarDays, Check, Clock3, ExternalLink, Filter, GraduationCap, MapPin, Plus, RefreshCw, ShieldCheck, Ticket, Upload, Users, X } from 'lucide-react';
import { db, friendlyError, rpc } from './lib';

type CampusEvent = {
  id: string; submitted_by: string; title: string; organizer: string; category: string; event_date: string;
  start_time: string; end_time: string | null; venue: string; description: string; registration_url: string;
  poster_path: string; audience: 'intra_college'|'inter_college'; college_id: string|null; status: 'pending' | 'approved' | 'rejected'; review_note: string | null; created_at: string;
};
type College = { id: string; name: string; is_active?: boolean; created_at?: string };
type CollegeRequest = { id: string; name: string; status: 'pending' | 'approved' | 'rejected'; review_note: string | null; created_at: string };
type View = 'discover' | 'mine' | 'admin';
type AdminFilter = 'all' | 'pending' | 'approved' | 'rejected';
const categories = ['Technical','Cultural','Workshop','Career','Social','Other'];
const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'});
const timeLabel = (time: string) => new Date(`2000-01-01T${time}`).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});

export default function CampusEvents({uid,collegeName,openAdmin,onBack}:{uid:string;collegeName:string;openAdmin:boolean;onBack:()=>void}) {
  const [view,setView]=useState<View>(openAdmin?'admin':'discover'); const [events,setEvents]=useState<CampusEvent[]>([]);
  const [posters,setPosters]=useState<Record<string,string>>({}); const [isAdmin,setIsAdmin]=useState(false);
  const [loading,setLoading]=useState(true); const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [notice,setNotice]=useState(''); const [selectedEvent,setSelectedEvent]=useState<CampusEvent|null>(null);
  const [colleges,setColleges]=useState<College[]>([]); const [collegeRequests,setCollegeRequests]=useState<CollegeRequest[]>([]); const [collegeToAdd,setCollegeToAdd]=useState(''); const [collegeError,setCollegeError]=useState('');
  const [category,setCategory]=useState('All'); const [query,setQuery]=useState(''); const [showForm,setShowForm]=useState(false); const [adminFilter,setAdminFilter]=useState<AdminFilter>('pending'); const [adminPage,setAdminPage]=useState<'events'|'colleges'>('events');
  const [title,setTitle]=useState(''); const [organizer,setOrganizer]=useState(''); const [eventCategory,setEventCategory]=useState('Technical');
  const [eventDate,setEventDate]=useState(''); const [startTime,setStartTime]=useState('09:00'); const [endTime,setEndTime]=useState('17:00');
  const [venue,setVenue]=useState(''); const [description,setDescription]=useState(''); const [registrationUrl,setRegistrationUrl]=useState(''); const [audience,setAudience]=useState<'intra_college'|'inter_college'>(collegeName?'intra_college':'inter_college');
  const [poster,setPoster]=useState<File|null>(null); const [reviewNote,setReviewNote]=useState<Record<string,string>>({});

  const load=useCallback(async(nextView:View=view)=>{
    setLoading(true);setError('');
    try{
      const admin=await rpc<boolean>('ce_is_admin');setIsAdmin(admin);
      const data=await rpc<CampusEvent[]>(nextView==='mine'?'ce_my_events':nextView==='admin'?'ce_admin_events':'ce_list');
      setEvents(data??[]);
      if(nextView==='admin'){
        try{const [collegeData,requestData]=await Promise.all([rpc<College[]>('cm_admin_colleges'),rpc<CollegeRequest[]>('cm_admin_college_requests')]);setColleges(collegeData??[]);setCollegeRequests(requestData??[]);setCollegeError('');}
        catch(err){setCollegeError(friendlyError(err));}
      }
      const signed=await Promise.all((data??[]).map(async event=>{
        if(!db)return [event.id,''] as const;
        const {data:link}=await db.storage.from('event-posters').createSignedUrl(event.poster_path,3600);
        return [event.id,link?.signedUrl??''] as const;
      }));
      setPosters(Object.fromEntries(signed));
    }catch(e){setError(friendlyError(e));}finally{setLoading(false);}
  },[view]);
  useEffect(()=>{void load(view);},[load,view]);

  const stats=useMemo(()=>({total:events.length,pending:events.filter(e=>e.status==='pending').length,approved:events.filter(e=>e.status==='approved').length,rejected:events.filter(e=>e.status==='rejected').length}),[events]);
  const visible=useMemo(()=>events.filter(event=>
    (view==='admin'?(adminFilter==='all'||event.status===adminFilter):(category==='All'||event.category===category))&&`${event.title} ${event.organizer} ${event.venue} ${event.description}`.toLowerCase().includes(query.toLowerCase())
  ),[events,category,query,view,adminFilter]);

  async function submit(e:FormEvent){
    e.preventDefault();if(!poster||!db){setError('Choose a poster image before submitting.');return;}
    if(poster.size>5*1024*1024){setError('Poster must be 5 MB or smaller.');return;}
    if(!['image/jpeg','image/png','image/webp'].includes(poster.type)){setError('Use a JPG, PNG, or WebP poster image.');return;}
    setBusy(true);setError('');setNotice('');let path='';
    try{
      const extension=poster.type==='image/jpeg'?'jpg':poster.type==='image/png'?'png':'webp';
      path=`${uid}/${crypto.randomUUID()}.${extension}`;
      const {error:uploadError}=await db.storage.from('event-posters').upload(path,poster,{contentType:poster.type,upsert:false});
      if(uploadError)throw uploadError;
      await rpc('ce_submit',{p_title:title,p_organizer:organizer,p_category:eventCategory,p_event_date:eventDate,p_start_time:startTime,p_end_time:endTime||null,p_venue:venue,p_description:description,p_registration_url:registrationUrl,p_poster_path:path,p_audience:audience});
      setShowForm(false);setTitle('');setOrganizer('');setVenue('');setDescription('');setRegistrationUrl('');setPoster(null);setNotice('Event submitted. It will appear in Campus Events after an admin approves it.');
      setView('mine');await load('mine');
    }catch(err){if(path)await db.storage.from('event-posters').remove([path]);setError(friendlyError(err));}
    finally{setBusy(false);}
  }
  async function review(event:CampusEvent,status:'approved'|'rejected'){
    setBusy(true);setError('');setNotice('');
    try{await rpc('ce_review',{p_event_id:event.id,p_status:status,p_note:reviewNote[event.id]??null});setNotice(status==='approved'?'Event approved and visible to students.':'Event rejected. The submitter can see the review status.');if(selectedEvent?.id===event.id)setSelectedEvent({...event,status,review_note:reviewNote[event.id]??null});await load('admin');}
    catch(err){setError(friendlyError(err));}finally{setBusy(false);}
  }
  async function addCollege(e:FormEvent){e.preventDefault();setBusy(true);setCollegeError('');setNotice('');try{await rpc('cm_admin_add_college',{p_name:collegeToAdd});setCollegeToAdd('');setNotice('College added to the registration list.');await load('admin');}catch(err){setCollegeError(friendlyError(err));}finally{setBusy(false);}}
  async function reviewCollege(request:CollegeRequest,status:'approved'|'rejected'){setBusy(true);setCollegeError('');try{await rpc('cm_review_college_request',{p_request_id:request.id,p_status:status});setNotice(status==='approved'?`${request.name} was added to the college list.`:`${request.name} request was declined.`);await load('admin');}catch(err){setCollegeError(friendlyError(err));}finally{setBusy(false);}}
  return <section className="campus-events-screen" aria-label="Campus Events">
    <header className="events-page-header"><button className="icon-button" aria-label={selectedEvent?'Back to events':'Back to dashboard'} onClick={()=>selectedEvent?setSelectedEvent(null):onBack()}><ArrowLeft/></button><div><span className="campus-eyebrow">{selectedEvent?'EVENT DETAILS':view==='admin'?'ADMIN WORKSPACE':'CAMPUS LIFE'}</span><h1>{selectedEvent?'Event Details':view==='admin'?'Event Admin Dashboard':'Campus Events'}</h1></div><span className="events-header-mark">{selectedEvent?<CalendarDays size={19}/>:view==='admin'?<ShieldCheck size={19}/>:<CalendarDays size={19}/>}</span></header>
    {error?<div className="events-feedback events-error" role="alert">{error}<button className="icon-button" aria-label="Dismiss" onClick={()=>setError('')}><X size={16}/></button></div>:null}
    {notice?<div className="events-feedback events-notice" role="status"><Check size={16}/>{notice}<button className="icon-button" aria-label="Dismiss" onClick={()=>setNotice('')}><X size={16}/></button></div>:null}
    {selectedEvent?<div className="event-detail-view"><div className="event-detail-scroll"><div className="event-detail-poster">{posters[selectedEvent.id]?<img src={posters[selectedEvent.id]} alt={`${selectedEvent.title} poster`}/>:<span><CalendarDays size={38}/></span>}</div><div className="event-detail-content"><div className="event-detail-title-row"><div><h2>{selectedEvent.title}</h2><p className="event-organizer">✦ {selectedEvent.organizer}</p></div><span className={`event-status status-${selectedEvent.status}`}>{selectedEvent.status==='pending'?'Under review':selectedEvent.status==='approved'?'Approved':'Needs changes'}</span></div><p className={`event-audience ${selectedEvent.audience}`}>{selectedEvent.audience==='intra_college'?`Intra-college · ${collegeName||'your college only'}`:'Inter-college · open to all colleges'}</p><p className="event-detail-meta"><CalendarDays size={16}/>{dateLabel(selectedEvent.event_date)}</p><p className="event-detail-meta"><Clock3 size={16}/>{timeLabel(selectedEvent.start_time)}{selectedEvent.end_time?` – ${timeLabel(selectedEvent.end_time)}`:''}</p><p className="event-detail-meta"><MapPin size={16}/>{selectedEvent.venue}</p><section className="event-detail-description"><h3>Description</h3><p>{selectedEvent.description}</p></section>{selectedEvent.review_note?<p className="event-review-note">Admin note: {selectedEvent.review_note}</p>:null}{view==='admin'&&selectedEvent.status==='pending'?<div className="event-admin-review"><textarea aria-label={`Review note for ${selectedEvent.title}`} maxLength={300} placeholder="Optional note to the organizer" value={reviewNote[selectedEvent.id]??''} onChange={e=>setReviewNote(v=>({...v,[selectedEvent.id]:e.target.value}))}/><div><button className="button secondary" disabled={busy} onClick={()=>void review(selectedEvent,'rejected')}><X size={15}/>Reject</button><button className="button primary" disabled={busy} onClick={()=>void review(selectedEvent,'approved')}><Check size={15}/>Approve</button></div></div>:null}</div></div><div className="event-detail-bottom">{selectedEvent.status==='approved'?<a className="button primary event-register" href={selectedEvent.registration_url} target="_blank" rel="noopener noreferrer"><Ticket size={17}/>Register Now<ExternalLink size={15}/></a>:selectedEvent.status==='pending'?<p className="event-pending-note"><Clock3 size={14}/>Waiting for admin approval</p>:<p className="event-review-note">This event is not open for registration.</p>}</div></div>:<>
    <div className="events-toolbar"><label className="events-search"><span className="sr-only">Search events</span><Filter size={16}/><input placeholder={view==='admin'?'Search submissions…':'Search events…'} value={query} onChange={e=>setQuery(e.target.value)}/></label>{view!=='admin'?<button className="button primary events-submit-button" onClick={()=>setShowForm(v=>!v)}><Plus size={17}/>{showForm?'Close':'Submit event'}</button>:<button className="button secondary events-submit-button" disabled={loading} onClick={()=>void load('admin')}><RefreshCw size={15}/>Refresh</button>}</div>
    {showForm?<form className="event-submit-form" onSubmit={submit}>
      <div className="event-form-heading"><span className="campus-eyebrow">SHARE SOMETHING ON CAMPUS</span><h2>Submit an event</h2><p>Students will see it after an admin reviews and approves it.</p></div>
      <div className="event-form-grid"><label>Event name<input required minLength={3} maxLength={90} value={title} onChange={e=>setTitle(e.target.value)} placeholder="TechnoFest 2026"/></label><label>Organizer<input required minLength={2} maxLength={90} value={organizer} onChange={e=>setOrganizer(e.target.value)} placeholder="Department of CSE"/></label>
      <label>Category<select value={eventCategory} onChange={e=>setEventCategory(e.target.value)}>{categories.map(c=><option key={c}>{c}</option>)}</select></label><label>Date<input required type="date" min={new Date().toISOString().slice(0,10)} value={eventDate} onChange={e=>setEventDate(e.target.value)}/></label>
      <label>Starts<input required type="time" value={startTime} onChange={e=>setStartTime(e.target.value)}/></label><label>Ends<input type="time" value={endTime} onChange={e=>setEndTime(e.target.value)}/></label>
      <label className="event-form-full">Venue<input required minLength={2} maxLength={120} value={venue} onChange={e=>setVenue(e.target.value)} placeholder="Main Block, MKCE"/></label>
      <label className="event-form-full">Description<textarea required minLength={20} maxLength={2000} rows={4} value={description} onChange={e=>setDescription(e.target.value)} placeholder="What will students experience at this event?"/></label>
      <label className="event-form-full">Registration link<input required type="url" pattern="https://.*" value={registrationUrl} onChange={e=>setRegistrationUrl(e.target.value)} placeholder="https://example.com/register"/><small>Use a secure https:// link. Register Now opens this page.</small></label>
      <label className="event-form-full">Who can see this event?<select value={audience} onChange={e=>setAudience(e.target.value as 'intra_college'|'inter_college')}><option value="intra_college">Intra-college · only {collegeName||'my college'}</option><option value="inter_college">Inter-college · students from all colleges</option></select><small>Inter-college events appear to students at every listed college.</small></label>
      <label className="event-poster-upload event-form-full"><Upload size={19}/><span>{poster?poster.name:'Upload event poster'}<small>JPG, PNG, or WebP · Up to 5 MB</small></span><input required type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setPoster(e.target.files?.[0]??null)}/></label></div>
      <button className="button primary campus-wide-action" disabled={busy}>{busy?'Submitting…':'Submit for approval'}<ArrowUpRight size={17}/></button>
    </form>:null}
    <nav className="event-view-tabs" aria-label="Event views"><button className={view==='discover'?'selected':''} onClick={()=>setView('discover')}>Discover</button><button className={view==='mine'?'selected':''} onClick={()=>setView('mine')}>My Submissions</button>{isAdmin?<button className={view==='admin'?'selected':''} onClick={()=>{setShowForm(false);setAdminFilter('pending');setAdminPage('events');setView('admin');}}><ShieldCheck size={14}/>Admin Dashboard</button>:null}</nav>
    {view==='admin'?<nav className="college-admin-tabs" aria-label="Admin tools"><button className={adminPage==='events'?'selected':''} onClick={()=>setAdminPage('events')}><CalendarDays size={14}/>Events</button><button className={adminPage==='colleges'?'selected':''} onClick={()=>setAdminPage('colleges')}><GraduationCap size={14}/>Colleges</button></nav>:null}
    {view==='admin'&&adminPage==='events'?<section className="event-admin-dashboard" aria-label="Event moderation dashboard"><div className="event-admin-intro"><div><span className="campus-eyebrow">MODERATION CONTROL</span><h2>Review campus events</h2><p>Approve events that are ready for students or reject submissions that need changes.</p></div><span className="event-admin-badge"><ShieldCheck size={14}/>Admin access active</span></div><div className="event-admin-stats">{([{id:'all',label:'All events',count:stats.total},{id:'pending',label:'Pending',count:stats.pending},{id:'approved',label:'Approved',count:stats.approved},{id:'rejected',label:'Rejected',count:stats.rejected}] as const).map(item=><button key={item.id} className={`event-admin-stat ${adminFilter===item.id?'selected':''} ${item.id}`} aria-pressed={adminFilter===item.id} onClick={()=>setAdminFilter(item.id)}><span>{item.label}</span><strong>{item.count}</strong></button>)}</div></section>:null}
    {view==='admin'&&adminPage==='colleges'?<section className="college-admin-panel" aria-label="College directory management"><div className="event-admin-intro"><div><span className="campus-eyebrow">REGISTRATION DIRECTORY</span><h2>Manage colleges</h2><p>Add a college directly or review requests from students.</p></div><span className="event-admin-badge"><GraduationCap size={14}/>{colleges.filter(college=>college.is_active!==false).length} listed</span></div>{collegeError?<p className="college-admin-error" role="alert">{collegeError}</p>:null}<form className="college-add-form" onSubmit={addCollege}><label htmlFor="college-name-admin">Add a college</label><div><input id="college-name-admin" maxLength={120} required value={collegeToAdd} onChange={e=>setCollegeToAdd(e.target.value)} placeholder="Official college name"/><button className="button primary" disabled={busy}><Plus size={16}/>{busy?'Adding…':'Add college'}</button></div></form><section className="college-admin-list"><h3>Available colleges</h3>{colleges.length?colleges.filter(college=>college.is_active!==false).map(college=><div className="college-admin-item" key={college.id}><GraduationCap size={15}/><span>{college.name}</span><small>Available</small></div>):<p className="college-admin-empty">No colleges added yet.</p>}</section><section className="college-admin-list"><h3>Student requests</h3>{collegeRequests.length?collegeRequests.map(request=><article className="college-request-admin" key={request.id}><div><strong>{request.name}</strong><small>{request.status==='pending'?'Waiting for review':request.status==='approved'?'Approved':'Declined'}</small></div>{request.status==='pending'?<div><button className="button secondary" disabled={busy} onClick={()=>void reviewCollege(request,'rejected')}>Decline</button><button className="button primary" disabled={busy} onClick={()=>void reviewCollege(request,'approved')}><Check size={14}/>Approve</button></div>:null}</article>):<p className="college-admin-empty">No college requests yet.</p>}</section></section>:null}
    {view==='discover'?<div className="event-category-row" aria-label="Filter events">{['All',...categories].map(item=><button key={item} className={category===item?'selected':''} onClick={()=>setCategory(item)}>{item}</button>)}</div>:null}
    {view!=='admin'||adminPage==='events'?<><div className="event-feed" aria-live="polite">
      {loading?<p className="event-empty-state">Loading events…</p>:visible.length?visible.map(event=><article className="campus-event-card" key={event.id}>
        <button className="campus-event-open" onClick={()=>setSelectedEvent(event)} aria-label={`View event ${event.title}`}><div className="campus-event-poster">{posters[event.id]?<img src={posters[event.id]} alt={`${event.title} poster`}/>:<span><CalendarDays size={32}/></span>}</div><div className="campus-event-content"><div className="event-card-topline"><span className={`event-status status-${event.status}`}>{event.status==='pending'?'Under review':event.status==='approved'?'Approved':'Needs changes'}</span><span className="event-category-pill">{event.category}</span></div><h2>{event.title}</h2><p className="event-organizer">✦ {event.organizer}</p><p className="event-meta"><CalendarDays size={14}/>{dateLabel(event.event_date)}<span>·</span><Clock3 size={14}/>{timeLabel(event.start_time)}{event.end_time?` – ${timeLabel(event.end_time)}`:''}</p><p className="event-meta"><MapPin size={14}/>{event.venue}</p><p className="event-card-hint">Tap to view event details <ArrowUpRight size={13}/></p></div></button>
        <p className={`event-audience ${event.audience}`}>{event.audience==='intra_college'?`Intra-college · ${collegeName||'your college only'}`:'Inter-college · open to all colleges'}</p>
        {view==='admin'&&event.status==='pending'?<div className="event-admin-review"><textarea aria-label={`Review note for ${event.title}`} maxLength={300} placeholder="Optional note to the organizer" value={reviewNote[event.id]??''} onChange={e=>setReviewNote(v=>({...v,[event.id]:e.target.value}))}/><div><button className="button secondary" disabled={busy} onClick={()=>void review(event,'rejected')}><X size={15}/>Reject</button><button className="button primary" disabled={busy} onClick={()=>void review(event,'approved')}><Check size={15}/>Approve</button></div></div>:null}
      </article>):<div className="event-empty-state"><span><CalendarDays size={26}/></span><strong>{view==='admin'?(adminFilter==='all'?'No event submissions':`No ${adminFilter} submissions`):view==='mine'?'No submissions yet':'No upcoming events yet'}</strong><small>{view==='admin'?'New submissions will appear here as students share campus events.':view==='mine'?'Submit a campus event and track its review here.':'When an admin approves student events, they will appear here.'}</small>{view==='discover'?<button className="button secondary" onClick={()=>setShowForm(true)}><Plus size={16}/>Submit an event</button>:null}</div>}
    </div>
    <p className="events-privacy"><Users size={14}/>Events are checked by an admin before appearing in Discover. Registration links open directly.</p>
    </>:null}
    </>}
  </section>;
}
