import { ArrowRight, ChevronDown, Eye, EyeOff, GraduationCap, LockKeyhole, Mail, Search } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import Captcha from './Captcha';
import { friendlyError, rpc } from './lib';

export type AuthMode = 'login' | 'register';
type CollegeOption = { id: string; name: string };
type Props = {
  mode: AuthMode; onModeChange: (mode: AuthMode) => void;
  onAuth: (email: string, password: string, mode: AuthMode, college?: string) => void; onGuest: () => void;
  busy: boolean; online: boolean; adult: boolean; consent: boolean;
  onAdultChange: (value: boolean) => void; onConsentChange: (value: boolean) => void;
  onPrivacy: () => void; onGuidelines: () => void;
  needsCaptcha: boolean; captchaToken: string; captchaKey: number; onCaptcha: (token: string) => void;
};

export default function AuthScreen(props: Props) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [showPassword, setShowPassword] = useState(false);
  const [colleges,setColleges]=useState<CollegeOption[]>([]); const [collegeId,setCollegeId]=useState(''); const [collegeLoading,setCollegeLoading]=useState(false);
  const [collegeOpen,setCollegeOpen]=useState(false); const [collegeSearch,setCollegeSearch]=useState('');
  const [requestName,setRequestName]=useState(''); const [requestBusy,setRequestBusy]=useState(false); const [collegeMessage,setCollegeMessage]=useState('');
  useEffect(()=>{if(props.mode!=='register')return;let active=true;setCollegeLoading(true);void rpc<CollegeOption[]>('cm_list_colleges').then(data=>{if(active)setColleges(Array.isArray(data)?data:[]);}).catch(error=>{if(active)setCollegeMessage(`College list is unavailable: ${friendlyError(error)}`);}).finally(()=>{if(active)setCollegeLoading(false);});return()=>{active=false;};},[props.mode]);
  const selectedCollege=colleges.find(item=>item.id===collegeId)?.name??'';
  const filteredColleges=colleges.filter(item=>item.name.toLowerCase().includes(collegeSearch.trim().toLowerCase()));
  function submit(event: FormEvent) { event.preventDefault(); props.onAuth(email.trim(), password, props.mode, selectedCollege); }
  async function requestCollege(){setCollegeMessage('');setRequestBusy(true);try{await rpc('cm_request_college',{p_name:requestName});setCollegeMessage('Request sent for admin review. You can select the college after it is approved.');setRequestName('');}catch(error){setCollegeMessage(friendlyError(error));}finally{setRequestBusy(false);}}
  const enabled = props.adult && props.consent && props.online && !props.busy && (!props.needsCaptcha || !!props.captchaToken) && (props.mode!=='register'||!!collegeId);
  return <section className="auth-screen" aria-label={props.mode === 'login' ? 'Log in' : 'Create account'}>
    <header className="auth-brand"><span className="auth-brand-image"><img src="/campusmate-logo.png" alt=""/></span><span>CampusMate<small>Your campus. Your community.</small></span></header>
    <div className="auth-card">
      <div className="auth-tabs" role="tablist" aria-label="Login or register"><button role="tab" aria-selected={props.mode==='login'} onClick={()=>props.onModeChange('login')}>Log in</button><button role="tab" aria-selected={props.mode==='register'} onClick={()=>props.onModeChange('register')}>Register</button></div>
      <div className="auth-heading"><span className="campus-eyebrow">WELCOME TO YOUR CAMPUS</span><h1>{props.mode==='login'?'Good to see you.':'Meet your people.'}</h1><p>{props.mode==='login'?'Log in and pick up where you left off.':'Create an account, or jump in as a guest.'}</p></div>
      <form className="auth-form" onSubmit={submit}>
        <label htmlFor="auth-email">College or personal email</label><div className="auth-input-wrap"><Mail size={17}/><input id="auth-email" type="email" autoComplete="email" placeholder="you@college.edu" value={email} onChange={e=>setEmail(e.target.value)} required maxLength={254}/></div>
        <label htmlFor="auth-password">Password</label><div className="auth-input-wrap"><LockKeyhole size={17}/><input id="auth-password" type={showPassword?'text':'password'} autoComplete={props.mode==='register'?'new-password':'current-password'} placeholder={props.mode==='register'?'At least 8 characters':'Your password'} value={password} onChange={e=>setPassword(e.target.value)} required minLength={8} maxLength={72}/><button type="button" className="password-toggle" aria-label={showPassword?'Hide password':'Show password'} onClick={()=>setShowPassword(v=>!v)}>{showPassword?<EyeOff size={17}/>:<Eye size={17}/>}</button></div>
        {props.mode==='register'?<div className="college-registration"><label id="auth-college-label">Your college</label><div className="college-picker"><button id="auth-college" className="college-picker-trigger" type="button" aria-labelledby="auth-college-label" aria-haspopup="listbox" aria-expanded={collegeOpen} aria-controls="auth-college-options" onClick={()=>setCollegeOpen(value=>!value)}><GraduationCap size={17}/><span>{selectedCollege|| (collegeLoading?'Loading colleges…':colleges.length?'Select your college':'No colleges listed yet')}</span><ChevronDown size={16}/></button>{collegeOpen?<div className="college-picker-menu"><label className="college-picker-search"><Search size={15}/><input type="search" aria-label="Search colleges" placeholder="Search colleges…" value={collegeSearch} onChange={e=>setCollegeSearch(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setCollegeOpen(false);}}/></label><div className="college-picker-options" id="auth-college-options" role="listbox" aria-labelledby="auth-college-label">{filteredColleges.map(item=><button type="button" role="option" aria-selected={item.id===collegeId} className={item.id===collegeId?'selected':''} key={item.id} onClick={()=>{setCollegeId(item.id);setCollegeOpen(false);setCollegeSearch('');}}>{item.name}</button>)}{!filteredColleges.length?<p role="status">{collegeLoading?'Loading colleges…':'No matching colleges. You can request it below.'}</p>:null}</div></div>:null}</div><input type="hidden" name="college_id" value={collegeId}/><div className="college-request"><label htmlFor="college-request-name">Can’t find your college?</label><div><input id="college-request-name" value={requestName} maxLength={120} placeholder="Enter college name" onChange={e=>setRequestName(e.target.value)}/><button className="button secondary" type="button" disabled={!requestName.trim()||requestBusy||!props.online} onClick={()=>void requestCollege()}>{requestBusy?'Sending…':'Request'}</button></div>{collegeMessage?<p role="status">{collegeMessage}</p>:null}</div></div>:null}
        {props.mode==='register'?<p className="auth-hint">Use 8 or more characters. Your email is used to sign in.</p>:null}
        <label className="auth-consent"><input type="checkbox" checked={props.adult} onChange={e=>props.onAdultChange(e.target.checked)}/><span>I confirm that I am <strong>18 or older</strong>.</span></label>
        <label className="auth-consent"><input type="checkbox" checked={props.consent} onChange={e=>props.onConsentChange(e.target.checked)}/><span>I agree to the <button type="button" className="text-button" onClick={props.onGuidelines}>Community Guidelines</button> and <button type="button" className="text-button" onClick={props.onPrivacy}>Privacy Policy</button>.</span></label>
        {props.needsCaptcha?<Captcha key={props.captchaKey} onToken={props.onCaptcha}/>:null}
        <button className="button primary auth-submit" type="submit" disabled={!enabled}>{props.busy?'Please wait…':props.mode==='login'?'Log in with email':'Create account'}<ArrowRight size={18}/></button>
      </form>
      <div className="auth-divider"><span/>OR<span/></div>
      <button className="button guest-button" disabled={props.busy||!props.online||!props.adult||!props.consent||(props.needsCaptcha&&!props.captchaToken)} onClick={props.onGuest}><GraduationCap size={19}/>{props.busy?'Starting guest session…':'Continue as Guest'}<ArrowRight size={18}/></button>
      <p className="auth-privacy"><LockKeyhole size={13}/> Guest mode needs no email, phone, or password.</p>
    </div>
    <p className="auth-footer">18+ only <span>·</span> Be kind. Stay safe.</p>
  </section>;
}
