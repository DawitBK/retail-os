import { Inject, Injectable } from '@nestjs/common';
import { conflict, notFound, ProblemException, toPage } from '@retail/kit';
import { and, asc, count, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { recordAudit } from '../common/audit.js';
import type { Principal } from '../common/auth.js';
import { escapeLike, pgCode, versionConflict } from '../common/errors.js';
import { DB, type Database, type Tx } from '../db/db.module.js';
import {
  customers,
  purchases,
  sales,
  suppliers,
  type CustomerRow,
  type SupplierRow,
} from '../db/schema.js';
import type {
  CreateCustomer,
  CreateSupplier,
  CustomerDto,
  ListCustomersQuery,
  ListSuppliersQuery,
  SupplierDto,
  UpdateCustomer,
  UpdateSupplier,
} from './parties.contract.js';

const toCustomerDto = (r: CustomerRow, outstandingMinor: number): CustomerDto => ({
  id: r.id,
  name: r.name,
  email: r.email,
  phone: r.phone,
  address: r.address,
  city: r.city,
  type: r.type,
  creditLimitMinor: r.creditLimitMinor,
  outstandingMinor,
  notes: r.notes,
  version: r.version,
  createdAt: r.createdAt.toISOString(),
});

const toSupplierDto = (r: SupplierRow, payableMinor: number): SupplierDto => ({
  id: r.id,
  name: r.name,
  contactPerson: r.contactPerson,
  email: r.email,
  phone: r.phone,
  address: r.address,
  city: r.city,
  country: r.country,
  paymentTermsDays: r.paymentTermsDays,
  payableMinor,
  notes: r.notes,
  version: r.version,
  createdAt: r.createdAt.toISOString(),
});

const touch = () => ({ version: sql`version + 1`, updatedAt: sql`now()` });

/** What a customer owes: the unpaid part of their completed credit sales. Derived, never stored. */
export async function outstandingOf(
  executor: Pick<Database, 'select'>,
  customerIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>(customerIds.map((id) => [id, 0]));
  if (customerIds.length === 0) return map;
  const rows = await executor
    .select({
      customerId: sales.customerId,
      owed: sql<number>`coalesce(sum(${sales.totalMinor} - ${sales.amountPaidMinor}), 0)::bigint`,
    })
    .from(sales)
    .where(
      and(
        inArray(sales.customerId, customerIds),
        eq(sales.paymentMethod, 'CREDIT'),
        eq(sales.status, 'COMPLETED'),
      ),
    )
    .groupBy(sales.customerId);
  for (const r of rows) if (r.customerId) map.set(r.customerId, Number(r.owed));
  return map;
}

/** What we owe a supplier: value received minus value paid, over purchases that were not cancelled. */
async function payableOf(
  executor: Pick<Database, 'select'>,
  supplierIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>(supplierIds.map((id) => [id, 0]));
  if (supplierIds.length === 0) return map;
  const rows = await executor
    .select({
      supplierId: purchases.supplierId,
      owed: sql<number>`coalesce(sum(${purchases.receivedValueMinor} - ${purchases.paidMinor}), 0)::bigint`,
    })
    .from(purchases)
    .where(and(inArray(purchases.supplierId, supplierIds), ne(purchases.status, 'CANCELLED')))
    .groupBy(purchases.supplierId);
  for (const r of rows) map.set(r.supplierId, Number(r.owed));
  return map;
}

@Injectable()
export class PartiesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // ---------- customers ----------

  async createCustomer(actor: Principal, input: CreateCustomer): Promise<CustomerDto> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(customers)
        .values({
          name: input.name,
          email: input.email ?? null,
          phone: input.phone ?? null,
          address: input.address ?? null,
          city: input.city ?? null,
          type: input.type,
          notes: input.notes ?? null,
        })
        .returning();
      const dto = toCustomerDto(row!, 0);
      await recordAudit(tx, {
        actor: actor.userId,
        action: 'customer.created',
        entityType: 'customer',
        entityId: dto.id,
        after: dto,
      });
      return dto;
    });
  }

  async listCustomers(query: ListCustomersQuery) {
    const where: SQL[] = [isNull(customers.deletedAt)];
    if (query.type) where.push(eq(customers.type, query.type));
    if (query.q) {
      const like = `%${escapeLike(query.q)}%`;
      where.push(
        or(
          ilike(customers.name, like),
          ilike(customers.phone, like),
          ilike(customers.email, like),
        ) as SQL,
      );
    }
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(customers)
        .where(and(...where))
        .orderBy(asc(sql`lower(${customers.name})`), asc(customers.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: count() })
        .from(customers)
        .where(and(...where)),
    ]);
    const owed = await outstandingOf(
      this.db,
      rows.map((r) => r.id),
    );
    return toPage(
      rows.map((r) => toCustomerDto(r, owed.get(r.id) ?? 0)),
      totals[0]?.total ?? 0,
      query,
    );
  }

  async getCustomer(id: string): Promise<CustomerDto> {
    const [row] = await this.db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), isNull(customers.deletedAt)));
    if (!row) throw notFound(`Customer ${id} does not exist`);
    const owed = await outstandingOf(this.db, [id]);
    return toCustomerDto(row, owed.get(id) ?? 0);
  }

  async updateCustomer(actor: Principal, id: string, input: UpdateCustomer): Promise<CustomerDto> {
    return this.db.transaction(async (tx) => {
      const current = await this.lockCustomer(tx, id);
      if (current.version !== input.version) {
        throw versionConflict('customer', current.version, input.version);
      }
      const changes: Partial<UpdateCustomer> = { ...input };
      delete changes.version;
      const [row] = await tx
        .update(customers)
        .set({ ...changes, ...touch() })
        .where(eq(customers.id, id))
        .returning();
      const owed = await outstandingOf(tx, [id]);
      const after = toCustomerDto(row!, owed.get(id) ?? 0);
      await recordAudit(tx, {
        actor: actor.userId,
        action: 'customer.updated',
        entityType: 'customer',
        entityId: id,
        before: toCustomerDto(current, owed.get(id) ?? 0),
        after,
      });
      return after;
    });
  }

  async deleteCustomer(actor: Principal, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const current = await this.lockCustomer(tx, id);
      const owed = (await outstandingOf(tx, [id])).get(id) ?? 0;
      if (owed > 0) {
        throw conflict('customer-owes-money', 'Customer still owes money', `${owed} minor units`);
      }
      await tx
        .update(customers)
        .set({ deletedAt: sql`now()`, ...touch() })
        .where(eq(customers.id, id));
      await recordAudit(tx, {
        actor: actor.userId,
        action: 'customer.deleted',
        entityType: 'customer',
        entityId: id,
        before: toCustomerDto(current, 0),
      });
    });
  }

  // ---------- suppliers ----------

  async createSupplier(actor: Principal, input: CreateSupplier): Promise<SupplierDto> {
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(suppliers)
          .values({
            name: input.name,
            contactPerson: input.contactPerson ?? null,
            email: input.email ?? null,
            phone: input.phone ?? null,
            address: input.address ?? null,
            city: input.city ?? null,
            country: input.country ?? null,
            paymentTermsDays: input.paymentTermsDays,
            notes: input.notes ?? null,
          })
          .returning();
        const dto = toSupplierDto(row!, 0);
        await recordAudit(tx, {
          actor: actor.userId,
          action: 'supplier.created',
          entityType: 'supplier',
          entityId: dto.id,
          after: dto,
        });
        return dto;
      });
    } catch (e) {
      throw nameConflict(e);
    }
  }

  async listSuppliers(query: ListSuppliersQuery) {
    const where: SQL[] = [isNull(suppliers.deletedAt)];
    if (query.q) {
      const like = `%${escapeLike(query.q)}%`;
      where.push(
        or(
          ilike(suppliers.name, like),
          ilike(suppliers.contactPerson, like),
          ilike(suppliers.phone, like),
          ilike(suppliers.email, like),
        ) as SQL,
      );
    }
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(suppliers)
        .where(and(...where))
        .orderBy(asc(sql`lower(${suppliers.name})`), asc(suppliers.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: count() })
        .from(suppliers)
        .where(and(...where)),
    ]);
    const owed = await payableOf(
      this.db,
      rows.map((r) => r.id),
    );
    return toPage(
      rows.map((r) => toSupplierDto(r, owed.get(r.id) ?? 0)),
      totals[0]?.total ?? 0,
      query,
    );
  }

  async getSupplier(id: string): Promise<SupplierDto> {
    const [row] = await this.db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, id), isNull(suppliers.deletedAt)));
    if (!row) throw notFound(`Supplier ${id} does not exist`);
    const owed = await payableOf(this.db, [id]);
    return toSupplierDto(row, owed.get(id) ?? 0);
  }

  async updateSupplier(actor: Principal, id: string, input: UpdateSupplier): Promise<SupplierDto> {
    try {
      return await this.db.transaction(async (tx) => {
        const current = await this.lockSupplier(tx, id);
        if (current.version !== input.version) {
          throw versionConflict('supplier', current.version, input.version);
        }
        const changes: Partial<UpdateSupplier> = { ...input };
        delete changes.version;
        const [row] = await tx
          .update(suppliers)
          .set({ ...changes, ...touch() })
          .where(eq(suppliers.id, id))
          .returning();
        const owed = await payableOf(tx, [id]);
        const after = toSupplierDto(row!, owed.get(id) ?? 0);
        await recordAudit(tx, {
          actor: actor.userId,
          action: 'supplier.updated',
          entityType: 'supplier',
          entityId: id,
          before: toSupplierDto(current, owed.get(id) ?? 0),
          after,
        });
        return after;
      });
    } catch (e) {
      throw nameConflict(e);
    }
  }

  async deleteSupplier(actor: Principal, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const current = await this.lockSupplier(tx, id);
      const owed = (await payableOf(tx, [id])).get(id) ?? 0;
      if (owed > 0) {
        throw conflict('supplier-is-owed', 'We still owe this supplier', `${owed} minor units`);
      }
      const [{ open } = { open: 0 }] = await tx
        .select({ open: count() })
        .from(purchases)
        .where(
          and(
            eq(purchases.supplierId, id),
            inArray(purchases.status, ['ORDERED', 'PARTIALLY_RECEIVED']),
          ),
        );
      if (open > 0) {
        throw conflict('supplier-has-open-orders', 'Supplier has open purchase orders');
      }
      await tx
        .update(suppliers)
        .set({ deletedAt: sql`now()`, ...touch() })
        .where(eq(suppliers.id, id));
      await recordAudit(tx, {
        actor: actor.userId,
        action: 'supplier.deleted',
        entityType: 'supplier',
        entityId: id,
        before: toSupplierDto(current, 0),
      });
    });
  }

  private async lockCustomer(tx: Tx, id: string): Promise<CustomerRow> {
    const [row] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), isNull(customers.deletedAt)))
      .for('update');
    if (!row) throw notFound(`Customer ${id} does not exist`);
    return row;
  }

  private async lockSupplier(tx: Tx, id: string): Promise<SupplierRow> {
    const [row] = await tx
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, id), isNull(suppliers.deletedAt)))
      .for('update');
    if (!row) throw notFound(`Supplier ${id} does not exist`);
    return row;
  }
}

function nameConflict(error: unknown): unknown {
  if (error instanceof ProblemException) return error;
  if (pgCode(error) === '23505') return conflict('name-taken', 'A supplier with this name exists');
  return error;
}
