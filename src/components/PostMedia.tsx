import { useReaderLanguage } from './ReaderLanguage';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, ImageOff, Pause, Play } from 'lucide-react';
import type { SourceMedia } from '../lib/types';

interface Props {
  media: SourceMedia[];
  originalUrl: string;
  size?: 'feed' | 'detail';
  playbackEnabled?: boolean;
}

function OriginalLink({ url, children }: { url: string; children?: ReactNode }) {
  const { t } = useReaderLanguage();
  return <a href={url} target="_blank" rel="noopener noreferrer">{children ?? t('openOriginalPost')}<ArrowUpRight size={14} aria-hidden="true" /></a>;
}

function Unavailable({ type, originalUrl, previewUrl }: { type: SourceMedia['type']; originalUrl: string; previewUrl?: string }) {
  const { t } = useReaderLanguage();
  const [failedPreview, setFailedPreview] = useState(false);
  return <div className="post-media-unavailable">
    {previewUrl && !failedPreview ? <img className="post-media-preview" src={previewUrl} alt={t('mediaPreviewOnly', { type: t(type === 'gif' ? 'gif' : 'video') })} referrerPolicy="no-referrer" onError={() => setFailedPreview(true)} /> : <ImageOff size={26} aria-hidden="true" />}
    <p>{t('mediaUnavailable', { type: t(type === 'image' ? 'image' : type === 'gif' ? 'gif' : 'video') })}</p>
    <OriginalLink url={originalUrl} />
  </div>;
}

/** A missing playable URL is a preview, never a playable video. */
export function UnavailablePostMedia({ previewUrl, originalUrl }: { previewUrl?: string; originalUrl: string }) {
  return <div className="post-media post-media-missing"><div className="post-media-stage"><Unavailable type="video" previewUrl={previewUrl} originalUrl={originalUrl} /></div></div>;
}

function usePlaybackVisibility(enabled = true) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(true);
  useEffect(() => {
    const node = ref.current;
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      setVisible(entries.some(entry => entry.isIntersecting));
    });
    if (node && observer) observer.observe(node);
    else setVisible(true);
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motionChanged = () => setReducedMotion(preference.matches);
    const visibilityChanged = () => setPageVisible(document.visibilityState !== 'hidden');
    motionChanged(); visibilityChanged();
    preference.addEventListener('change', motionChanged);
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      observer?.disconnect();
      preference.removeEventListener('change', motionChanged);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, []);
  return { ref, visible: enabled && visible && pageVisible, reducedMotion };
}

/** Keep supplier order, trying alternative encodings if a browser cannot play one. */
export function playbackUrls(media: SourceMedia): string[] {
  return [...new Set([media.url, ...(media.variants ?? []).filter(variant => /^video\//i.test(variant.contentType) || /mpegurl/i.test(variant.contentType)).map(variant => variant.url)].filter(Boolean))];
}

function ImageAsset({ media, originalUrl, label }: { media: SourceMedia; originalUrl: string; label: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? <Unavailable type="image" originalUrl={originalUrl} /> : <img className="post-media-visual" src={media.url} alt={media.alt || label} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

/** Native animated GIFs use a canvas still while paused, including before motion consent. */
function RasterGif({ media, originalUrl, label, playbackEnabled }: { media: SourceMedia; originalUrl: string; label: string; playbackEnabled?: boolean }) {
  const { t } = useReaderLanguage();
  const { ref, visible, reducedMotion } = usePlaybackVisibility(playbackEnabled);
  const [choice, setChoice] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const [hasFrame, setHasFrame] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const playing = visible && (choice ?? !reducedMotion);
  useEffect(() => { setChoice(null); }, [reducedMotion]);
  function captureFrame() {
    const picture = image.current; const still = canvas.current;
    if (!picture?.naturalWidth || !still) return;
    still.width = picture.naturalWidth; still.height = picture.naturalHeight;
    const context = still.getContext('2d');
    if (context) { context.drawImage(picture, 0, 0); setHasFrame(true); }
  }
  // Capture before removing the animated image, without reading/exporting cross-origin pixels.
  function pause() { captureFrame(); setChoice(false); }
  useEffect(() => {
    if (!playing) captureFrame();
  }, [playing]);
  return <div className="post-media-asset" ref={ref}>
    {failed ? <Unavailable type="gif" originalUrl={originalUrl} previewUrl={media.previewUrl} /> : <>
      <canvas className={`post-media-visual post-gif-still ${playing ? 'post-media-hidden' : ''}`} ref={canvas} role="img" aria-label={media.alt || label} />
      {(playing || !hasFrame) && <img className={`post-media-visual ${playing ? '' : 'post-gif-loading'}`} ref={image} src={media.url} alt={playing ? media.alt || label : ''} aria-hidden={!playing} referrerPolicy="no-referrer" onLoad={captureFrame} onError={() => setFailed(true)} />}
      <button className="post-gif-toggle" onClick={() => playing ? pause() : setChoice(true)} aria-label={playing ? t('pauseGif') : t('playGif')}>{playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}{playing ? t('pauseGif') : t('playGif')}</button>
    </>}
  </div>;
}

function VideoAsset({ media, originalUrl, label, playbackEnabled }: { media: SourceMedia; originalUrl: string; label: string; playbackEnabled?: boolean }) {
  const { t } = useReaderLanguage();
  const { ref, visible, reducedMotion } = usePlaybackVisibility(playbackEnabled);
  const video = useRef<HTMLVideoElement>(null);
  const urls = playbackUrls(media);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const [failureReason, setFailureReason] = useState('');
  const [playing, setPlaying] = useState(false);
  const [gifChoice, setGifChoice] = useState<boolean | null>(null);
  const gif = media.type === 'gif';
  const shouldPlayGif = gif && visible && (gifChoice ?? !reducedMotion);
  useEffect(() => { setGifChoice(null); }, [reducedMotion]);
  useEffect(() => {
    const player = video.current;
    if (!player) return;
    let current = true;
    if (shouldPlayGif && !failed) {
      const started = player.play();
      started?.catch((error: unknown) => {
        if (current && !(error instanceof DOMException && error.name === 'AbortError')) setGifChoice(false);
      });
    } else if (gif || !visible) player.pause();
    return () => { current = false; };
  }, [shouldPlayGif, gif, visible, failed, sourceIndex]);
  useEffect(() => {
    const player = video.current;
    return () => { player?.pause(); };
  }, [sourceIndex, failed]);
  function mediaError() {
    const error = video.current?.error;
    setFailureReason(error ? `${error.code}:${error.message}` : 'unknown');
    if (sourceIndex + 1 < urls.length) setSourceIndex(sourceIndex + 1);
    else setFailed(true);
  }
  return <div className="post-media-asset" ref={ref} data-media-failure={failed ? failureReason : undefined}>
    {failed || !urls.length ? <Unavailable type={media.type} originalUrl={originalUrl} previewUrl={media.previewUrl} /> : <>
      <video key={urls[sourceIndex]} ref={video} className="post-media-visual" src={urls[sourceIndex]} poster={media.previewUrl} controls={!gif} playsInline muted={gif} loop={gif} preload="metadata" aria-label={media.alt || label} onError={mediaError} onPlay={() => { setPlaying(true); if (!visible) video.current?.pause(); }} onPause={() => setPlaying(false)}>
        {t('browserCannotPlay', { type: gif ? t('gif') : t('videoInline') })} <a href={originalUrl} target="_blank" rel="noopener noreferrer">{t('openTheOriginalPost')}</a>.
      </video>
      {gif && <button className="post-gif-toggle" onClick={() => setGifChoice(!playing)} aria-label={playing ? t('pauseGif') : t('playGif')}>{playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}{playing ? t('pauseGif') : t('playGif')}</button>}
    </>}
  </div>;
}

function MediaCarousel({ media, originalUrl, size = 'feed', playbackEnabled = true }: Props) {
  const { t } = useReaderLanguage();
  const [index, setIndex] = useState(0);
  const viewportId = useId();
  const pointer = useRef<{ x: number; y: number; id: number } | null>(null);
  const active = media[index];
  const multiple = media.length > 1;
  const label = t('attachmentLabel', { type: t(active.type === 'image' ? 'image' : active.type === 'gif' ? 'gif' : 'video'), index: index + 1, total: media.length });
  function move(delta: number) { setIndex(current => (current + delta + media.length) % media.length); }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Video controls, links, and buttons own their own keys; never listen on the page.
    if (!multiple || event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
    else if (event.key === 'Home') { event.preventDefault(); setIndex(0); }
    else if (event.key === 'End') { event.preventDefault(); setIndex(media.length - 1); }
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!multiple || event.pointerType !== 'touch' || !event.isPrimary || (event.target as Element).closest('video,button,a')) return;
    pointer.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
  }
  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = pointer.current; pointer.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x; const dy = event.clientY - start.y;
    if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.4) move(dx < 0 ? 1 : -1);
  }
  return <div className={`post-media post-media-${size}`} role="region" aria-roledescription={multiple ? t('carousel') : undefined} aria-label={t('postMedia')} tabIndex={multiple ? 0 : undefined} onKeyDown={keyDown} onPointerDown={pointerDown} onPointerUp={pointerUp} onPointerCancel={() => { pointer.current = null; }}>
    <div className="post-media-stage" id={viewportId} role="group" aria-roledescription={multiple ? t('slide') : undefined} aria-label={label} key={`${index}:${active.url}`}>
      {active.type === 'image' ? <ImageAsset media={active} originalUrl={originalUrl} label={label} /> : active.type === 'gif' && /\.gif(?:$|[?#])/i.test(active.url) ? <RasterGif media={active} originalUrl={originalUrl} label={label} playbackEnabled={playbackEnabled} /> : <VideoAsset media={active} originalUrl={originalUrl} label={label} playbackEnabled={playbackEnabled} />}
    </div>
    <div className="post-media-toolbar">
      <span className="post-media-count" aria-live="polite" aria-atomic="true">{label}</span>
      {multiple && <div className="post-media-navigation"><button aria-label={t('previousAttachment')} aria-controls={viewportId} onClick={() => move(-1)}><ChevronLeft size={19} aria-hidden="true" /></button><button aria-label={t('nextAttachment')} aria-controls={viewportId} onClick={() => move(1)}><ChevronRight size={19} aria-hidden="true" /></button></div>}
    </div>
  </div>;
}

export function PostMedia(props: Props) {
  if (!props.media.length) return null;
  // A replaced post/media list resets selection and releases the previous player.
  return <MediaCarousel {...props} key={JSON.stringify(props.media)} />;
}
