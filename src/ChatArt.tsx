export default function ChatArt({ group = false, compact = false }: { group?: boolean; compact?: boolean }) {
  return <div className={`chat-art ${group ? 'group-art' : ''} ${compact ? 'compact-art' : ''}`} aria-hidden="true">
    <span className="art-bubble bubble-back"><i/><i/><i/></span>
    <span className="art-bubble bubble-front"><i/><i/><i/></span>
    {group ? <span className="art-bubble bubble-third"><i/><i/><i/></span> : null}
    <span className="art-spark">✦</span><span className="art-shadow"/>
  </div>;
}

