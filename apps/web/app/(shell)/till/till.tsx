'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Field } from '@/components/form';
import { Receipt } from '@/components/receipt';
import { Notice } from '@/components/ui';
import { call, newIdempotencyKey } from '@/lib/client-api';
import { formatMoney, label, parseMoney, toInput } from '@/lib/format';
import type { Customer, Page, PaymentMethod, Product, Sale } from '@/lib/types';

interface Line {
  product: Product;
  quantity: number;
  /** Managers only: a price other than the list price, as typed. */
  price: string;
  discount: string;
}

const METHODS: PaymentMethod[] = ['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CREDIT'];

export function Till({ canDiscount }: { canDiscount: boolean }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [cart, setCart] = useState<Line[]>([]);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [tendered, setTendered] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ sale: Sale; customerName: string | null } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const key = useRef<string | null>(null);
  const seq = useRef(0);

  // A new cart or payment is a new request; only an unchanged retry may reuse the key.
  const touch = useCallback(() => {
    key.current = null;
  }, []);

  const search = useCallback(async (q: string): Promise<Product[]> => {
    const params = new URLSearchParams({ status: 'ACTIVE', limit: '24', sort: 'name' });
    if (q.trim()) params.set('q', q.trim());
    const r = await call<Page<Product>>('GET', `/products?${params}`);
    return r.ok && r.data ? r.data.items : [];
  }, []);

  useEffect(() => {
    const mine = ++seq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      const items = await search(query);
      if (mine === seq.current) {
        setResults(items);
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query, search]);

  useEffect(() => {
    if (method === 'CREDIT' && customers === null) {
      void call<Page<Customer>>('GET', '/customers?limit=100').then((r) =>
        setCustomers(r.data?.items ?? []),
      );
    }
  }, [method, customers]);

  function add(product: Product) {
    touch();
    setDone(null);
    setError(null);
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === product.id);
      if (i >= 0) {
        return c.map((l, j) =>
          j === i
            ? { ...l, quantity: Math.min(l.quantity + 1, Math.max(product.currentStock, 1)) }
            : l,
        );
      }
      return [...c, { product, quantity: 1, price: '', discount: '' }];
    });
  }

  async function scan() {
    const q = query.trim();
    if (!q) return;
    const items = await search(q);
    const exact = items.find(
      (p) =>
        p.barcode?.toLowerCase() === q.toLowerCase() || p.sku.toLowerCase() === q.toLowerCase(),
    );
    const hit = exact ?? (items.length === 1 ? items[0] : undefined);
    if (hit && hit.currentStock > 0) {
      add(hit);
      setQuery('');
    } else if (hit) {
      setError(`${hit.name} is out of stock.`);
    }
  }

  function update(id: string, patch: Partial<Line>) {
    touch();
    setCart((c) => c.map((l) => (l.product.id === id ? { ...l, ...patch } : l)));
  }
  function remove(id: string) {
    touch();
    setCart((c) => c.filter((l) => l.product.id !== id));
  }

  const lineTotal = (l: Line) => {
    const unit = l.price.trim()
      ? (parseMoney(l.price) ?? l.product.sellingPriceMinor)
      : l.product.sellingPriceMinor;
    const disc = l.discount.trim() ? (parseMoney(l.discount) ?? 0) : 0;
    return Math.max(unit * l.quantity - disc, 0);
  };
  const total = useMemo(() => cart.reduce((s, l) => s + lineTotal(l), 0), [cart]);
  const tenderedMinor = tendered.trim() ? parseMoney(tendered) : total;
  const change =
    method === 'CASH' && tenderedMinor !== null ? Math.max(tenderedMinor - total, 0) : 0;
  const short = method === 'CASH' && tenderedMinor !== null && tenderedMinor < total;

  async function charge() {
    setError(null);
    if (cart.length === 0) return setError('Add at least one product.');
    if (method === 'CREDIT' && !customerId)
      return setError('Choose the customer who is buying on credit.');
    if (tenderedMinor === null) return setError('The amount received is not a valid amount.');
    if (method !== 'CREDIT' && tenderedMinor < total)
      return setError('The amount received is less than the total.');

    const items = cart.map((l) => {
      const price = l.price.trim() ? parseMoney(l.price) : null;
      const disc = l.discount.trim() ? parseMoney(l.discount) : null;
      return {
        productId: l.product.id,
        quantity: l.quantity,
        ...(price !== null ? { unitPriceMinor: price } : {}),
        ...(disc !== null ? { discountMinor: disc } : {}),
      };
    });
    key.current ??= newIdempotencyKey();
    setBusy(true);
    const r = await call<Sale>(
      'POST',
      '/sales',
      {
        paymentMethod: method,
        amountPaidMinor: tenderedMinor,
        ...(customerId ? { customerId } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        items,
      },
      { 'idempotency-key': key.current },
    );
    setBusy(false);
    if (!r.ok || !r.data) return setError(r.message ?? 'The sale could not be completed.');

    const name = customers?.find((c) => c.id === customerId)?.name ?? null;
    setDone({ sale: r.data, customerName: name });
    setCart([]);
    setTendered('');
    setNotes('');
    setCustomerId('');
    setMethod('CASH');
    key.current = null;
    setResults(await search(query));
  }

  if (done) {
    return (
      <div className="mx-auto max-w-sm space-y-4">
        <div className="no-print">
          <Notice tone="good">Sale {done.sale.number} complete.</Notice>
        </div>
        <div className="card">
          <Receipt sale={done.sale} customerName={done.customerName} />
        </div>
        <div className="no-print flex gap-2">
          <button className="btn flex-1" onClick={() => window.print()}>
            Print receipt
          </button>
          <button
            className="btn btn-primary flex-1"
            onClick={() => {
              setDone(null);
              searchRef.current?.focus();
            }}
          >
            New sale
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
      <section aria-label="Products">
        <div className="relative mb-3">
          <input
            ref={searchRef}
            className="input"
            placeholder="Scan a barcode or search by name or SKU"
            aria-label="Search products"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void scan();
              }
            }}
          />
        </div>
        <ul
          className={`grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4 ${searching ? 'opacity-60' : ''}`}
          aria-busy={searching}
        >
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="card flex h-full w-full flex-col items-start p-3 text-left hover:border-brand disabled:cursor-not-allowed disabled:opacity-50"
                disabled={p.currentStock <= 0}
                onClick={() => add(p)}
              >
                <span className="line-clamp-2 text-sm font-medium">{p.name}</span>
                <span className="mt-0.5 text-xs text-muted">{p.sku}</span>
                <span className="mt-auto pt-2 text-sm font-semibold tabular-nums">
                  {formatMoney(p.sellingPriceMinor)}
                </span>
                <span
                  className={`text-xs ${p.currentStock <= p.reorderPoint ? 'text-bad' : 'text-muted'}`}
                >
                  {p.currentStock > 0 ? `${p.currentStock} in stock` : 'Out of stock'}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {!searching && results.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No product matches “{query}”.</p>
        ) : null}
      </section>

      <section
        aria-label="Sale"
        className="card flex flex-col lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]"
      >
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">Current sale</h2>
        <div className="min-h-24 flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <p className="p-4 text-sm text-muted">Nothing yet. Scan or pick a product.</p>
          ) : (
            <ul className="divide-y divide-line">
              {cart.map((l) => (
                <li key={l.product.id} className="space-y-2 px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-medium">{l.product.name}</div>
                    <button
                      type="button"
                      className="text-xs text-muted hover:text-bad"
                      onClick={() => remove(l.product.id)}
                      aria-label={`Remove ${l.product.name}`}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="btn px-2"
                        aria-label="Fewer"
                        onClick={() =>
                          l.quantity > 1
                            ? update(l.product.id, { quantity: l.quantity - 1 })
                            : remove(l.product.id)
                        }
                      >
                        −
                      </button>
                      <input
                        className="input w-14 text-center tabular-nums"
                        inputMode="numeric"
                        aria-label={`Quantity of ${l.product.name}`}
                        value={l.quantity}
                        onChange={(e) => {
                          const n = Number(e.target.value.replace(/\D/g, ''));
                          update(l.product.id, {
                            quantity: Math.min(Math.max(n, 1), Math.max(l.product.currentStock, 1)),
                          });
                        }}
                      />
                      <button
                        type="button"
                        className="btn px-2"
                        aria-label="More"
                        disabled={l.quantity >= l.product.currentStock}
                        onClick={() => update(l.product.id, { quantity: l.quantity + 1 })}
                      >
                        +
                      </button>
                    </div>
                    <div className="text-sm font-semibold tabular-nums">
                      {formatMoney(lineTotal(l))}
                    </div>
                  </div>
                  {canDiscount ? (
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        className="input"
                        inputMode="decimal"
                        placeholder={`Price ${toInput(l.product.sellingPriceMinor)}`}
                        aria-label={`Price override for ${l.product.name}`}
                        value={l.price}
                        onChange={(e) => update(l.product.id, { price: e.target.value })}
                      />
                      <input
                        className="input"
                        inputMode="decimal"
                        placeholder="Discount"
                        aria-label={`Discount on ${l.product.name}`}
                        value={l.discount}
                        onChange={(e) => update(l.product.id, { discount: e.target.value })}
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-3 border-t border-line p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted">Total</span>
            <span className="text-2xl font-semibold tabular-nums">{formatMoney(total)}</span>
          </div>

          <fieldset>
            <legend className="sr-only">Payment method</legend>
            <div className="grid grid-cols-2 gap-2">
              {METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={method === m}
                  className={`btn ${method === m ? 'btn-primary' : ''}`}
                  onClick={() => {
                    touch();
                    setMethod(m);
                  }}
                >
                  {label(m)}
                </button>
              ))}
            </div>
          </fieldset>

          {method === 'CREDIT' ? (
            <>
              <Field label="Customer">
                <select
                  className="input"
                  value={customerId}
                  onChange={(e) => {
                    touch();
                    setCustomerId(e.target.value);
                  }}
                >
                  <option value="">Choose…</option>
                  {(customers ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Deposit paid now (optional)">
                <input
                  className="input"
                  inputMode="decimal"
                  value={tendered}
                  placeholder="0.00"
                  onChange={(e) => {
                    touch();
                    setTendered(e.target.value);
                  }}
                />
              </Field>
            </>
          ) : (
            <Field
              label={method === 'CASH' ? 'Cash received' : 'Amount received'}
              error={short ? 'Less than the total' : undefined}
            >
              <input
                className="input"
                inputMode="decimal"
                value={tendered}
                placeholder={toInput(total)}
                onChange={(e) => {
                  touch();
                  setTendered(e.target.value);
                }}
              />
            </Field>
          )}
          {method === 'CASH' && change > 0 ? (
            <div className="flex justify-between text-sm">
              <span className="text-muted">Change</span>
              <span className="font-semibold tabular-nums">{formatMoney(change)}</span>
            </div>
          ) : null}

          {error ? <Notice tone="bad">{error}</Notice> : null}
          <button
            className="btn btn-primary h-11 w-full text-base"
            disabled={busy || cart.length === 0}
            onClick={charge}
          >
            {busy ? 'Working…' : `Charge ${formatMoney(total)}`}
          </button>
        </div>
      </section>
    </div>
  );
}
