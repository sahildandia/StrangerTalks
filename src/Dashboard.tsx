import { ArrowRight } from 'lucide-react';

export default function Dashboard({ onSelectGender, busy }: { onSelectGender: (gender: 'girl' | 'boy') => void; busy: boolean }) {
  return (
    <section className="gender-choice" aria-label="Choose a display option">
      <h1>Choose <span>Girl or Boy</span></h1>
      <p>This is only for formality. You can be matched with anyone who is online.</p>
      <div className="gender-buttons">
        <button className="button primary" disabled={busy} onClick={() => onSelectGender('girl')}>Girl <ArrowRight size={18}/></button>
        <button className="button secondary" disabled={busy} onClick={() => onSelectGender('boy')}>Boy <ArrowRight size={18}/></button>
      </div>
    </section>
  );
}
