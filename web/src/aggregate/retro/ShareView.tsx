import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../i18n/index.js';
import { buildShareUrl } from '../shareLink.js';
import './shareView.css';

function ShareIcon({ copied = false }: { copied?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {copied ? <path d="m5 12 4 4L19 6" /> : <><path d="M10 13a5 5 0 0 0 7 .1l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7-.1l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7" /></>}
    </svg>
  );
}

/** A small native dialog supplies keyboard focus, Escape dismissal and a usable copy fallback. */
export function ShareView({ title }: { title: string }) {
  const t = useT();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const session = useRef(0);
  const [link, setLink] = useState('');
  const [feedback, setFeedback] = useState<'ready' | 'copied' | 'manual'>('ready');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  // A browser history change can change the view underneath a modal. Dismiss the old preview.
  useEffect(() => {
    const close = () => dialog.current?.close();
    window.addEventListener('popstate', close);
    return () => window.removeEventListener('popstate', close);
  }, []);

  const show = () => {
    session.current += 1;
    setLink(buildShareUrl(window.location.href));
    setFeedback('ready');
    setBusy(false);
    setOpen(true);
    dialog.current?.showModal();
    copyButton.current?.focus();
  };

  const copy = async () => {
    const activeSession = session.current;
    setBusy(true);
    try {
      await navigator.clipboard.writeText(link);
      if (dialog.current?.open && session.current === activeSession) setFeedback('copied');
    } catch {
      if (dialog.current?.open && session.current === activeSession) {
        setFeedback('manual');
        input.current?.focus();
        input.current?.select();
      }
    } finally {
      if (session.current === activeSession) setBusy(false);
    }
  };

  const share = async () => {
    const activeSession = session.current;
    setBusy(true);
    try {
      await navigator.share({ title: `${title} · Toto Hattrick`, url: link });
    } catch (error) {
      // Dismissing the system sheet is a normal choice. Other failures leave the copy action ready.
      if (!(error instanceof DOMException && error.name === 'AbortError') && dialog.current?.open && session.current === activeSession) {
        input.current?.focus();
        input.current?.select();
        setFeedback('manual');
      }
    } finally {
      if (session.current === activeSession) setBusy(false);
    }
  };

  return (
    <>
      <button ref={trigger} type="button" className="retro-share-trigger" onClick={show} aria-haspopup="dialog" aria-expanded={open} aria-controls={id}>
        <ShareIcon />
        {t('share.button')}
      </button>
      <dialog
        ref={dialog}
        id={id}
        className="retro-share-dialog"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        onClose={() => {
          session.current += 1;
          setOpen(false);
          trigger.current?.focus();
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
            event.currentTarget.close();
          }
        }}
      >
        <div className="retro-share-titlebar">
          <span id={`${id}-title`}><ShareIcon />{t('share.title')}</span>
          <button type="button" className="retro-share-close" onClick={() => dialog.current?.close()} aria-label={t('share.close')} title={t('share.close')}>
            <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m2 2 8 8M10 2l-8 8" /></svg>
          </button>
        </div>
        <div className="retro-share-body">
          <div className="retro-share-preview">
            <span className="retro-share-emblem"><ShareIcon /></span>
            <div>
              <div className="retro-share-site">Toto Hattrick</div>
              <div className="retro-share-view">{title}</div>
            </div>
          </div>
          <p id={`${id}-description`} className="retro-share-description">{t('share.description')}</p>
          <label className="retro-share-label" htmlFor={`${id}-link`}>{t('share.link')}</label>
          <input
            ref={input}
            id={`${id}-link`}
            className="retro-share-url"
            type="text"
            readOnly
            value={link}
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.currentTarget.select()}
            spellCheck={false}
          />
          <div className={`retro-share-feedback${feedback === 'copied' ? ' is-copied' : ''}`} role="status" aria-live="polite" aria-atomic="true">
            {feedback === 'manual'
              ? <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 7v5M8 4v1" /></svg>
              : <ShareIcon copied />}
            <span>{t(feedback === 'copied' ? 'share.copiedHint' : feedback === 'manual' ? 'share.copyFallback' : 'share.ready')}</span>
          </div>
        </div>
        <div className="retro-share-actions">
          {canShare && <button type="button" className="retro-share-secondary" onClick={share} disabled={busy}>{t('share.more')}</button>}
          <button ref={copyButton} type="button" className="retro-share-copy" onClick={copy} disabled={busy}>
            {feedback === 'copied' ? <ShareIcon copied /> : <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="7" y="6" width="10" height="12" rx="1" /><path d="M12 6V2H3v12h4" /></svg>}
            {t(feedback === 'copied' ? 'share.copied' : 'share.copy')}
          </button>
        </div>
      </dialog>
    </>
  );
}
