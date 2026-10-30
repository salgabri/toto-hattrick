import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../../i18n/index.js';
import type { HtPost } from '../htPost.js';
import './shareView.css';
import './htPostExport.css';

function TableIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" />
      <path d="M1.5 6h13M1.5 9.5h13M6 6v7.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

/**
 * "Copy for Hattrick": a table as Hattrick forum markup, in the Share dialog's chrome.
 *
 * `build` runs each time the dialog opens, so the markup always follows the filters on screen. It
 * may be async — a leaderboard export reads every listed manager's cabinet — and a result that
 * lands after the dialog closed or reopened is dropped.
 */
export function HtPostExport({
  title,
  note,
  disabled = false,
  build,
}: {
  /** The table being exported, shown as the dialog's heading. */
  title: string;
  /** What this table's rows are, when that needs saying beyond the shared description. */
  note?: string;
  disabled?: boolean;
  build: () => HtPost | Promise<HtPost>;
}) {
  const { lang, t } = useI18n();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const session = useRef(0);
  const [post, setPost] = useState<HtPost | 'loading' | 'failed'>('loading');
  const [feedback, setFeedback] = useState<'ready' | 'copied' | 'manual'>('ready');
  const [open, setOpen] = useState(false);
  const ready = typeof post === 'object';

  // A browser history change can change the view underneath a modal. Dismiss the old export.
  useEffect(() => {
    const close = () => dialog.current?.close();
    window.addEventListener('popstate', close);
    return () => window.removeEventListener('popstate', close);
  }, []);

  const show = () => {
    const active = ++session.current;
    setPost('loading');
    setFeedback('ready');
    setOpen(true);
    dialog.current?.showModal();
    Promise.resolve()
      .then(build)
      .then(
        (next) => {
          if (session.current !== active) return;
          setPost(next);
          copyButton.current?.focus();
        },
        () => {
          if (session.current === active) setPost('failed');
        },
      );
  };

  const copy = async () => {
    if (!ready) return;
    const active = session.current;
    try {
      await navigator.clipboard.writeText(post.markup);
      if (session.current === active) setFeedback('copied');
    } catch {
      if (session.current === active) {
        setFeedback('manual');
        area.current?.focus();
        area.current?.select();
      }
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="retro-share-trigger retro-htpost-trigger"
        onClick={show}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
      >
        <TableIcon />
        {t('htpost.button')}
      </button>
      <dialog
        ref={dialog}
        id={id}
        className="retro-share-dialog retro-htpost-dialog"
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
          <span id={`${id}-title`}><TableIcon />{t('htpost.title')}</span>
          <button type="button" className="retro-share-close" onClick={() => dialog.current?.close()} aria-label={t('share.close')} title={t('share.close')}>
            <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m2 2 8 8M10 2l-8 8" /></svg>
          </button>
        </div>
        <div className="retro-share-body">
          <div className="retro-share-view">{title}</div>
          <p id={`${id}-description`} className="retro-share-description">
            {t('htpost.description')}
            {note && <> {note}</>}
          </p>
          <label className="retro-share-label" htmlFor={`${id}-markup`}>{t('htpost.markup')}</label>
          {ready ? (
            <textarea
              ref={area}
              id={`${id}-markup`}
              className="retro-htpost-markup"
              readOnly
              wrap="off"
              spellCheck={false}
              value={post.markup}
              onFocus={(event) => event.currentTarget.select()}
            />
          ) : (
            <div id={`${id}-markup`} className="retro-htpost-markup is-pending" role="status">
              {t(post === 'failed' ? 'htpost.failed' : 'htpost.preparing')}
            </div>
          )}
          <div className="retro-htpost-stats">
            {ready && t('htpost.stats', { rows: post.rows.toLocaleString(lang), chars: post.markup.length.toLocaleString(lang) })}
          </div>
          <div className={`retro-share-feedback${feedback === 'copied' ? ' is-copied' : ''}`} role="status" aria-live="polite" aria-atomic="true">
            {feedback === 'manual'
              ? <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 7v5M8 4v1" /></svg>
              : <CheckIcon />}
            <span>{t(feedback === 'copied' ? 'htpost.copiedHint' : feedback === 'manual' ? 'htpost.copyFallback' : 'htpost.ready')}</span>
          </div>
        </div>
        <div className="retro-share-actions">
          <button ref={copyButton} type="button" className="retro-share-copy" onClick={copy} disabled={!ready}>
            {feedback === 'copied' ? <CheckIcon /> : <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="7" y="6" width="10" height="12" rx="1" /><path d="M12 6V2H3v12h4" /></svg>}
            {t(feedback === 'copied' ? 'htpost.copied' : 'htpost.copy')}
          </button>
        </div>
      </dialog>
    </>
  );
}
