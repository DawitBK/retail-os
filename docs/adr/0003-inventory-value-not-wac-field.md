# ADR-0003: Track the value of the stock, derive the average cost

**Status:** accepted

The original design stored a weighted average cost per product and updated it on every receipt,
rounding to the santim. Selling at a rounded average means the inventory account (which is credited
by the rounded cost of each sale) and the sum of stock times average cost slowly drift apart.

Instead each product stores `current_stock` and `stock_value_minor`, both exact integers. A receipt
adds its units and total cost. An issue takes `round(value x qty / stock)`, and the **last unit out
takes whatever value is left**, so the value reaches exactly zero when the stock does. The weighted
average cost is `value / stock`, derived on read. Consequences:

- the stock records and the inventory account agree to the last santim, always (a test asserts it after
  a run of purchases, sales and voids, and a unit test checks the arithmetic with values above
  2^53 using BigInt);
- a sale's cost is snapshotted on its lines; a void restocks at that cost, so a round trip changes
  nothing;
- there is no "recalculate WAC" job, because there is nothing to recalculate.

**Rejected:** storing WAC as a float or as `numeric(15,2)`; FIFO layers (more bookkeeping than a
shop of this size needs, and the owner asked for weighted average).
