# ADR-0001: Stack, and staff-only accounts

**Status:** accepted

Node 24, NestJS 12 (modular monolith), Drizzle ORM, PostgreSQL 18, Zod for every contract,
Vitest: the stack shared with the other services in this programme. A modular monolith is the
right size: one shop, one database, and the whole point is that a sale, its stock movement and its
journal entry are a single transaction, which a service split would turn into a distributed one.

Only the shop's staff sign in: owner, manager, accountant, cashier. There is no public sign-up;
the owner creates accounts and the first owner is created by a bootstrap command that refuses to
run twice. Authentication is argon2id, a 15-minute access token and rotating refresh tokens whose
reuse revokes the whole session. Disabling an account or resetting a password ends its sessions.

| Role       | Can                                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| cashier    | read the catalogue, ring up sales at list price, create customers, take payments on credit sales; sees only their own sales |
| manager    | everything operational: catalogue, suppliers, purchasing, discounts and price changes, voids, credit limits                 |
| accountant | read the books and stock, record expenses, pay suppliers; cannot sell, receive stock or void                                |
| owner      | everything, plus staff and the one-time opening of the books                                                                |

Separation of duties: whoever records an expense cannot void it, and an accountant cannot sell.
