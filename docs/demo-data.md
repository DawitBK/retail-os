# Demo data

`seed:demo` fills a database with a connected demo business: a hybrid electronics and stationery
shop in Addis Ababa that has traded for six months. It does not insert rows. It **replays the
trading days through the same services the API uses** (sales, purchases, receipts, payments,
returns, damage, stock counts, expenses), with the application clock moved to each day, so the stock,
the books and every report agree by construction. The stock-equals-books check at the end is the
same one the accounting tests make.

## What it creates

| Area               | Content                                                                                                                                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalogue          | 2 categories, 20 sub-categories, 36 brands, 166 products with barcodes, costs and prices (including products priced below or at cost, to show the negative-margin alerts)                                                                       |
| Parties            | 8 suppliers with payment terms, 20 customers (3 institutional and 2 wholesale on credit with limits, 15 retail)                                                                                                                                 |
| Staff              | The owner that exists, plus a manager, an accountant and cashiers (existing ones are reused; missing ones are created with `DEMO_STAFF_PASSWORD`)                                                                                               |
| Opening position   | 85,000 birr cash, 120,000 birr bank and the first shelves, posted against the owner's capital                                                                                                                                                   |
| Trading (180 days) | about 1,900 sales (8 to 15 a weekday, 3 to 6 on Sunday) by cash, mobile money, bank transfer and credit; manager discounts; voids                                                                                                               |
| Buying             | about 3 purchase orders a week, each supplier on its own weekday; partial deliveries; goods received into stock; supplier payments when due and when the money is there; some orders left on order or unpaid                                    |
| Credit             | customers settle credit sales in full or in two parts; two customers are slow payers, so there are overdue receivables                                                                                                                          |
| Corrections        | about 6 returns a month (sale returns restockable or scrap, and purchase returns to suppliers), 2 to 3 damage reports a month (approved by the owner, one in seven rejected), one stock count approved two months ago and one still in progress |
| Running costs      | rent, utilities, salaries, transport, packaging, marketing and miscellaneous expenses                                                                                                                                                           |
| States on screen   | out of stock, low stock, negative margin, dead stock (about 8 products), pending damage reports, a count in progress, orders still on order, unpaid supplier invoices, customers who owe money, voided sales                                    |

Every customer, supplier, product and sale it makes carries `Demo data` in its notes (products in the
description), so demo records can be told from real ones.

## Run it

The database must be migrated and have an owner (`owner:bootstrap`). Then:

```sh
# development (a database you can throw away)
DATABASE_URL=postgres://retail:retail@localhost:5432/retail \
JWT_SECRET=<32+ characters> DEMO_STAFF_PASSWORD='<12+ characters>' \
  pnpm --filter @retail/api build && pnpm --filter @retail/api seed:demo

# the container image (no pnpm inside); production-mode images need --allow-production
docker run --rm --env-file <env-file> -e DEMO_STAFF_PASSWORD=... retail-os-api \
  node dist/seed-demo.js --allow-production
```

Options: `--days=N` (30 to 400, default 180). It takes one to three minutes.

## Safe to run again

- A finished run leaves a `seeded` marker, and a second run says so and changes nothing.
- An interrupted run resumes: every step that must not repeat (an order, an expense, a damage report)
  is recorded as it completes, sales carry an idempotency key per day and position, and work that
  depends on earlier work (receiving an order, paying a supplier, settling a credit sale) is found
  from the database, not remembered. Run it again and it carries on.
- It never deletes or updates existing records. Reusing a category, brand, supplier or customer that
  already exists by name is the only overlap.
- It refuses when `NODE_ENV=production` unless `--allow-production` is given: only use that on a
  database that is meant to hold demo data.
- It checks its own result (stock equals the inventory account, the trial balance and balance sheet
  balance, no negative stock, cash and bank not overdrawn) and exits with an error if any fails.

The test `apps/api/test/seed.int.test.ts` runs it in a database of its own and compares the result with
independent SQL: revenue against the sales and returns, every product's stock and value against the
sum of its movements, receivables and payables against the ledger, the order and dates of the history.

## One more thing the seed needed: the clock

Every timestamp the application writes comes from one function, `now()` in
`apps/api/src/common/time.ts` (database defaults are applied by the application, not by the
database's `now()`). Only the seed command replaces it, through `useClock`; the API process never
does, so a request cannot choose its own time.
