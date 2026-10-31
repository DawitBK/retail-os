'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/icons';
import { NAV, type NavItem } from '@/lib/roles';
import type { Role } from '@/lib/types';

/** The entry the current address belongs to; the most specific wins so "Statements" is not lit while on "Journal". */
export function currentNavItem(pathname: string, role: Role): NavItem | undefined {
  const active = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
  return NAV.filter((n) => n.roles.includes(role) && active(n.href)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
}

export function Nav({
  role,
  alerts,
  onNavigate,
}: {
  role: Role;
  alerts: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const items = NAV.filter((n) => n.roles.includes(role));
  const groups = [...new Set(items.map((n) => n.group))];
  const best = currentNavItem(pathname, role)?.href;

  return (
    <nav aria-label="Main" className="space-y-4">
      {groups.map((g) => (
        <div key={g}>
          <div className="mb-1 px-2 text-xs font-semibold tracking-wide text-muted uppercase">
            {g}
          </div>
          <ul className="space-y-0.5">
            {items
              .filter((n) => n.group === g)
              .map((n) => (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    onClick={onNavigate}
                    aria-current={best === n.href ? 'page' : undefined}
                    className={`flex items-center gap-2.5 rounded-md px-2 py-2 text-sm md:py-1.5 ${
                      best === n.href
                        ? 'bg-brand/10 font-medium text-brand'
                        : 'text-ink hover:bg-surface'
                    }`}
                  >
                    <Icon name={n.icon} className={best === n.href ? 'text-brand' : 'text-muted'} />
                    <span className="flex-1">{n.label}</span>
                    {n.href === '/alerts' && alerts > 0 ? (
                      <span className="badge bg-bad/10 text-bad">{alerts}</span>
                    ) : null}
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
