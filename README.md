# Retail OS

Point of sale, inventory and double-entry accounting for a retail shop, built so that **the stock
and the books cannot disagree**. Every sale, purchase, expense and opening balance goes through one
transaction that moves the goods and posts balanced journal entries together, and the database
itself refuses anything that would break that.

Designed for a hybrid electronics and stationery shop in Addis Ababa (amounts in Ethiopian Birr),
but nothing in the rules is specific to one shop.

## What it does

| Area          | Behaviour                                                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Point of sale | prices every line from the catalogue, takes stock at cost, posts revenue and cost of goods sold together; cash, bank, mobile money and credit; change; manager-approved discounts |
| Inventory     | stock and its value change only through immutable movements; weighted average cost; the last unit out takes the exact value left, so rounding never drifts                        |
| Purchasing    | purchase orders, partial receipts, supplier payments; what is owed is exactly what has arrived and not been paid for                                                              |
| Credit        | customer credit limits enforced under concurrency; payments against credit sales; what a customer owes is derived from the sales                                                  |
| Accounting    | chart of accounts, journal, ledgers with running balance, trial balance, profit and loss, balance sheet, expenses, opening balances                                               |
| Control       | roles owner, manager, accountant, cashier; audit trail; voids reverse instead of delete; idempotent sales                                                                         |

Money is integer minor units (santim), never a float.

## The guarantees (and the test that proves each)

- **Every entry balances.** Debits equal credits, enforced by the application and again by a
  deferred database trigger at commit (`guards.int.test.ts`).
- **Posted history is immutable.** Journal lines and entries cannot be edited or deleted, even with
  SQL; a void posts the mirror entry (`guards`, `sales`).
- **Stock moves only through movements.** A trigger rejects any other write to stock or its value
  (`purchasing.int.test.ts`).
- **The shelf and the inventory account agree to the last santim** after a run of purchases, sales and voids
  (`accounting.int.test.ts`, "stock records and the inventory account").
- **Two tills never sell the last unit twice**, and two tills never push a customer past their
  credit limit (`sales.int.test.ts`).
- **The client never decides money.** A sale carries no price, cost, total or stock; the server
  settles them (`sales`, `domain.test.ts`).

## Stack

Node 24, NestJS 12, Drizzle ORM, PostgreSQL 18, Zod contracts that generate the OpenAPI document,
Next.js 16 and React 19 with Tailwind for the till and back office, Vitest, pnpm 10 and Turborepo. Decisions are in [docs/adr](docs/adr); the accounting rules are in
[docs/accounting.md](docs/accounting.md).

## Run it

```sh
corepack enable
pnpm install
pnpm db:up                       # PostgreSQL 18 in Docker
cp .env.example .env             # then export its values, or use your own loader
pnpm build
pnpm --filter @retail/api db:migrate
OWNER_EMAIL=you@example.com OWNER_PASSWORD='a long passphrase' pnpm --filter @retail/api owner:bootstrap
pnpm --filter @retail/api start      # the API on :3000
API_URL=http://127.0.0.1:3000 pnpm --filter @retail/web dev   # the web app on :3001
```

There is no public sign-up: the first owner is created with `owner:bootstrap`, which refuses to
run once one exists, and the owner creates the other staff. The contract is at
`http://localhost:3000/openapi.json`.

## Test it

```sh
pnpm lint && pnpm typecheck && pnpm test
DATABASE_URL=postgres://retail:retail@localhost:5432/retail_test pnpm test:integration
```

The integration suite recreates its database (it must be named `*_test`) every run, because the
books cannot be truncated.

## Layout

```
apps/api/        the HTTP API (NestJS)
apps/web/        the till, back office and statements (Next.js; session kept server-side, ADR 0004)
packages/kit/    shared building blocks: env, logging, problem+json, pagination, health, OpenAPI
packages/config/ shared TypeScript and ESLint presets
docs/            ADRs, the accounting rules, the enterprise-bar scorecard
```

Licensed under Apache-2.0.
