import { EntityButton } from '@/components/entity-form';
import type { FieldDef } from '@/components/entity-form';
import { ActionButton } from '@/components/form';
import { Badge, Empty, PageHeader, Table } from '@/components/ui';
import { label } from '@/lib/format';
import { MANAGERS, can } from '@/lib/roles';
import { api } from '@/lib/server-api';
import type { Brand, Category, Page, SubCategory, User } from '@/lib/types';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Categories and brands' };

const CATEGORY_NEW: FieldDef[] = [
  { key: 'name', label: 'Name', required: true, maxLength: 200 },
  {
    key: 'type',
    label: 'Type',
    kind: 'select',
    options: [
      { value: 'ELECTRONICS', label: 'Electronics' },
      { value: 'STATIONERY', label: 'Stationery' },
    ],
  },
];
const NAME_ONLY: FieldDef[] = [{ key: 'name', label: 'Name', required: true, maxLength: 200 }];
const BRAND: FieldDef[] = [
  { key: 'name', label: 'Name', required: true, maxLength: 200 },
  { key: 'country', label: 'Country', maxLength: 100 },
];

export default async function CatalogSetupPage() {
  const me = await api<User>('/me');
  if (!can(me.role, MANAGERS)) redirect('/products');
  const [categories, subs, brands] = await Promise.all([
    api<Page<Category>>('/categories?limit=100'),
    api<Page<SubCategory>>('/sub-categories?limit=100'),
    api<Page<Brand>>('/brands?limit=100'),
  ]);
  const subFields = (): FieldDef[] => [
    {
      key: 'categoryId',
      label: 'Category',
      kind: 'select',
      options: categories.items.map((c) => ({ value: c.id, label: c.name })),
      createOnly: true,
    },
    { key: 'name', label: 'Name', required: true, maxLength: 200 },
  ];

  return (
    <>
      <PageHeader
        title="Categories and brands"
        subtitle="How products are grouped. A category with products in it cannot be removed."
      />
      <div className="space-y-8">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Categories</h2>
            <EntityButton
              primary
              label="New category"
              title="New category"
              fields={CATEGORY_NEW}
              createPath="/categories"
            />
          </div>
          {categories.items.length === 0 ? (
            <Empty>Create a category before adding products.</Empty>
          ) : (
            <Table head={['Name', 'Type', '']}>
              {categories.items.map((c) => (
                <tr key={c.id}>
                  <td className="td font-medium">{c.name}</td>
                  <td className="td">
                    <Badge>{label(c.type)}</Badge>
                  </td>
                  <td className="td flex justify-end gap-2">
                    <EntityButton
                      label="Rename"
                      title={`Rename ${c.name}`}
                      fields={NAME_ONLY}
                      record={c as unknown as Record<string, unknown> & { version: number }}
                      createPath="/categories"
                      updatePath={`/categories/${c.id}`}
                    />
                    <ActionButton
                      label="Remove"
                      method="DELETE"
                      path={`/categories/${c.id}`}
                      danger
                      confirm={`Remove the category ${c.name}?`}
                    />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Sub-categories</h2>
            {categories.items.length > 0 ? (
              <EntityButton
                label="New sub-category"
                title="New sub-category"
                fields={subFields()}
                createPath="/sub-categories"
              />
            ) : null}
          </div>
          {subs.items.length === 0 ? (
            <Empty>No sub-categories.</Empty>
          ) : (
            <Table head={['Name', 'Category', '']}>
              {subs.items.map((s) => (
                <tr key={s.id}>
                  <td className="td font-medium">{s.name}</td>
                  <td className="td text-muted">
                    {categories.items.find((c) => c.id === s.categoryId)?.name ?? '–'}
                  </td>
                  <td className="td flex justify-end gap-2">
                    <EntityButton
                      label="Rename"
                      title={`Rename ${s.name}`}
                      fields={NAME_ONLY}
                      record={s as unknown as Record<string, unknown> & { version: number }}
                      createPath="/sub-categories"
                      updatePath={`/sub-categories/${s.id}`}
                    />
                    <ActionButton
                      label="Remove"
                      method="DELETE"
                      path={`/sub-categories/${s.id}`}
                      danger
                      confirm={`Remove ${s.name}?`}
                    />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Brands</h2>
            <EntityButton label="New brand" title="New brand" fields={BRAND} createPath="/brands" />
          </div>
          {brands.items.length === 0 ? (
            <Empty>No brands.</Empty>
          ) : (
            <Table head={['Name', 'Country', '']}>
              {brands.items.map((b) => (
                <tr key={b.id}>
                  <td className="td font-medium">{b.name}</td>
                  <td className="td text-muted">{b.country ?? '–'}</td>
                  <td className="td flex justify-end gap-2">
                    <EntityButton
                      label="Edit"
                      title={`Edit ${b.name}`}
                      fields={BRAND}
                      record={b as unknown as Record<string, unknown> & { version: number }}
                      createPath="/brands"
                      updatePath={`/brands/${b.id}`}
                    />
                    <ActionButton
                      label="Remove"
                      method="DELETE"
                      path={`/brands/${b.id}`}
                      danger
                      confirm={`Remove ${b.name}?`}
                    />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </section>
      </div>
    </>
  );
}
