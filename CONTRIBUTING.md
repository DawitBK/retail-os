# Contributing

## Setup

```sh
mise install              # Node 24 and pnpm 10 (or install them yourself)
pnpm install
pnpm db:up                # PostgreSQL 18 in Docker, needed for integration tests only
export DATABASE_URL=postgres://retail:retail@localhost:5432/retail
```

## Before you push

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm build
pnpm test
pnpm test:integration
```

CI runs exactly these, in this order.

## Conventions

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) such as
  `feat(api): ...`, `fix(kit): ...`, `docs: ...`, `ci: ...`, `chore: ...`.
  Keep each commit small and self-explanatory.
- **Decisions:** anything that changes the stack, a boundary or a guarantee gets an ADR in
  `docs/adr/`. Do not edit an accepted ADR to change history; supersede it.
- **Tests:** a bug fix starts with a failing test; a new guarantee gets a test that proves it
  (see ADR-0005).
- **Schema changes:** edit `apps/api/src/db/schema.ts`, run
  `pnpm --filter @retail/api db:generate`, commit the generated SQL unedited. Use
  `drizzle-kit generate --custom` for hand-written SQL.
- **Contracts:** change the Zod schema; the validation and the OpenAPI document follow.
- **The enterprise bar:** if your change moves an item from TODO to DONE, update
  `docs/enterprise-bar.md` in the same pull request, with evidence (a test or a file).
- No secrets, no employer or customer names, no personal data in the repository.
