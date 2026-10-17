'use client';

import { useState } from 'react';
import { Field, Modal, useMutation } from '@/components/form';
import { Notice } from '@/components/ui';
import { parseMoney, toInput } from '@/lib/format';
import type { Brand, Category, Product } from '@/lib/types';

interface FormProps {
  categories: Category[];
  brands: Brand[];
  product?: Product;
  onDone: () => void;
}

function ProductForm({ categories, brands, product, onDone }: FormProps) {
  const [f, setF] = useState({
    sku: product?.sku ?? '',
    barcode: product?.barcode ?? '',
    name: product?.name ?? '',
    description: product?.description ?? '',
    categoryId: product?.categoryId ?? categories[0]?.id ?? '',
    brandId: product?.brandId ?? '',
    unitOfMeasure: product?.unitOfMeasure ?? 'piece',
    price: toInput(product?.sellingPriceMinor ?? 0),
    minPrice: toInput(product?.minSellingPriceMinor),
    reorderPoint: String(product?.reorderPoint ?? 5),
    reorderQty: String(product?.reorderQty ?? 10),
    status: product?.status ?? 'ACTIVE',
  });
  const m = useMutation();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const price = parseMoney(f.price);
  const minPrice = f.minPrice.trim() ? parseMoney(f.minPrice) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (price === null) return;
    const shared = {
      sku: f.sku.trim(),
      name: f.name.trim(),
      categoryId: f.categoryId,
      unitOfMeasure: f.unitOfMeasure.trim(),
      sellingPriceMinor: price,
      reorderPoint: Number(f.reorderPoint),
      reorderQty: Number(f.reorderQty),
    };
    const r = product
      ? await m.run('PATCH', `/products/${product.id}`, {
          version: product.version,
          ...shared,
          barcode: f.barcode.trim() || null,
          description: f.description.trim() || null,
          brandId: f.brandId || null,
          minSellingPriceMinor: minPrice,
          status: f.status,
        })
      : await m.run('POST', '/products', {
          ...shared,
          ...(f.barcode.trim() ? { barcode: f.barcode.trim() } : {}),
          ...(f.description.trim() ? { description: f.description.trim() } : {}),
          ...(f.brandId ? { brandId: f.brandId } : {}),
          ...(minPrice !== null ? { minSellingPriceMinor: minPrice } : {}),
        });
    if (r.ok) onDone();
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" error={m.fieldErrors['name']}>
          <input className="input" value={f.name} onChange={set('name')} required maxLength={200} />
        </Field>
        <Field label="SKU" error={m.fieldErrors['sku']}>
          <input className="input" value={f.sku} onChange={set('sku')} required maxLength={64} />
        </Field>
        <Field label="Barcode" error={m.fieldErrors['barcode']}>
          <input className="input" value={f.barcode} onChange={set('barcode')} maxLength={64} />
        </Field>
        <Field label="Unit">
          <input
            className="input"
            value={f.unitOfMeasure}
            onChange={set('unitOfMeasure')}
            required
            maxLength={30}
          />
        </Field>
        <Field label="Category" error={m.fieldErrors['categoryId']}>
          <select className="input" value={f.categoryId} onChange={set('categoryId')} required>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Brand">
          <select className="input" value={f.brandId} onChange={set('brandId')}>
            <option value="">None</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Selling price"
          error={price === null ? 'Enter an amount like 12.50' : m.fieldErrors['sellingPriceMinor']}
        >
          <input
            className="input"
            inputMode="decimal"
            value={f.price}
            onChange={set('price')}
            required
          />
        </Field>
        <Field
          label="Lowest allowed price"
          hint="Below this, only a manager can sell"
          error={f.minPrice.trim() && minPrice === null ? 'Enter an amount like 10.00' : undefined}
        >
          <input
            className="input"
            inputMode="decimal"
            value={f.minPrice}
            onChange={set('minPrice')}
          />
        </Field>
        <Field label="Reorder point">
          <input
            className="input"
            type="number"
            min={0}
            value={f.reorderPoint}
            onChange={set('reorderPoint')}
            required
          />
        </Field>
        <Field label="Reorder quantity">
          <input
            className="input"
            type="number"
            min={0}
            value={f.reorderQty}
            onChange={set('reorderQty')}
            required
          />
        </Field>
        {product ? (
          <Field label="Status">
            <select className="input" value={f.status} onChange={set('status')}>
              <option value="ACTIVE">Active</option>
              <option value="DISCONTINUED">Discontinued</option>
            </select>
          </Field>
        ) : null}
      </div>
      <Field label="Description">
        <textarea
          className="input min-h-16 py-2"
          value={f.description}
          onChange={set('description')}
          maxLength={2000}
        />
      </Field>
      {m.error ? <Notice tone="bad">{m.error}</Notice> : null}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={m.busy || price === null}>
          {product ? 'Save changes' : 'Create product'}
        </button>
      </div>
    </form>
  );
}

export function NewProduct({ categories, brands }: { categories: Category[]; brands: Brand[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="btn btn-primary"
        onClick={() => setOpen(true)}
        disabled={categories.length === 0}
      >
        New product
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="New product" wide>
        <ProductForm categories={categories} brands={brands} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

export function EditProduct({
  product,
  categories,
  brands,
}: {
  product: Product;
  categories: Category[];
  brands: Brand[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>
        Edit
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Edit ${product.name}`} wide>
        <ProductForm
          product={product}
          categories={categories}
          brands={brands}
          onDone={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}
