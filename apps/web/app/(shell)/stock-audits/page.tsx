import Link from 'next/link';
import { Badge, Empty, PageHeader, Pager, Table, num, statusTone } from '@/components/ui';
import { formatDateTime, label } from '@/lib/format';
import { MANAGERS, can } from '@/lib/roles';
import { api, qs } from '@/lib/server-api';
import type { Page, Product, StockAudit, User } from '@/lib/types';
import { StartAudit } from './start-audit';

export const metadata = { title: 'Stock counts' };

export default async function AuditsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; offset?: string }>;
}) {
  const sp = await searchParams;
  const me = await api<User>('/me');
  const manager = can(me.role, MANAGERS);
  const data = await api<Page<StockAudit>>(
    `/stock-audits${qs({ status: sp.status, offset: num(sp.offset), limit: 25 })}`,
  );
  const products = manager
    ? await api<Page<Product>>('/products?limit=100&status=ACTIVE&sort=name')
    : null;

  return (
    <>
      <PageHeader
        title="Stock counts"
        subtitle="Count what is on the shelf; a manager approves the differences into the books."
        actions={
          products ? (
            <StartAudit
              products={products.items.map((p) => ({ id: p.id, name: p.name, sku: p.sku }))}
            />
          ) : null
        }
      />
      {data.items.length === 0 ? (
        <Empty>No stock counts yet.</Empty>
      ) : (
        <Table head={['Number', 'Started', 'Status', '>Short', '>Over', 'Notes']}>
          {data.items.map((a) => (
            <tr key={a.id} className="hover:bg-surface">
              <td className="td font-medium">
                <Link className="hover:underline" href={`/stock-audits/${a.id}`}>
                  {a.number}
                </Link>
              </td>
              <td className="td">{formatDateTime(a.createdAt)}</td>
              <td className="td">
                <Badge tone={statusTone(a.status)}>{label(a.status)}</Badge>
              </td>
              <td className="td text-right tabular-nums">{a.shortageUnits}</td>
              <td className="td text-right tabular-nums">{a.overageUnits}</td>
              <td className="td text-muted">{a.notes ?? ''}</td>
            </tr>
          ))}
        </Table>
      )}
      <Pager page={data.page} path="/stock-audits" params={{ status: sp.status }} />
    </>
  );
}
