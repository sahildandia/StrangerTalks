import { ArrowRight, BookOpen, GraduationCap, ShieldCheck, Users } from 'lucide-react';
import { useState } from 'react';
import CampusMateLogo from './CampusMateLogo';

const slides = [
  { kicker: 'YOUR CAMPUS, YOUR PEOPLE', title: <>Meet.<br/><span>Explore.</span><br/>Grow.</>, body: 'Connect with college students, join communities, discover campus events and make real friends.', icon: GraduationCap },
  { kicker: 'FIND YOUR CIRCLE', title: <>Good chats.<br/><span>Good people.</span></>, body: 'Join a group, meet someone new, or find a study buddy who gets your goals.', icon: Users },
  { kicker: 'A KINDER CAMPUS', title: <>Be yourself.<br/><span>Stay safe.</span></>, body: 'Start as a guest in seconds. Your real name and contact details stay out of your chats.', icon: ShieldCheck },
];

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [page, setPage] = useState(0);
  const slide = slides[page];
  const Icon = slide.icon;
  return <section className="campus-onboarding" aria-label="Welcome to CampusMate">
    <div className="onboarding-top"><span className="campus-wordmark"><span className="campus-logo"><CampusMateLogo/></span>CampusMate</span><button className="onboarding-skip" onClick={onDone}>Skip</button></div>
    <div className="onboarding-copy"><span className="campus-eyebrow">{slide.kicker}</span><span className="onboarding-icon"><Icon size={26}/></span><h1>{slide.title}</h1><p>{slide.body}</p></div>
    <div className="onboarding-controls"><div className="onboarding-dots" aria-label={`Page ${page + 1} of ${slides.length}`}>{slides.map((item,index)=><button key={item.kicker} aria-label={`Go to page ${index+1}`} aria-current={index===page?'step':undefined} onClick={()=>setPage(index)}/>)}</div><button className="button primary onboarding-next" onClick={()=>page===slides.length-1?onDone():setPage(page+1)}>{page===slides.length-1?'Get started':'Continue'}<ArrowRight size={18}/></button></div>
  </section>;
}
