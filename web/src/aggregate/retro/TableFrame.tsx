import type { CSSProperties, ReactNode } from 'react';

/** Keep the page fluid while wide record tables scroll within their own frame on small screens. */
export function TableFrame({ label, minWidth, children }: { label: string; minWidth: number; children: ReactNode }) {
  return (
    <div className="retro-table-frame" style={{ '--table-min-width': `${minWidth}px` } as CSSProperties}>
      <div className="retro-table-scroll" role="region" aria-label={label} tabIndex={0}>
        <div className="retro-table-content">{children}</div>
      </div>
    </div>
  );
}
