import { createHash } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { ProblemException } from '@retail/kit';
import type pg from 'pg';
import { AccountingService } from '../accounting/accounting.service.js';
import { AuthService } from '../auth/auth.service.js';
import { recordAudit } from '../common/audit.js';
import type { Principal } from '../common/auth.js';
import { addDays, businessDate, getBusinessTimezone, useClock } from '../common/time.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { DB, POOL, type Database } from '../db/db.module.js';
import { DamageService } from '../operations/damage.service.js';
import { AuditsService } from '../operations/audits.service.js';
import { ReturnsService } from '../operations/returns.service.js';
import { PartiesService } from '../parties/parties.service.js';
import { PurchaseReturnsService } from '../purchases/purchase-returns.service.js';
import { PurchasesService } from '../purchases/purchases.service.js';
import { SalesService } from '../sales/sales.service.js';
import {
  BRAND_COUNTRIES,
  CUSTOMERS,
  PRODUCTS,
  SUB_CATEGORIES,
  SUPPLIERS,
  type ShopType,
} from './catalog-data.js';

/** Every record the demo creates says so, so it can be told from real business records. */
export const DEMO_NOTE = 'Demo data';
const MARKER_ACTION = 'demo.step';

export interface SeedOptions {
  /** How many days of trading to replay, ending today. */
  days: number;
  log: (line: string) => void;
  /** Password for staff accounts the demo has to create (never used for existing staff). */
  staffPassword?: string;
  staffEmailDomain: string;
}

export interface SeedReport {
  alreadySeeded: boolean;
  days: number;
  counts: Record<string, number>;
  checks: { name: string; ok: boolean; detail: string }[];
}

// ---------------------------------------------------------------- small deterministic helpers

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};
/** A repeatable random stream: the same key always gives the same numbers. */
const stream = (key: string) => {
  let a = hash(key) || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    chance: (p: number) => next() < p,
  };
};
const uuidFor = (tag: string): string => {
  const h = createHash('sha1').update(`retail-demo:${tag}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const birr = (n: number) => Math.round(n * 100);
const lower = (s: string) => s.toLowerCase();

interface ProductInfo {
  id: string;
  sku: string;
  name: string;
  sub: string;
  type: ShopType;
  costMinor: number;
  priceMinor: number;
  demand: number;
  kind: 'dormant' | 'starved' | 'normal';
  supplier: string;
  reorderPoint: number;
  reorderQty: number;
}

interface Staff {
  owner: Principal;
  manager: Principal;
  accountant: Principal;
  cashiers: Principal[];
}

/** Whether a failure is a business refusal (stock ran out, a limit was hit) the replay simply steps over. */
const isRefusal = (e: unknown): e is ProblemException =>
  e instanceof ProblemException && e.status >= 400 && e.status < 500;

export async function seedDemo(
  app: INestApplicationContext,
  options: SeedOptions,
): Promise<SeedReport> {
  const log = options.log;
  const pool = app.get<pg.Pool>(POOL);
  const db = app.get<Database>(DB);
  const catalog = app.get(CatalogService);
  const parties = app.get(PartiesService);
  const sales = app.get(SalesService);
  const purchases = app.get(PurchasesService);
  const purchaseReturns = app.get(PurchaseReturnsService);
  const saleReturns = app.get(ReturnsService);
  const damage = app.get(DamageService);
  const audits = app.get(AuditsService);
  const accounting = app.get(AccountingService);
  const auth = app.get(AuthService);

  const q = async <T extends Record<string, unknown>>(
    text: string,
    values: unknown[] = [],
  ): Promise<T[]> => (await pool.query(text, values)).rows as T[];
  const one = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) =>
    (await q<T>(text, values))[0];

  // ---------------------------------------------------------------- steps that must not repeat

  const done = new Set<string>(
    (
      await q<{ tag: string }>(`select after->>'tag' as tag from audit_log where action = $1`, [
        MARKER_ACTION,
      ])
    ).map((r) => r.tag),
  );
  const staff = await ensureStaff();
  const ownerRow = await one<{ id: string }>(`select id from users where id = $1`, [
    staff.owner.userId,
  ]);
  const mark = async (tag: string) => {
    await db.transaction(async (tx) => {
      await recordAudit(tx, {
        actor: ownerRow!.id,
        action: MARKER_ACTION,
        entityType: 'demo-seed',
        entityId: uuidFor(tag),
        after: { tag },
      });
    });
    done.add(tag);
  };
  /** Run a step once, ever; a second run of the seed steps over it. Returns undefined when skipped. */
  const once = async <T>(tag: string, work: () => Promise<T>): Promise<T | undefined> => {
    if (done.has(tag)) return undefined;
    const result = await work();
    await mark(tag);
    return result;
  };

  if (done.has('seeded')) {
    return { alreadySeeded: true, days: options.days, counts: {}, checks: [] };
  }

  async function ensureStaff(): Promise<Staff> {
    const ofRole = async (role: string) =>
      q<{ id: string; email: string }>(
        `select id, email from users where role = $1 and deleted_at is null and active and not platform_admin order by created_at`,
        [role],
      );
    const owners = await ofRole('owner');
    if (owners.length === 0) {
      throw new Error(
        'There is no owner yet. Create one first with owner:bootstrap, then run the demo seed.',
      );
    }
    const ownerPrincipal: Principal = { userId: owners[0]!.id, role: 'owner' };
    const make = async (
      role: 'manager' | 'accountant' | 'cashier',
      local: string,
      first: string,
      last: string,
    ) => {
      if (!options.staffPassword) {
        throw new Error(
          `The demo needs a ${role} account and none exists: set DEMO_STAFF_PASSWORD (12 characters or more) so it can create one.`,
        );
      }
      const created = await auth.createStaff(ownerPrincipal, {
        email: `${local}@${options.staffEmailDomain}`,
        password: options.staffPassword,
        firstName: first,
        lastName: last,
        role,
      });
      log(`  created ${role} ${created.email}`);
      return created.id;
    };
    const manager =
      (await ofRole('manager'))[0]?.id ?? (await make('manager', 'manager', 'Mia', 'Manager'));
    const accountant =
      (await ofRole('accountant'))[0]?.id ??
      (await make('accountant', 'accountant', 'Abel', 'Books'));
    const cashierIds = (await ofRole('cashier')).map((c) => c.id);
    if (cashierIds.length === 0) cashierIds.push(await make('cashier', 'cashier1', 'Cleo', 'Till'));
    // A second cashier makes the till history look like a real shop, but only when a password was given to create one.
    if (cashierIds.length === 1 && options.staffPassword) {
      cashierIds.push(await make('cashier', 'cashier2', 'Dawit', 'Till'));
    }
    return {
      owner: ownerPrincipal,
      manager: { userId: manager, role: 'manager' },
      accountant: { userId: accountant, role: 'accountant' },
      cashiers: cashierIds.slice(0, 2).map((userId) => ({ userId, role: 'cashier' as const })),
    };
  }

  // ---------------------------------------------------------------- catalogue and parties

  const tz = getBusinessTimezone();
  const today = businessDate();
  const firstDay = addDays(today, -(options.days - 1));
  let tick = 0;
  let base = 0;
  const restoreClock = useClock(() => new Date(base + tick++));
  try {
    /** Stand at a time of day in the shop's time zone on a trading day. */
    const at = (day: string, hhmm: string) => {
      const offset = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
        .formatToParts(new Date(`${day}T12:00:00Z`))
        .find((p) => p.type === 'timeZoneName')!
        .value.replace('GMT', '');
      // Time only moves forward: two things at the same minute keep the order they happened in.
      const target = new Date(`${day}T${hhmm}:00${offset === '' ? 'Z' : offset}`).getTime();
      base = Math.max(target, base + tick + 1);
      tick = 0;
    };

    // The shop's own records are made on the first morning, before any trading.
    at(firstDay, '07:00');
    log('Catalogue, suppliers and customers');
    const categoryId = new Map<ShopType, string>();
    for (const [type, name] of [
      ['ELECTRONICS', 'Electronics'],
      ['STATIONERY', 'Stationery'],
    ] as const) {
      const found = await one<{ id: string }>(
        `select id from categories where lower(name) = $1 and deleted_at is null`,
        [lower(name)],
      );
      categoryId.set(
        type,
        found?.id ?? (await catalog.createCategory(staff.owner, { name, type })).id,
      );
    }
    const subId = new Map<string, string>();
    for (const s of SUB_CATEGORIES) {
      const cid = categoryId.get(s.type)!;
      const found = await one<{ id: string }>(
        `select id from sub_categories where category_id = $1 and lower(name) = $2 and deleted_at is null`,
        [cid, lower(s.name)],
      );
      subId.set(
        s.name,
        found?.id ??
          (await catalog.createSubCategory(staff.owner, { categoryId: cid, name: s.name })).id,
      );
    }
    const brandId = new Map<string, string>();
    for (const name of new Set(PRODUCTS.map((p) => p[2]))) {
      const found = await one<{ id: string }>(
        `select id from brands where lower(name) = $1 and deleted_at is null`,
        [lower(name)],
      );
      brandId.set(
        name,
        found?.id ??
          (await catalog.createBrand(staff.owner, { name, country: BRAND_COUNTRIES[name] })).id,
      );
    }
    const supplierId = new Map<string, string>();
    for (const s of SUPPLIERS) {
      const found = await one<{ id: string }>(
        `select id from suppliers where lower(name) = $1 and deleted_at is null`,
        [lower(s.name)],
      );
      supplierId.set(
        s.name,
        found?.id ??
          (
            await parties.createSupplier(staff.manager, {
              name: s.name,
              contactPerson: s.contact,
              city: s.city,
              country: 'Ethiopia',
              paymentTermsDays: s.termsDays,
              notes: DEMO_NOTE,
            })
          ).id,
      );
    }
    const customerId = new Map<string, string>();
    for (const c of CUSTOMERS) {
      const found = await one<{ id: string; version: number; credit_limit_minor: string }>(
        `select id, version, credit_limit_minor from customers where lower(name) = $1 and deleted_at is null`,
        [lower(c.name)],
      );
      if (found) {
        customerId.set(c.name, found.id);
        continue;
      }
      const created = await parties.createCustomer(staff.manager, {
        name: c.name,
        type: c.type,
        city: 'Addis Ababa',
        notes: DEMO_NOTE,
      });
      customerId.set(c.name, created.id);
      if (c.creditBirr > 0) {
        await parties.updateCustomer(staff.manager, created.id, {
          version: created.version,
          creditLimitMinor: birr(c.creditBirr),
        });
      }
    }

    // Demand: cheap things sell more; the pace is scaled so the shop does a believable number of items a day.
    const subMeta = new Map(SUB_CATEGORIES.map((s) => [s.name, s]));
    const rawDemand = PRODUCTS.map(([sub, name, , cost, price]) => {
      const tier =
        price < 300 ? 1.6 : price < 800 ? 0.9 : price < 2000 ? 0.45 : price < 6000 ? 0.15 : 0.06;
      // Whatever sells below its cost is on the shelf by mistake, not by demand: it sells slowly.
      const mistake = price < cost ? 0.25 : 1;
      return mistake * tier * (0.7 + (hash(sub) % 8) / 10) * (0.6 + (hash(name) % 10) / 11);
    });
    const demandScale = 40 / rawDemand.reduce((s, d) => s + d, 0);
    const catalogue: ProductInfo[] = [];
    const counters = new Map<string, number>();
    for (let i = 0; i < PRODUCTS.length; i += 1) {
      const [sub, name, brand, cost, price, kindFlag] = PRODUCTS[i]!;
      const meta = subMeta.get(sub);
      if (!meta) throw new Error(`Unknown sub-category in the demo catalogue: ${sub}`);
      const n = (counters.get(meta.code) ?? 0) + 1;
      counters.set(meta.code, n);
      const sku = `${meta.type === 'ELECTRONICS' ? 'EL' : 'ST'}-${meta.code}-${String(n).padStart(3, '0')}`;
      const demand = rawDemand[i]! * demandScale;
      const reorderPoint = Math.max(3, Math.ceil(demand * 14));
      const reorderQty = Math.max(price >= 5000 ? 2 : 6, Math.ceil(demand * 30));
      let row = await one<{ id: string }>(
        `select id from products where lower(sku) = $1 and deleted_at is null`,
        [lower(sku)],
      );
      if (!row) {
        const created = await catalog.createProduct(staff.manager, {
          sku,
          barcode: `69100${String(100000 + i).padStart(8, '0')}`,
          name,
          description: DEMO_NOTE,
          categoryId: categoryId.get(meta.type)!,
          subCategoryId: subId.get(sub)!,
          brandId: brandId.get(brand)!,
          unitOfMeasure: 'piece',
          sellingPriceMinor: birr(price),
          ...(price > cost * 1.05 ? { minSellingPriceMinor: birr(Math.ceil(cost * 1.05)) } : {}),
          reorderPoint,
          reorderQty,
        });
        row = { id: created.id };
      }
      catalogue.push({
        id: row.id,
        sku,
        name,
        sub,
        type: meta.type,
        costMinor: birr(cost),
        priceMinor: birr(price),
        demand,
        kind: kindFlag ?? 'normal',
        supplier: meta.suppliers[0]!,
        reorderPoint,
        reorderQty,
      });
    }
    log(
      `  ${catalogue.length} products, ${SUPPLIERS.length} suppliers, ${CUSTOMERS.length} customers`,
    );

    // ---------------------------------------------------------------- the replay of trading days

    const counts: Record<string, number> = {
      sales: 0,
      voids: 0,
      saleReturns: 0,
      purchaseOrders: 0,
      receipts: 0,
      supplierPayments: 0,
      customerPayments: 0,
      purchaseReturns: 0,
      expenses: 0,
      damageReports: 0,
      stockAudits: 0,
      skipped: 0,
    };

    const stockNow = async () =>
      new Map(
        (
          await q<{ id: string; current_stock: number }>(
            `select id, current_stock from products where deleted_at is null`,
          )
        ).map((r) => [r.id, Number(r.current_stock)]),
      );
    const cashAvailable = async () => {
      const r = await one<{ cash: string; bank: string }>(
        `select coalesce(sum(case when a.code = '1000' then l.debit_minor - l.credit_minor end), 0) as cash,
              coalesce(sum(case when a.code = '1010' then l.debit_minor - l.credit_minor end), 0) as bank
         from journal_lines l join accounts a on a.id = l.account_id where a.code in ('1000', '1010')`,
      );
      return { cash: Number(r!.cash), bank: Number(r!.bank) };
    };
    /** How to pay an amount out without taking a till or a bank account below a working float. */
    const fundingFor = async (amount: number): Promise<'CASH' | 'BANK_TRANSFER' | null> => {
      const { cash, bank } = await cashAvailable();
      const floatMinor = birr(15_000);
      const bankOk = bank - amount >= floatMinor;
      const cashOk = cash - amount >= floatMinor;
      if (bankOk && cashOk) return bank >= cash ? 'BANK_TRANSFER' : 'CASH';
      return bankOk ? 'BANK_TRANSFER' : cashOk ? 'CASH' : null;
    };

    // Opening books on the first day, if nobody has opened them: cash, bank and the first shelves.
    const opened = await one(
      `select 1 as x from journal_entries where reference_type = 'OPENING_BALANCE' and status = 'POSTED' limit 1`,
    );
    if (!opened) {
      at(firstDay, '08:00');
      const inventory = catalogue
        .filter((p) => p.kind !== 'starved' || hash(p.sku) % 2 === 0)
        .map((p) => ({
          productId: p.id,
          quantity: Math.max(3, Math.ceil(p.demand * 24)),
          unitCostMinor: p.costMinor,
        }))
        .sort((a, b) => a.productId.localeCompare(b.productId));
      await once('opening-books', () =>
        accounting.openBooks(staff.owner, {
          cashMinor: birr(85_000),
          bankMinor: birr(120_000),
          inventory,
        }),
      );
      log('  opened the books: 85,000 cash, 120,000 bank and the first shelves');
    }

    const placeOrder = async (
      day: string,
      supplierName: string,
      lines: { p: ProductInfo; qty: number }[],
      tag: string,
      immediate = false,
    ) => {
      const created = await once(`po:${tag}`, async () => {
        const po = await purchases.create(staff.manager, {
          supplierId: supplierId.get(supplierName)!,
          notes: `${DEMO_NOTE}: restock ${tag}`,
          items: lines.map((l) => ({
            productId: l.p.id,
            orderedQty: l.qty,
            unitCostMinor: l.p.costMinor,
          })),
        });
        counts['purchaseOrders']!++;
        if (immediate) {
          await purchases.receive(staff.manager, po.id, {
            items: po.items.map((i) => ({ itemId: i.id, quantity: i.orderedQty })),
          });
          counts['receipts']!++;
        }
        return po;
      });
      return created;
    };

    const allDays = Array.from({ length: options.days }, (_, i) => addDays(firstDay, i));
    const clientsByName = new Map(CUSTOMERS.map((c) => [customerId.get(c.name)!, c]));
    const namedCustomers = CUSTOMERS.map((c) => ({ ...c, id: customerId.get(c.name)! }));
    const bulkBuyers = namedCustomers.filter((c) => c.creditBirr > 0);
    const retailBuyers = namedCustomers.filter((c) => c.creditBirr === 0);
    const daysTotal = allDays.length;

    for (let di = 0; di < daysTotal; di += 1) {
      const day = allDays[di]!;
      const r = stream(`day:${day}`);
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
      const dom = Number(day.slice(8, 10));
      const month = Number(day.slice(5, 7));
      const daysLeft = daysTotal - 1 - di;
      const stock = await stockNow();
      /** Units a day each product really sold over the last 30 days: what a buyer would go by. */
      const pace = new Map(
        (
          await q<{ id: string; units: string }>(
            `select si.product_id as id, sum(si.quantity - si.returned_qty) as units
               from sale_items si join sales s on s.id = si.sale_id
              where s.status = 'COMPLETED' and (s.sale_date at time zone $1)::date >= $2::date - 30
              group by 1`,
            [tz, day],
          )
        ).map((r) => [r.id, Number(r.units) / 30]),
      );
      const active = (p: ProductInfo) => !(p.kind === 'dormant' && di > 55);

      // 08:30 expenses on their usual days
      at(day, '08:30');
      const expense = async (
        tag: string,
        accountCode: '6000' | '6010' | '6020' | '6030' | '6040' | '6050' | '6900',
        description: string,
        amountBirr: number,
        vendor: string,
      ) => {
        await once(`expense:${tag}`, async () => {
          const method = await fundingFor(birr(amountBirr));
          if (!method) return;
          await accounting.createExpense(staff.accountant, {
            accountCode,
            description,
            amountMinor: birr(amountBirr),
            paymentMethod: method,
            expenseDate: day,
            vendor,
            receiptNumber: `DEMO-${tag}`,
          });
          counts['expenses']!++;
        });
      };
      if (dom === 1) await expense(`${day}:rent`, '6000', 'Shop rent', 45_000, 'Landlord, Bole');
      if (dom === 5)
        await expense(
          `${day}:utilities`,
          '6010',
          'Electricity and water',
          r.int(3800, 6500),
          'Addis Ababa Utilities',
        );
      if (dom === 28 || (dom === 27 && month === 2))
        await expense(`${day}:salaries`, '6020', 'Staff salaries', 38_000, 'Payroll');
      if (weekday === 1)
        await expense(
          `${day}:transport`,
          '6030',
          'Delivery of stock from suppliers',
          r.int(700, 2200),
          'Merkato transport',
        );
      if (dom === 15)
        await expense(
          `${day}:packaging`,
          '6040',
          'Bags and packaging',
          r.int(1800, 3000),
          'Packaging Plus',
        );
      if (dom === 1 && month % 3 === 1)
        await expense(
          `${day}:marketing`,
          '6050',
          'Social media and flyers',
          6_000,
          'Local print and ads',
        );
      if (dom === 12 || dom === 22)
        await expense(
          `${day}:misc`,
          '6900',
          r.pick([
            'Cleaning supplies',
            'Shop repairs',
            'Phone and internet',
            'Tea and coffee for the shop',
          ]),
          r.int(300, 1400),
          'Local supplier',
        );

      // 09:00 goods arrive: orders from at least two days ago; one in seven arrives in two parts
      at(day, '09:00');
      const arriving = await q<{ id: string; number: string }>(
        `select id, number from purchases where status in ('ORDERED', 'PARTIALLY_RECEIVED') and notes like $1 and order_date <= $2::date - 2 order by order_date, number`,
        [`${DEMO_NOTE}%`, day],
      );
      for (const po of arriving) {
        const full = await purchases.get(po.id);
        const fraction = full.status === 'PARTIALLY_RECEIVED' ? 1 : hash(po.id) % 7 === 0 ? 0.6 : 1;
        const items = full.items
          .map((i) => ({
            itemId: i.id,
            quantity: Math.ceil((i.orderedQty - i.receivedQty) * fraction),
          }))
          .filter((i) => i.quantity > 0);
        if (items.length === 0) continue;
        try {
          await purchases.receive(staff.manager, po.id, { items });
          counts['receipts']!++;
        } catch (e) {
          if (!isRefusal(e)) throw e;
        }
      }

      // 09:30 orders: each supplier on its own weekday, every third week (about three orders a week
      // across the shop), and everything on the first day
      at(day, '09:30');
      const week = Math.floor(di / 7);
      const dueSuppliers = new Set(
        SUPPLIERS.filter(
          (_, k) => di === 0 || (weekday === (k % 5) + 1 && (week + k) % 3 === 0),
        ).map((s) => s.name),
      );
      if (dueSuppliers.size > 0) {
        const wanted = new Map<string, { p: ProductInfo; qty: number }[]>();
        for (const p of catalogue) {
          if (!dueSuppliers.has(p.supplier) || !active(p)) continue;
          if (p.kind === 'starved' && daysLeft < 21) continue;
          if (p.kind === 'starved' && daysLeft < 28 && hash(p.sku) % 3 !== 0) continue;
          const onHand = stock.get(p.id) ?? 0;
          const inOrder = Number(
            (await one<{ n: string }>(
              `select coalesce(sum(pi.ordered_qty - pi.received_qty), 0) as n
               from purchase_items pi join purchases pu on pu.id = pi.purchase_id
              where pi.product_id = $1 and pu.status in ('ORDERED', 'PARTIALLY_RECEIVED')`,
              [p.id],
            ))!.n,
          );
          const rate = di < 21 ? p.demand : Math.max(p.demand * 0.5, pace.get(p.id) ?? 0);
          const floor = Math.max(3, Math.ceil(rate * 28));
          if (onHand + inOrder >= floor) continue;
          const target = Math.max(floor + 2, Math.ceil(rate * 45));
          const list = wanted.get(p.supplier) ?? [];
          list.push({
            p,
            qty: Math.max(p.priceMinor >= birr(5000) ? 2 : 6, target - onHand - inOrder),
          });
          wanted.set(p.supplier, list);
        }
        let n = 0;
        for (const [supplierName, lines] of [...wanted.entries()].sort()) {
          for (let from = 0; from < lines.length; from += 25) {
            n += 1;
            await placeOrder(
              day,
              supplierName,
              lines.slice(from, from + 25),
              `${day}-${n}`,
              di === 0 && Boolean(opened),
            );
          }
        }
      }

      // Trading: more on weekdays than Sundays. Each sale at its own minute between 10:00 and 19:00.
      const salesToday = weekday === 0 ? r.int(3, 6) : r.int(8, 15);
      const minutes = Array.from({ length: salesToday }, () => r.int(600, 1140)).sort(
        (a, b) => a - b,
      );
      const todaysSaleIds: string[] = [];
      for (let s = 0; s < salesToday; s += 1) {
        const cashier = staff.cashiers[(di + s) % staff.cashiers.length]!;
        at(
          day,
          `${String(Math.floor(minutes[s]! / 60)).padStart(2, '0')}:${String(minutes[s]! % 60).padStart(2, '0')}`,
        );
        // Who is buying
        const roll = r.next();
        const customer =
          roll < 0.05 && bulkBuyers.length > 0
            ? r.pick(bulkBuyers)
            : roll < 0.2
              ? r.pick(retailBuyers)
              : undefined;
        const bulk = customer !== undefined && customer.creditBirr > 0;
        // What they buy: lines weighted by how fast each product sells
        const pool2 = catalogue.filter((p) => active(p) && (stock.get(p.id) ?? 0) > 0);
        const picked: { p: ProductInfo; qty: number }[] = [];
        const lineCount = bulk ? r.int(3, 6) : r.int(1, 4);
        for (let l = 0; l < lineCount && pool2.length > 0; l += 1) {
          const total = pool2.reduce((sum, p) => sum + p.demand, 0);
          let point = r.next() * total;
          const choice = pool2.find((p) => (point -= p.demand) <= 0) ?? pool2[pool2.length - 1]!;
          pool2.splice(pool2.indexOf(choice), 1);
          const cheap = choice.priceMinor < birr(500);
          let qty = cheap ? r.int(1, 3) : choice.priceMinor < birr(1500) ? r.int(1, 2) : 1;
          if (bulk) qty = cheap ? r.int(5, 20) : r.int(2, 5);
          qty = Math.min(qty, stock.get(choice.id) ?? 0);
          if (qty > 0) picked.push({ p: choice, qty });
        }
        if (picked.length === 0) continue;
        const subtotal = picked.reduce((sum, l) => sum + l.p.priceMinor * l.qty, 0);
        // How they pay
        let paymentMethod: 'CASH' | 'BANK_TRANSFER' | 'MOBILE_MONEY' | 'CREDIT';
        let amountPaidMinor: number | undefined;
        let seller: Principal = cashier;
        if (bulk && customer) {
          const owes = await parties.getCustomer(customer.id);
          const headroom = owes.creditLimitMinor - owes.outstandingMinor;
          if (headroom >= subtotal && r.chance(0.8)) {
            paymentMethod = 'CREDIT';
            amountPaidMinor = r.chance(0.35) ? Math.floor(subtotal * 0.25) : 0;
          } else paymentMethod = 'BANK_TRANSFER';
        } else {
          const m = r.next();
          paymentMethod = m < 0.55 ? 'CASH' : m < 0.8 ? 'MOBILE_MONEY' : 'BANK_TRANSFER';
          if (paymentMethod === 'CASH') amountPaidMinor = Math.ceil(subtotal / 5_000) * 5_000;
        }
        // One sale in twenty is rung up by the manager with a small discount on the first line.
        let discountedLine: { productId: string; discountMinor: number } | undefined;
        if (!bulk && r.chance(0.05)) {
          seller = staff.manager;
          const first = picked[0]!;
          discountedLine = {
            productId: first.p.id,
            discountMinor: Math.floor((first.p.priceMinor * first.qty) / 20),
          };
        }
        try {
          const out = await sales.create(
            seller,
            {
              ...(customer ? { customerId: customer.id } : {}),
              paymentMethod,
              ...(amountPaidMinor !== undefined ? { amountPaidMinor } : {}),
              notes: DEMO_NOTE,
              items: picked.map((l) => ({
                productId: l.p.id,
                quantity: l.qty,
                ...(discountedLine && discountedLine.productId === l.p.id
                  ? { discountMinor: discountedLine.discountMinor }
                  : {}),
              })),
            },
            `demo-sale-${day}-${s}`,
          );
          if (!out.replayed) {
            counts['sales']!++;
            for (const l of picked) stock.set(l.p.id, (stock.get(l.p.id) ?? 0) - l.qty);
          }
          todaysSaleIds.push(out.body.id);
        } catch (e) {
          if (!isRefusal(e)) throw e;
          counts['skipped']!++;
        }
      }

      // 19:15 corrections: now and then a sale is voided; a few returns; damage; counts
      at(day, '19:15');
      if (di % 19 === 7 && todaysSaleIds.length > 2) {
        await once(`void:${day}`, async () => {
          const target = todaysSaleIds[todaysSaleIds.length - 1]!;
          try {
            await sales.void(staff.manager, target, { reason: 'Rung up twice by mistake' });
            counts['voids']!++;
          } catch (e) {
            if (!isRefusal(e)) throw e;
          }
        });
      }
      if (di > 8 && di % 6 === 2 && daysLeft > 0) {
        await once(`sale-return:${day}`, async () => {
          const candidates = await q<{
            sale_id: string;
            item_id: string;
            method: string;
            remaining: number;
          }>(
            `select s.id as sale_id, si.id as item_id, s.payment_method as method, si.quantity - si.returned_qty as remaining
             from sales s join sale_items si on si.sale_id = s.id
            where s.status = 'COMPLETED' and s.payment_method <> 'CREDIT' and si.quantity - si.returned_qty > 0
              and (s.sale_date at time zone $1)::date between $2::date - 9 and $2::date - 1
            order by s.number, si.id`,
            [tz, day],
          );
          if (candidates.length === 0) return;
          const c = candidates[r.int(0, candidates.length - 1)]!;
          try {
            await saleReturns.create(staff.manager, c.sale_id, {
              reason: r.pick([
                'Did not fit the phone',
                'Stopped working after a day',
                'Wrong item bought',
                'Changed their mind',
              ]),
              refundMethod: c.method === 'CASH' ? 'CASH' : 'BANK_TRANSFER',
              items: [{ saleItemId: c.item_id, quantity: 1, restockable: r.chance(0.7) }],
            });
            counts['saleReturns']!++;
          } catch (e) {
            if (!isRefusal(e)) throw e;
          }
        });
      }
      if (di > 14 && di % 23 === 4) {
        await once(`purchase-return:${day}`, async () => {
          const candidates = await q<{
            purchase_id: string;
            item_id: string;
            paid: string;
            stock: number;
          }>(
            `select pu.id as purchase_id, pi.id as item_id, pu.paid_minor as paid, p.current_stock as stock
             from purchase_items pi join purchases pu on pu.id = pi.purchase_id join products p on p.id = pi.product_id
            where pu.status = 'RECEIVED' and pu.notes like $1 and pi.received_qty - pi.returned_qty >= 2 and p.current_stock >= 4
              and pu.received_date <= $2::date - 3
            order by pu.number, pi.id`,
            [`${DEMO_NOTE}%`, day],
          );
          if (candidates.length === 0) return;
          const c = candidates[r.int(0, candidates.length - 1)]!;
          try {
            await purchaseReturns.create(staff.manager, c.purchase_id, {
              reason: 'Faulty on delivery, sent back to the supplier',
              ...(Number(c.paid) > 0 ? { refundMethod: 'BANK_TRANSFER' as const } : {}),
              items: [{ purchaseItemId: c.item_id, quantity: 2 }],
            });
            counts['purchaseReturns']!++;
          } catch (e) {
            if (!isRefusal(e)) throw e;
          }
        });
      }
      // Damage: reported on some days and decided the day after (the last days are left waiting)
      if (daysLeft >= 3) {
        const waiting = await q<{ id: string }>(
          `select id from damage_records where status = 'PENDING' and cause like $1 and created_at < $2::timestamptz order by number`,
          ['Demo:%', new Date(base - 20 * 3600 * 1000).toISOString()],
        );
        for (const d of waiting) {
          await once(`damage-decide:${d.id}`, async () => {
            try {
              if (hash(d.id) % 7 === 0)
                await damage.reject(staff.owner, d.id, {
                  note: 'Counted again: the item was found',
                });
              else await damage.approve(staff.owner, d.id, { note: 'Checked and approved' });
            } catch (e) {
              if (!isRefusal(e)) throw e;
            }
          });
        }
      }
      if (di % 11 === 5 || daysLeft === 2 || daysLeft === 0) {
        await once(`damage-report:${day}`, async () => {
          const candidates = catalogue.filter(
            (p) => (stock.get(p.id) ?? 0) >= 4 && p.priceMinor < birr(3000),
          );
          if (candidates.length === 0) return;
          const p = r.pick(candidates);
          try {
            await damage.report(r.chance(0.5) ? staff.cashiers[0]! : staff.manager, {
              productId: p.id,
              kind: r.chance(0.8) ? 'DAMAGE' : 'WRITE_OFF',
              quantity: r.int(1, 2),
              cause: `Demo: ${r.pick(['dropped in the shop', 'water damage in the store room', 'screen cracked in the box', 'past its useful life'])}`,
            });
            counts['damageReports']!++;
          } catch (e) {
            if (!isRefusal(e)) throw e;
          }
        });
      }
      // A completed stock count two months ago, and one in progress now
      if (daysLeft === 62) {
        await once('audit-complete', async () => {
          const subset = catalogue
            .filter((p) => p.sub === 'Chargers - Type-C' || p.sub === 'Batteries')
            .slice(0, 14);
          const started = await audits.start(staff.manager, {
            productIds: subset.map((p) => p.id),
            notes: `${DEMO_NOTE}: quarterly count, chargers and batteries`,
          });
          at(day, '19:40');
          const sys = await stockNow();
          await audits.count(staff.manager, started.id, {
            counts: subset.map((p, k) => ({
              productId: p.id,
              physicalQty: Math.max(
                0,
                (sys.get(p.id) ?? 0) + (k === 2 ? -2 : k === 5 ? -1 : k === 9 ? 2 : 0),
              ),
            })),
          });
          await audits.submit(staff.manager, started.id);
          await audits.approve(staff.owner, started.id);
          counts['stockAudits']!++;
        });
      }
      if (daysLeft === 1) {
        await once('audit-in-progress', async () => {
          const subset = catalogue
            .filter((p) => p.sub === 'Notebooks' || p.sub === 'Pens and pencils')
            .slice(0, 10);
          const started = await audits.start(staff.manager, {
            productIds: subset.map((p) => p.id),
            notes: `${DEMO_NOTE}: stationery count in progress`,
          });
          const sys = await stockNow();
          await audits.count(staff.manager, started.id, {
            counts: subset.slice(0, 4).map((p, k) => ({
              productId: p.id,
              physicalQty: Math.max(0, (sys.get(p.id) ?? 0) - (k === 1 ? 1 : 0)),
            })),
          });
          counts['stockAudits']!++;
        });
      }

      // 19:30 money: customers settle credit sales, we pay suppliers when it is due and the money is there
      at(day, '19:30');
      const credit = await q<{
        id: string;
        customer_id: string;
        owed: string;
        age: number;
        payments: number;
        sale_date: string;
      }>(
        `select s.id, s.customer_id, s.total_minor - s.amount_paid_minor as owed,
              ($2::date - (s.sale_date at time zone $1)::date) as age,
              (select count(*)::int from settlements st where st.sale_id = s.id) as payments, s.sale_date::text
         from sales s
        where s.status = 'COMPLETED' and s.payment_method = 'CREDIT' and s.total_minor > s.amount_paid_minor
        order by s.sale_date, s.number`,
        [tz, day],
      );
      for (const sale of credit) {
        const who = clientsByName.get(sale.customer_id);
        const h = hash(sale.id);
        const firstDue = 12 + (h % 35);
        const age = Number(sale.age);
        const slow = who?.slowPayer === true && age < 120;
        if (slow) continue;
        let amount = 0;
        if (Number(sale.payments) === 0 && age >= firstDue)
          amount = h % 5 === 0 ? Math.floor(Number(sale.owed) / 2) : Number(sale.owed);
        else if (Number(sale.payments) > 0 && age >= firstDue + 25) amount = Number(sale.owed);
        if (amount <= 0) continue;
        await once(`customer-pays:${sale.id}:${Number(sale.payments)}`, async () => {
          try {
            await sales.receivePayment(staff.manager, sale.id, {
              amountMinor: amount,
              method: h % 3 === 0 ? 'CASH' : 'BANK_TRANSFER',
            });
            counts['customerPayments']!++;
          } catch (e) {
            if (!isRefusal(e)) throw e;
          }
        });
      }
      const owed = await q<{
        id: string;
        payable: string;
        received: string;
        terms: number;
        paid: string;
      }>(
        `select pu.id, pu.received_value_minor - pu.paid_minor as payable, pu.received_date::text as received, s.payment_terms_days as terms, pu.paid_minor as paid
         from purchases pu join suppliers s on s.id = pu.supplier_id
        where pu.status <> 'CANCELLED' and pu.received_value_minor > pu.paid_minor and pu.received_date is not null
        order by pu.received_date, pu.number`,
      );
      for (const po of owed) {
        const h = hash(po.id);
        const dueOn = addDays(po.received, Math.max(po.terms, 7) + (h % 6));
        if (day < dueOn) continue;
        // one order in twenty-five is left unpaid for a long time, so there are overdue payables to see
        if (h % 25 === 0 && daysLeft < 120) continue;
        const amount =
          Number(po.paid) === 0 && h % 9 === 0
            ? Math.floor(Number(po.payable) / 2)
            : Number(po.payable);
        const method = await fundingFor(amount);
        if (!method || amount <= 0) continue;
        await once(`supplier-paid:${po.id}:${Number(po.paid) > 0 ? 2 : 1}`, async () => {
          try {
            await purchases.pay(staff.manager, po.id, { amountMinor: amount, method });
            counts['supplierPayments']!++;
          } catch (e) {
            if (!isRefusal(e)) throw e;
          }
        });
      }
      if (di % 30 === 0) log(`  ${day}: ${counts['sales']} sales so far`);
    }

    // The manager sets reorder points from what really sold, as a shop does after a few months.
    await once('tune-reorder-points', async () => {
      at(today, '20:00');
      const rows = await q<{ id: string; version: number; units: string }>(
        `select p.id, p.version, coalesce(v.units, 0) as units
           from products p
           left join (
             select si.product_id, sum(si.quantity - si.returned_qty) as units
               from sale_items si join sales s on s.id = si.sale_id
              where s.status = 'COMPLETED' and (s.sale_date at time zone $1)::date >= $2::date - 90
              group by 1
           ) v on v.product_id = p.id
          where p.deleted_at is null and p.description = '${DEMO_NOTE}'`,
        [tz, today],
      );
      for (const r of rows) {
        const velocity = Number(r.units) / 90;
        if (velocity <= 0) continue;
        const priceyFloor = Number(r.units) / 90 < 0.2 ? 2 : 6;
        await catalog.updateProduct(staff.manager, r.id, {
          version: Number(r.version),
          reorderPoint: Math.max(3, Math.ceil(velocity * 14)),
          reorderQty: Math.max(priceyFloor, Math.ceil(velocity * 30)),
        });
      }
    });

    // ---------------------------------------------------------------- is the picture consistent?

    const checks: SeedReport['checks'] = [];
    const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
    const valuation = await accounting.inventoryValuation();
    check(
      'stock on the shelves equals the inventory account',
      valuation.reconciled,
      `${valuation.totalValueMinor} vs ${valuation.inventoryAccountMinor}`,
    );
    const tb = await accounting.trialBalance({ from: firstDay, to: today });
    check(
      'the trial balance balances',
      tb.balanced,
      `debits ${tb.totalDebitMinor}, credits ${tb.totalCreditMinor}`,
    );
    const negative = await one<{ n: string }>(
      `select count(*)::int as n from products where current_stock < 0`,
    );
    check('no product has negative stock', Number(negative!.n) === 0, `${negative!.n} negative`);
    const sheet = await accounting.balanceSheet({ asOf: today });
    check('the balance sheet balances', sheet.balanced, `assets ${sheet.totalAssetsMinor}`);
    const cash = await cashAvailable();
    check(
      'cash and bank are not overdrawn',
      cash.cash >= 0 && cash.bank >= 0,
      `cash ${cash.cash}, bank ${cash.bank}`,
    );

    if (checks.every((c) => c.ok)) await mark('seeded');
    return { alreadySeeded: false, days: options.days, counts, checks };
  } finally {
    restoreClock();
  }
}
