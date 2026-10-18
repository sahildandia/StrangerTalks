import { ArrowRight, ShieldCheck } from 'lucide-react';
import ChatArt from './ChatArt';

export default function Dashboard({ onRandom, onGroups, busy }: { onRandom: () => void; onGroups: () => void; busy: boolean }) {
  return <section className="dashboard" aria-label="Choose a conversation">
    <div className="dashboard-intro"><span className="eyebrow">YOUR SPACE TO CONNECT</span><h1>A new conversation<br/><span>starts here.</span></h1><p>Choose how you want to connect.</p></div>
    <div className="mode-grid">
      <article className="mode-card random-mode"><div className="mode-art-row"><ChatArt compact/><span className="mode-badge">1 : 1</span></div><h2>Random Chat</h2><p>Meet someone new, one-to-one.</p><button className="button primary" disabled={busy} onClick={onRandom}>Find a stranger<ArrowRight size={20}/></button></article>
      <article className="mode-card group-mode"><div className="mode-art-row"><ChatArt group compact/><span className="mode-badge">GC</span></div><h2>Group Chat</h2><p>Join a room. Find your people.</p><button className="button primary" disabled={busy} onClick={onGroups}>Explore groups<ArrowRight size={20}/></button></article>
    </div>
    <p className="dashboard-safety"><ShieldCheck size={17}/>Stay anonymous. Keep it kind.<span>18+ only</span></p>
  </section>;
}

