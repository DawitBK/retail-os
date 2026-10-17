import type { ReactNode } from 'react';
import { logout } from '@/app/login/actions';
import { Nav } from '@/components/nav';
import { api, apiOrNull } from '@/lib/server-api';
import type { User } from '@/lib/types';

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const me = await api<User>('/me');
  const alerts = await apiOrNull<{ critical: number; warning: number; info: number }>(
    '/alerts/count',
  );
  const urgent = alerts ? alerts.critical + alerts.warning : 0;

  return (
    <div className="min-h-screen md:grid md:grid-cols-[14rem_1fr]">
      <aside className="no-print border-b border-line bg-white p-3 md:min-h-screen md:border-r md:border-b-0">
        <div className="mb-4 flex items-center justify-between px-2 md:block">
          <div className="text-base font-semibold tracking-tight">Retail OS</div>
          <div className="text-xs text-muted md:mt-0.5">
            {me.firstName} {me.lastName} · {me.role}
          </div>
        </div>
        <Nav role={me.role} alerts={urgent} />
        <form action={logout} className="mt-4 px-2">
          <button className="btn w-full">Sign out</button>
        </form>
      </aside>
      <main className="min-w-0 p-4 md:p-6">{children}</main>
    </div>
  );
}
