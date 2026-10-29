import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Page } from '@/lib/types';

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'orange';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface text-muted border border-line',
  good: 'bg-good/10 text-good',
  warn: 'bg-warn/15 text-ink',
  bad: 'bg-bad/10 text-bad',
  info: 'bg-brand/10 text-brand',
  orange: 'bg-orange-100 text-orange-800',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${TONES[tone]}`}>{children}</span>;
}

export function statusTone(status: string): Tone {
  switch (status) {
    case 'COMPLETED':
    case 'APPROVED':
    case 'RECEIVED':
    case 'PAID':
    case 'POSTED':
      return 'good';
    case 'VOIDED':
    case 'REJECTED':
    case 'CANCELLED':
    case 'CRITICAL':
      return 'bad';
    case 'PENDING':
    case 'PENDING_APPROVAL':
    case 'PARTIAL':
    case 'PARTIALLY_RECEIVED':
    case 'WARNING':
    case 'UNPAID':
      return 'warn';
    case 'ORDERED':
    case 'IN_PROGRESS':
    case 'INFO':
      return 'info';
    default:
      return 'neutral';
  }
}

/** How fast a product sells: green for fast, blue for normal, yellow for slow, red for dead. */
export function movementTone(movement: string): Tone {
  switch (movement) {
    case 'FAST':
      return 'good';
    case 'NORMAL':
      return 'info';
    case 'SLOW':
      return 'warn';
    case 'DEAD':
      return 'bad';
    default:
      return 'neutral';
  }
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="no-print mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'good' | 'bad';
}) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium tracking-wide text-muted uppercase">{label}</div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums ${tone === 'bad' ? 'text-bad' : tone === 'good' ? 'text-good' : ''}`}
      >
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card p-8 text-center text-sm text-muted">{children}</div>;
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'bad' | 'good';
  children: ReactNode;
}) {
  const cls = {
    info: 'bg-brand/10 text-ink',
    bad: 'bg-bad/10 text-bad',
    good: 'bg-good/10 text-good',
  }[tone];
  return (
    <div
      role={tone === 'bad' ? 'alert' : 'status'}
      className={`rounded-md px-3 py-2 text-sm ${cls}`}
    >
      {children}
    </div>
  );
}

/** Shown instead of a page the signed-in role may not use; the API would refuse it anyway. */
export function NoAccess({ what }: { what: string }) {
  return <Notice tone="bad">Your role cannot see {what}. Ask the owner if you need it.</Notice>;
}

export function Table({
  head,
  caption,
  children,
}: {
  head: string[];
  /** Read out by screen readers to say what the table holds; not shown. */
  caption?: string;
  children: ReactNode;
}) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-max border-collapse">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="border-b border-line">
          <tr>
            {head.map((h, i) => (
              <th key={`${h}-${i}`} className={`th ${h.startsWith('>') ? 'text-right' : ''}`}>
                {h.replace(/^>/, '')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

/** Previous / next links that keep every other query parameter. */
export function Pager({
  page,
  path,
  params,
}: {
  page: Page<unknown>['page'];
  path: string;
  params: Record<string, string | undefined>;
}) {
  const { limit, offset, total } = page;
  if (total <= limit) return null;
  const href = (o: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    if (o > 0) sp.set('offset', String(o));
    const s = sp.toString();
    return s ? `${path}?${s}` : path;
  };
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <nav
      aria-label="Pages"
      className="no-print mt-3 flex items-center justify-between text-sm text-muted"
    >
      <span>
        {from}–{to} of {total}
      </span>
      <span className="flex gap-2">
        {offset > 0 ? (
          <Link className="btn" href={href(Math.max(offset - limit, 0))}>
            Previous
          </Link>
        ) : null}
        {offset + limit < total ? (
          <Link className="btn" href={href(offset + limit)}>
            Next
          </Link>
        ) : null}
      </span>
    </nav>
  );
}

export function num(value: string | undefined, fallback = 0): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}
