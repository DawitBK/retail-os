# ADR-0002: The database guards the books and the stock

**Status:** accepted

Accounting software earns trust by making corruption impossible, not by hoping the application is
bug-free. So the invariants live in PostgreSQL as well as in the code (migration `0002`):

1. **Double entry at commit.** A deferred constraint trigger checks that each journal entry's
   debits equal its credits and equal its stated total, and that no entry exists without lines.
2. **Immutable history.** Journal lines and inventory movements reject UPDATE, DELETE and TRUNCATE.
   A journal entry can only move from POSTED to VOIDED (stamped with who and when), and a void
   always posts a mirror entry, so reports add up and nothing is rewritten.
3. **Stock moves only through movements.** A trigger on `products` refuses any change to
   `current_stock` or `stock_value_minor` unless the transaction announced itself with a
   transaction-local setting that only `applyMovement` sets. New products must start at zero.
4. **No second opening.** The books can be opened once (advisory lock plus a check), because a
   second opening balance would silently double the owner's capital.
5. **Never pay a supplier more than has been received**, enforced by a CHECK constraint.

The application checks the same things first and returns readable errors; the triggers are the
backstop for the day someone writes a script, a migration or a hurried hotfix.

**Rejected:** a mutable `balance` column on each account (the legacy design: it drifts and needs
locking), recomputing balances from the ledger on every read is what is done instead; stock
adjustments by editing the product (the original system's first law forbids it).
