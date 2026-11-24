export default function Dashboard({ onSelectGender, busy, activeUsers }: { onSelectGender: (gender: 'girl' | 'boy') => void; busy: boolean; activeUsers: number | null }) {
  return (
    <section className="gender-choice" aria-label="Choose gender">
      <div className="active-users-box"><span className="active-users-indicator" aria-hidden="true"></span><span><strong>{activeUsers === null ? "—" : activeUsers}</strong><small>Active users</small></span></div>
      <h1>Select your option</h1>
      <p>Choose one to start chatting with someone who is online.</p>
      <div className="gender-buttons">
        <button className="gender-option" disabled={busy} onClick={() => onSelectGender('girl')}>Girl</button>
        <button className="gender-option" disabled={busy} onClick={() => onSelectGender('boy')}>Boy</button>
      </div>
    </section>
  );
}
