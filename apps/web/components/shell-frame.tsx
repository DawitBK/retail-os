'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { Nav, currentNavItem } from '@/components/nav';
import type { Role } from '@/lib/types';

/**
 * The page around every signed-in screen: a side menu (a slide-in drawer on a phone), and a top bar with where you are and who you
 * are. `signOut` is a server-action form handed in from the layout.
 */
export function ShellFrame({
  name,
  role,
  alerts,
  signOut,
  children,
}: {
  name: string;
  role: Role;
  alerts: number;
  signOut: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const here = currentNavItem(pathname, role);
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?';

  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="shell min-h-screen md:grid md:grid-cols-[14rem_1fr]">
      {open ? (
        <button
          type="button"
          aria-label="Close menu"
          className="no-print fixed inset-0 z-30 bg-ink/40 md:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
        id="side-menu"
        className={`no-print fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto border-r border-line bg-white p-3 transition-transform md:sticky md:top-0 md:z-auto md:h-screen md:w-auto md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-4 flex items-center justify-between px-2">
          <div>
            <div className="text-base font-semibold tracking-tight">Retail OS</div>
            <div className="text-xs text-muted">Shop management</div>
          </div>
          <button
            type="button"
            aria-label="Close menu"
            className="btn !min-h-8 !px-2 md:hidden"
            onClick={() => setOpen(false)}
          >
            <Icon name="close" />
          </button>
        </div>
        <Nav role={role} alerts={alerts} onNavigate={() => setOpen(false)} />
      </aside>
      <div className="min-w-0">
        <header className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-white/90 px-4 py-2.5 backdrop-blur md:px-6">
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={open}
            aria-controls="side-menu"
            className="btn !min-h-9 !px-2 md:hidden"
            onClick={() => setOpen(true)}
          >
            <Icon name="menu" size={20} />
          </button>
          <nav aria-label="Breadcrumb" className="min-w-0 flex-1 truncate text-sm text-muted">
            {here ? (
              <>
                {here.group} <span aria-hidden="true">›</span>{' '}
                <span className="font-medium text-ink">{here.label}</span>
              </>
            ) : (
              <span className="font-medium text-ink">Retail OS</span>
            )}
          </nav>
          <div className="flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-sm font-medium">{name}</div>
              <div className="text-xs text-muted capitalize">{role}</div>
            </div>
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand"
            >
              {initials}
            </span>
            {signOut}
          </div>
        </header>
        <main className="min-w-0 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
