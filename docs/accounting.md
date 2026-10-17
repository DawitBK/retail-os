# Accounting rules

Every business event is one database transaction that moves goods and posts a balanced journal
entry together. Amounts are integer minor units of Ethiopian Birr (santim).

## Chart of accounts

Seeded by migration `0002`. The codes are the contract between the application and the books.

| Range     | Normal balance | Accounts                                                                                                           |
| --------- | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1000-1999 | debit          | 1000 Cash in Hand, 1010 Cash in Bank, 1100 Receivables, 1200 Inventory, 1300 Prepaid, 1500 Equipment (and contras) |
| 2000-2999 | credit         | 2000 Payables, 2100 Accrued Expenses, 2200 Customer Deposits                                                       |
| 3000-3999 | credit         | 3000 Owner's Capital, 3100 Retained Earnings, 3200 Owner's Drawings (debit, contra)                                |
| 4000-4999 | credit         | 4000 Revenue Electronics, 4010 Revenue Stationery, 4100 Returns (debit, contra), 4200 Other Income                 |
| 5000-5999 | debit          | 5000 COGS Electronics, 5010 COGS Stationery, 5100 Purchase Returns (credit, contra)                                |
| 6000-6999 | debit          | rent, utilities, salaries, transport, packaging, marketing, damage, write-off, shrinkage, depreciation, misc       |

Mobile money is reconciled with the bank, so it posts to 1010.

## What each event posts

| Event                       | Debit                                                     | Credit                                      |
| --------------------------- | --------------------------------------------------------- | ------------------------------------------- |
| Cash, bank or mobile sale   | 1000 or 1010 for the total                                | 4000 / 4010 revenue per product type        |
| ...and its cost, same entry | 5000 / 5010 cost of goods sold                            | 1200 inventory                              |
| Credit sale                 | 1100 receivable for the unpaid part, 1000 for any deposit | 4000 / 4010 (and the cost as above)         |
| Customer pays a credit sale | 1000 or 1010                                              | 1100                                        |
| Goods received              | 1200 inventory                                            | 2000 payables                               |
| Supplier payment            | 2000 payables                                             | 1000 or 1010                                |
| Expense                     | 6xxx expense account                                      | 1000 or 1010                                |
| Opening balances            | 1000, 1010, 1200                                          | 3000 owner's capital (the balancing figure) |
| Void of any of the above    | the mirror image of the original entry                    | (the original is marked VOIDED; both stay)  |

Revenue and its cost of goods are always recognised in the same entry (the matching principle):
there is no code path that posts one without the other.

## Inventory valuation

Each product keeps `current_stock` and `stock_value_minor` (what the units on hand cost in total).
The weighted average cost is `stock_value / current_stock`, derived and never stored.

- A receipt adds the units and their total cost.
- A sale takes `round(value x qty / stock)` out; the last unit out takes whatever value is left.
- Because values are exact integers, the sum over all products always equals the inventory account
  (1200): `GET /api/v1/inventory/valuation` reports `reconciled: true`, and a test asserts it.
- A sale's cost is snapshotted on its lines and never recalculated; a void puts the stock back at
  that same cost.

## Reports

`trial-balance` (period; debits equal credits and closing nets sum to zero), `profit-loss`
(revenue less returns, less cost of goods, less expenses), `balance-sheet` (assets equal
liabilities plus equity; profit to date is one equity line because nothing closes the books at
year end yet), account ledgers with a running balance, the journal, and the inventory valuation.
