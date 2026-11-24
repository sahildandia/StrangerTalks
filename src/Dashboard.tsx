export default function Dashboard({ onSelectGender, busy }: { onSelectGender: (gender: 'girl' | 'boy') => void; busy: boolean }) {
  return (
    <section className="gender-choice" aria-label="Choose gender">
      <h1>Select your option</h1>
      <p>Choose one to start chatting with someone who is online.</p>
      <div className="gender-buttons">
        <button className="gender-option" disabled={busy} onClick={() => onSelectGender('girl')}>Girl</button>
        <button className="gender-option" disabled={busy} onClick={() => onSelectGender('boy')}>Boy</button>
      </div>
    </section>
  );
}
