import type { SourceUpdate } from '../lib/types';

export function Artwork({ update, className = '' }: { update: SourceUpdate; className?: string }) {
  const art = update.format === 'podcast' ? 'sound' : /ai|technology/i.test(update.topics.join(' ')) ? 'glass' : /design|repair|creativ/i.test(update.topics.join(' ')) ? 'form' : 'studio';
  return <div className={`artwork artwork-${art} ${className}`}>
    <img src={update.image || `/covers/${art}.svg`} alt="" loading="lazy" onError={(event) => { if (!event.currentTarget.src.endsWith(`/covers/${art}.svg`)) event.currentTarget.src = `/covers/${art}.svg`; }} />
    <span className="artwork-shade" />
  </div>;
}
