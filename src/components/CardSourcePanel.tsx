import { useReaderLanguage } from './ReaderLanguage';
import { useState, type ReactNode } from 'react';
import { Camera, FileText, Headphones, MessageSquare, Rss } from 'lucide-react';
import type { Platform } from '../lib/types';

export function SourcePlatformIcon({ platform }: { platform?: Platform }) {
  if (platform === 'YouTube') return <svg viewBox="0 0 24 18" width="20" height="16" aria-hidden="true"><path fill="#f03" d="M23.5 3a3 3 0 0 0-2.1-2.1C19.5.4 12 .4 12 .4S4.5.4 2.6.9A3 3 0 0 0 .5 3C0 4.9 0 9 0 9s0 4.1.5 6a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-6 .5-6s0-4.1-.5-6Z"/><path fill="#fff" d="m9.5 12.8 6.3-3.8-6.3-3.8Z"/></svg>;
  if (platform === 'X') return <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-7.4L5.5 22H2.3l7.2-8.3L.8 2h6.5l4.5 6.8L18.9 2Zm-1.1 18h1.7L6.3 3.9H4.5L17.8 20Z"/></svg>;
  if (platform === 'LinkedIn') return <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><rect width="24" height="24" rx="3" fill="#0a66c2"/><path fill="#fff" d="M5 9h3v10H5V9Zm1.5-5a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4ZM10 9h2.9v1.4C13.5 9.4 14.4 9 15.7 9c2.8 0 3.3 1.8 3.3 4.3V19h-3v-5.1c0-1.2 0-2.6-1.6-2.6S13 12.5 13 13.8V19h-3V9Z"/></svg>;
  if (platform === 'Substack') return <svg viewBox="0 0 20 22" width="16" height="18" fill="currentColor" aria-hidden="true"><path d="M0 0h20v2H0zm0 4h20v2H0zm0 4h20v14l-10-6-10 6Z"/></svg>;
  const Icon = platform === 'Instagram' ? Camera : platform === 'Podcast' ? Headphones : Rss;
  return <Icon size={17} aria-hidden="true" />;
}

export function TextPostPreview({ label }: { label?: string }) {
  const { t } = useReaderLanguage();
  return <div className="card-text-preview"><MessageSquare size={23} strokeWidth={1.3} aria-hidden="true" /><span>{label ?? t('textPost')}</span></div>;
}

export function CardImagePreview({ image, duration, label, onOpen }: { image?: string; duration?: string; label: string; onOpen: () => void }) {
  const { t } = useReaderLanguage();
  const [failedImage, setFailedImage] = useState<string>();
  return <button className="card-thumbnail" aria-label={label} onClick={onOpen}>{image && failedImage !== image ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedImage(image)} /> : <TextPostPreview label={image ? t('previewUnavailable') : t('readSource')} />}{duration && <span className="duration-pill">{duration}</span>}</button>;
}

export function CardSourcePanel({ name, avatar, date, publishedAt, platform, preview, actions, onChannel, secondary }: {
  name: string; avatar: ReactNode; date: string; publishedAt: string; platform?: Platform;
  preview?: ReactNode; actions: ReactNode; onChannel: () => void; secondary?: ReactNode;
}) {
  const { t } = useReaderLanguage();
  return <div className="card-source-panel">
    <div className="card-source-preview">{preview || <div className="card-text-preview"><FileText size={23} strokeWidth={1.3} aria-hidden="true" /><span>{t('sourcePreview')}</span></div>}</div>
    <div className="card-source-meta">
      <button className="card-source-channel" aria-label={t('viewChannelNamed', { name })} onClick={onChannel}>{avatar}<strong>{name}</strong></button>
      {secondary}
      <div className="card-source-date"><span className="card-platform-icon" role="img" aria-label={platform || t('sourceName')} title={platform || t('sourceName')}><SourcePlatformIcon platform={platform} /></span><time dateTime={publishedAt || undefined}>{date}</time></div>
      <div className="card-source-actions">{actions}</div>
    </div>
  </div>;
}
