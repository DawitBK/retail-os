import type { ReactNode } from 'react';
import { logout } from '@/app/login/actions';
import { Icon } from '@/components/icons';
import { ShellFrame } from '@/components/shell-frame';
import { api, apiOrNull } from '@/lib/server-api';
import type { User } from '@/lib/types';

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const me = await api<User>('/me');
  const alerts = await apiOrNull<{ critical: number; warning: number; info: number }>(
    '/alerts/count',
  );
  const urgent = alerts ? alerts.critical + alerts.warning : 0;

  return (
    <ShellFrame
      name={`${me.firstName} ${me.lastName}`}
      role={me.role}
      alerts={urgent}
      signOut={
        <form action={logout}>
          <button className="btn !min-h-8 !px-2.5" aria-label="Sign out" title="Sign out">
            <Icon name="signout" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </form>
      }
    >
      {children}
    </ShellFrame>
  );
}
