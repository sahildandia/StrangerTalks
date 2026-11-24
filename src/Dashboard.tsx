import { ArrowRight, Mars, Venus } from 'lucide-react';

export default function Dashboard({ onSelectGender, busy }: { onSelectGender: (gender: 'girl' | 'boy') => void; busy: boolean }) {
  return (
    <section className="gender-choice" aria-label="Choose a display option">
      <div className="gender-intro">
        <span className="gender-kicker">ONE QUICK STEP</span>
        <h1>How should we <span>address you?</span></h1>
        <p>Choose an option to continue. It’s just for formality — you can chat with anyone who is online.</p>
      </div>
      <div className="gender-buttons">
        <button className="gender-option" disabled={busy} onClick={() => onSelectGender('girl')}>
          <span className="gender-symbol"><Venus size={31} strokeWidth={1.7}/></span>
          <span className="gender-option-copy"><strong>Girl</strong><small>Continue as girl</small></span>
          <ArrowRight className="gender-arrow" size={21}/>
        </button>
        <button className="gender-option" disabled={busy} onClick={() => onSelectGender('boy')}>
          <span className="gender-symbol"><Mars size={31} strokeWidth={1.7}/></span>
          <span className="gender-option-copy"><strong>Boy</strong><small>Continue as boy</small></span>
          <ArrowRight className="gender-arrow" size={21}/>
        </button>
      </div>
      <p className="gender-footnote">Your choice does not affect who you get matched with.</p>
    </section>
  );
}
