# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub:
**Security tab > Report a vulnerability** on this repository.

Do not open a public issue for a vulnerability. Include what you found, how to reproduce it and
the affected version or commit. You can expect an acknowledgement within a few days.

## Scope and status

Controls in the API today: default-deny authorization with four roles, argon2id password hashing,
rotating refresh tokens with reuse detection, sessions ended on disable or password change,
staff-only accounts (no public sign-up), strict input validation, prices and costs decided only on
the server, an append-only audit log, and a database that refuses unbalanced or edited accounting
records. Controls still to do (sign-in rate limiting, lockout, MFA, return and damage workflows)
are listed honestly in the [enterprise bar](docs/enterprise-bar.md).

## Practices

- No secrets in the repository; CI runs gitleaks on every push.
- Workflow permissions are read-only by default, and third-party actions are pinned by commit SHA.
- Dependencies are locked (`pnpm-lock.yaml`) and installed with `--frozen-lockfile`.
