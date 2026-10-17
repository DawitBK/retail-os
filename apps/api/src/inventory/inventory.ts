import { ProblemException } from '@retail/kit';
import { eq, sql } from 'drizzle-orm';
import type { Tx } from '../db/db.module.js';
import { inventoryMovements, products, type MovementType } from '../db/schema.js';

/** Which movement types put stock in. Everything else takes stock out. */
const INCOMING: ReadonlySet<MovementType> = new Set([
  'OPENING_BALANCE',
  'PURCHASE_RECEIPT',
  'SALE_VOID',
]);

/**
 * What it costs to take `qty` units out of a stock of `stock` units worth `value`: the average
 * cost, rounded to a whole minor unit, except that the last unit out takes whatever value is left.
 * That keeps the value on the shelf exactly equal to the sum of what went in minus what went out,
 * so the inventory account and the stock records can never drift apart by rounding.
 */
export function issueCost(value: number, stock: number, qty: number): number {
  if (qty === stock) return value;
  const cost = (BigInt(value) * BigInt(qty) + BigInt(stock) / 2n) / BigInt(stock);
  return Number(cost);
}

export interface MovementResult {
  stockBefore: number;
  stockAfter: number;
  valueBefore: number;
  valueAfter: number;
  /** The cost that left the shelf (outgoing) or entered it (incoming), always positive. */
  costMinor: number;
}

export interface MovementInput {
  productId: string;
  type: MovementType;
  /** Always positive. */
  quantity: number;
  /** Incoming movements only: the total cost of the units arriving (unit cost x quantity). */
  totalCostMinor?: number;
  referenceType: string;
  referenceId: string;
  notes?: string;
  createdBy: string;
}

/**
 * THE ONLY FUNCTION ALLOWED TO CHANGE A PRODUCT'S STOCK OR ITS VALUE. It writes the movement and
 * updates the product in the same transaction, and tells the database it is the one writing (a
 * trigger refuses every other change to those two columns). Callers that touch several products
 * must do so in a fixed order (by product id) so concurrent sales cannot deadlock.
 */
export async function applyMovement(tx: Tx, input: MovementInput): Promise<MovementResult> {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    throw new Error('A movement quantity must be a positive whole number');
  }
  const [product] = await tx
    .select({
      id: products.id,
      name: products.name,
      stock: products.currentStock,
      value: products.stockValueMinor,
    })
    .from(products)
    .where(eq(products.id, input.productId))
    .for('update');
  if (!product) throw new Error(`Product ${input.productId} does not exist`);

  const incoming = INCOMING.has(input.type);
  let cost: number;
  let stockAfter: number;
  let valueAfter: number;
  if (incoming) {
    cost = input.totalCostMinor ?? 0;
    if (!Number.isSafeInteger(cost) || cost < 0) {
      throw new Error('An incoming movement needs a whole, non-negative total cost');
    }
    stockAfter = product.stock + input.quantity;
    valueAfter = product.value + cost;
  } else {
    if (product.stock < input.quantity) {
      throw new ProblemException(
        409,
        'insufficient-stock',
        'Not enough stock',
        `"${product.name}" has ${product.stock} on hand, ${input.quantity} requested`,
        { productId: product.id, available: product.stock },
      );
    }
    cost = issueCost(product.value, product.stock, input.quantity);
    stockAfter = product.stock - input.quantity;
    valueAfter = product.value - cost;
  }

  // The trigger on `products` only lets stock and value change inside this scope.
  await tx.execute(sql`select set_config('retail.inventory_write', 'on', true)`);
  await tx
    .update(products)
    .set({
      currentStock: stockAfter,
      stockValueMinor: valueAfter,
      ...(incoming && input.type !== 'SALE_VOID' ? { lastRestockedAt: sql`now()` } : {}),
      ...(input.type === 'SALE' ? { lastSoldAt: sql`now()` } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(products.id, input.productId));
  await tx.insert(inventoryMovements).values({
    productId: input.productId,
    movementType: input.type,
    quantity: input.quantity,
    valueDeltaMinor: incoming ? cost : -cost,
    stockBefore: product.stock,
    stockAfter,
    valueBeforeMinor: product.value,
    valueAfterMinor: valueAfter,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    notes: input.notes ?? null,
    createdBy: input.createdBy,
  });
  return {
    stockBefore: product.stock,
    stockAfter,
    valueBefore: product.value,
    valueAfter,
    costMinor: cost,
  };
}
