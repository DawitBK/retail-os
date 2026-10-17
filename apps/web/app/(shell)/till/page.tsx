import { PageHeader } from '@/components/ui';
import { can, MANAGERS } from '@/lib/roles';
import { api } from '@/lib/server-api';
import type { User } from '@/lib/types';
import { Till } from './till';

export const metadata = { title: 'Till' };

export default async function TillPage() {
  const me = await api<User>('/me');
  return (
    <>
      <PageHeader title="Till" subtitle="Scan or search, take payment, print the slip." />
      <Till canDiscount={can(me.role, MANAGERS)} />
    </>
  );
}
