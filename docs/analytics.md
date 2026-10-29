# Analytics, forecasting and import

All figures come from the ledger, the sale lines and the movement history, never from stored
counters. Money is integer minor units (santim). Percentages are rounded to two places.

## Per product (`GET /analytics/products`, `/analytics/products/:id`)

| Figure              | Rule                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Units sold (30d)    | completed sale lines of the last 30 business days, less units returned                      |
| Velocity            | units sold in 30 days / 30                                                                  |
| Days of stock       | stock / velocity (none when nothing sold)                                                   |
| Average cost        | stock value / stock (the stock value is exact, so this is derived)                          |
| Margin %            | (price - average cost) / price                                                              |
| Movement status     | FAST above 1 a day, NORMAL from 0.1, SLOW below that, DEAD when nothing sold for 90 days    |
| Flags               | out of stock, low stock (at or below the reorder point), negative margin (price below cost) |
| GMROI (per product) | annualised gross profit of the last 30 days / stock value                                   |
| DIO (per product)   | stock value / annualised cost of goods sold x 365                                           |

## Stock efficiency (`GET /analytics/inventory?days=90`)

Opening value = closing value less the net value of movements in the window; average = (opening +
closing) / 2. Turnover = cost of goods sold / average value, annualised. Days of inventory = 365 /
turnover. GMROI = annualised gross profit / average value. Sell-through = units sold / (opening units

- units received). Shrinkage % = value lost to count adjustments / average value. Ageing buckets are
  days since a product last sold (or was created): 0-30, 31-60, 61-90, 90+. Dead stock is stock that
  has not sold for 90 days, valued at cost.

## Profit by group (`GET /analytics/profitability`)

By category, sub-category, brand or product, from completed sale lines in a range (default the last
90 days). Returned units come out of units, revenue and cost in proportion. The profit and loss
statement remains the authority on totals.

## Cash (`GET /analytics/cashflow`, `GET /accounting/cash-flow`)

Weekly inflow and outflow are the debits and credits on cash in hand and cash at bank, excluding the
opening balance. The cash flow statement (direct method) groups the same lines by what caused them:
sales received, credit customers paid, refunds from suppliers, suppliers paid, expenses paid, refunds
to customers, voids and reversals, opening balance. It reports `reconciled: true` only when closing
cash equals the ledger. Payables and receivables are aged by days since the goods were received (or
ordered) and since the credit sale.

## Month by month (`GET /analytics/trajectory?months=6`)

Revenue, cost of goods, gross profit and margin, expenses, expense ratio, net profit, ending cash
(cash in hand + bank) and stock value, per month, from the ledger. The year-end closing entry is
excluded from trading, as in the profit and loss.

## Forecasting (`GET /forecasting/*`, owner and manager)

Pure arithmetic on the 30-day pace, not a model, and every response says so ("Based on a 30-day
moving average ... For guidance only").

- **reorder**: products out, at or below the reorder point, or with 30 days of stock or less, soonest first. Stockout date = today + days of stock. Reorder by = stockout date minus the supplier lead time (`leadTimeDays`, default 7), never earlier than today.
- **dead-stock**: stock unsold for 90 days, ordered by risk = days since last sale x value in birr / 1000.
- **sales**: for the 50 best sellers, predicted units for the next 30 days = velocity x 30, predicted revenue at the current price, predicted end stock (not below zero).
- **suggestions**: purchase lines for products that need stock, grouped by the supplier each was last bought from (and "No supplier yet" when never bought). Quantity = the larger of the reorder quantity and (reorder point - stock + reorder quantity); cost = last purchase cost, else average cost.

## Import (`POST /import/inventory`, owner only)

A CSV with the columns `sku, name, type, category, sub_category, brand, barcode, unit, price,
min_price, reorder_point, reorder_qty, quantity, unit_cost` (prices in birr, `1200.50`). `sku`,
`name`, `price` and `category` are required; `type` (ELECTRONICS or STATIONERY) is required when the
category is new; `unit_cost` is required with a `quantity`.

- `dryRun: true` reports what would happen and changes nothing.
- All rows or none: any error answers 422 with every problem by row and column; nothing is written.
- Categories, sub-categories and brands that do not exist are created. Products whose SKU exists are
  left exactly as they are and listed as skipped, so a file can be sent twice.
- Stock that comes in is an opening-balance movement per product and **one** journal entry: debit
  inventory, credit owner's capital (the same treatment as the opening balances, and the one the
  original specification gives to imports). The shelf and the inventory account stay equal.
- Excel files must be saved as CSV first; the importer reads CSV only.
