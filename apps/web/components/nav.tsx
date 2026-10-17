'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV } from '@/lib/roles';
import type { Role } from '@/lib/types';

export function Nav({ role, alerts }: { role: Role; alerts: number }) {
  const pathname = usePathname();
  const items = NAV.filter((n) => n.roles.includes(role));
  const groups = [...new Set(items.map((n) => n.group))];
  const active = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
  // Prefer the most specific match so "Statements" is not lit while on "Journal".
  const best = items
    .filter((n) => active(n.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

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
                    aria-current={best === n.href ? 'page' : undefined}
                    className={`flex items-center justify-between rounded-md px-2 py-1.5 text-sm ${
                      best === n.href ? 'bg-brand/10 font-medium text-brand' : 'hover:bg-surface'
                    }`}
                  >
                    {n.label}
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
