-- The books and the stock are evidence. These guards make the database itself refuse the changes
-- that would corrupt them, so a bug in the application (or a hand-typed UPDATE) cannot.

CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
--> statement-breakpoint

-- Journal lines never change once written.
CREATE TRIGGER journal_lines_immutable BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER journal_lines_no_truncate BEFORE TRUNCATE ON journal_lines
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
--> statement-breakpoint

-- Inventory movements never change once written.
CREATE TRIGGER inventory_movements_immutable BEFORE UPDATE OR DELETE ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER inventory_movements_no_truncate BEFORE TRUNCATE ON inventory_movements
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
--> statement-breakpoint

-- A posted entry can only be voided (POSTED to VOIDED, stamped with who and when); nothing else changes.
CREATE FUNCTION journal_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'POSTED' AND NEW.status = 'VOIDED'
     AND NEW.id = OLD.id
     AND NEW.entry_number = OLD.entry_number
     AND NEW.entry_date = OLD.entry_date
     AND NEW.description = OLD.description
     AND NEW.total_minor = OLD.total_minor
     AND NEW.reference_type IS NOT DISTINCT FROM OLD.reference_type
     AND NEW.reference_id IS NOT DISTINCT FROM OLD.reference_id
     AND NEW.reverses_entry_id IS NOT DISTINCT FROM OLD.reverses_entry_id
     AND NEW.created_by = OLD.created_by
     AND NEW.voided_at IS NOT NULL
     AND NEW.voided_by IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'journal entries are immutable once posted (they can only be voided)'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_entries_guard BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION journal_entry_guard();
--> statement-breakpoint
CREATE TRIGGER journal_entries_no_delete BEFORE DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER journal_entries_no_truncate BEFORE TRUNCATE ON journal_entries
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
--> statement-breakpoint

-- Double entry, enforced at commit: every entry's debits equal its credits and its stated total,
-- and no entry exists without lines. Deferred, so lines can be inserted in any order.
CREATE FUNCTION journal_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  entry uuid;
  d bigint;
  c bigint;
  t bigint;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    entry := NEW.id;
  ELSE
    entry := NEW.entry_id;
  END IF;
  SELECT coalesce(sum(debit_minor), 0), coalesce(sum(credit_minor), 0) INTO d, c
    FROM journal_lines WHERE entry_id = entry;
  SELECT total_minor INTO t FROM journal_entries WHERE id = entry;
  IF d = 0 OR d <> c OR d <> t THEN
    RAISE EXCEPTION 'journal entry % does not balance: debits %, credits %, stated total %',
      entry, d, c, t USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_lines_balanced AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_entries_have_lines AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();
--> statement-breakpoint

-- Stock and its value move only through inventory movements. The application announces itself
-- with a transaction-local setting; every other writer is refused. New products start empty.
CREATE FUNCTION products_stock_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.current_stock <> 0 OR NEW.stock_value_minor <> 0 THEN
      RAISE EXCEPTION 'a new product starts with no stock; stock arrives through inventory movements'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.current_stock IS DISTINCT FROM OLD.current_stock
      OR NEW.stock_value_minor IS DISTINCT FROM OLD.stock_value_minor)
     AND coalesce(current_setting('retail.inventory_write', true), '') <> 'on' THEN
    RAISE EXCEPTION 'stock and stock value change only through inventory movements'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER products_stock_guard BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION products_stock_guard();
--> statement-breakpoint

-- The chart of accounts (all amounts are Ethiopian Birr). Codes are the contract with the application.
INSERT INTO accounts (code, name, type, normal_balance, parent_code, is_system) VALUES
  ('1000', 'Cash in Hand',                    'ASSET',     'DEBIT',  NULL,   true),
  ('1010', 'Cash in Bank',                    'ASSET',     'DEBIT',  NULL,   true),
  ('1020', 'Cash in Bank - Reserve Account',  'ASSET',     'DEBIT',  NULL,   true),
  ('1100', 'Accounts Receivable',             'ASSET',     'DEBIT',  NULL,   true),
  ('1110', 'Allowance for Doubtful Accounts', 'ASSET',     'CREDIT', '1100', true),
  ('1200', 'Inventory Asset',                 'ASSET',     'DEBIT',  NULL,   true),
  ('1210', 'Inventory - Electronics',         'ASSET',     'DEBIT',  '1200', true),
  ('1220', 'Inventory - Stationery',          'ASSET',     'DEBIT',  '1200', true),
  ('1300', 'Prepaid Expenses',                'ASSET',     'DEBIT',  NULL,   true),
  ('1500', 'Equipment and Fixtures',          'ASSET',     'DEBIT',  NULL,   true),
  ('1510', 'Accumulated Depreciation',        'ASSET',     'CREDIT', '1500', true),
  ('2000', 'Accounts Payable',                'LIABILITY', 'CREDIT', NULL,   true),
  ('2100', 'Accrued Expenses',                'LIABILITY', 'CREDIT', NULL,   true),
  ('2200', 'Customer Deposits',               'LIABILITY', 'CREDIT', NULL,   true),
  ('3000', 'Owner''s Capital',                'EQUITY',    'CREDIT', NULL,   true),
  ('3100', 'Retained Earnings',               'EQUITY',    'CREDIT', NULL,   true),
  ('3200', 'Owner''s Drawings',               'EQUITY',    'DEBIT',  '3000', true),
  ('4000', 'Sales Revenue - Electronics',     'REVENUE',   'CREDIT', NULL,   true),
  ('4010', 'Sales Revenue - Stationery',      'REVENUE',   'CREDIT', NULL,   true),
  ('4100', 'Sales Returns and Allowances',    'REVENUE',   'DEBIT',  '4000', true),
  ('4200', 'Other Income',                    'REVENUE',   'CREDIT', NULL,   true),
  ('5000', 'COGS - Electronics',              'COGS',      'DEBIT',  NULL,   true),
  ('5010', 'COGS - Stationery',               'COGS',      'DEBIT',  NULL,   true),
  ('5100', 'Purchase Returns',                'COGS',      'CREDIT', '5000', true),
  ('6000', 'Rent Expense',                    'EXPENSE',   'DEBIT',  NULL,   true),
  ('6010', 'Utilities Expense',               'EXPENSE',   'DEBIT',  NULL,   true),
  ('6020', 'Salaries and Wages',              'EXPENSE',   'DEBIT',  NULL,   true),
  ('6030', 'Transport and Logistics',         'EXPENSE',   'DEBIT',  NULL,   true),
  ('6040', 'Packaging Materials',             'EXPENSE',   'DEBIT',  NULL,   true),
  ('6050', 'Marketing and Advertising',       'EXPENSE',   'DEBIT',  NULL,   true),
  ('6100', 'Inventory Damage Loss',           'EXPENSE',   'DEBIT',  NULL,   true),
  ('6110', 'Inventory Write-off Loss',        'EXPENSE',   'DEBIT',  NULL,   true),
  ('6120', 'Inventory Shrinkage Loss',        'EXPENSE',   'DEBIT',  NULL,   true),
  ('6200', 'Depreciation Expense',            'EXPENSE',   'DEBIT',  NULL,   true),
  ('6900', 'Miscellaneous Expense',           'EXPENSE',   'DEBIT',  NULL,   true);
