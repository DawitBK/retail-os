CREATE TABLE "period_closes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"fiscal_year" integer NOT NULL,
	"closed_through" date NOT NULL,
	"net_profit_minor" bigint NOT NULL,
	"journal_entry_id" uuid,
	"closed_by" uuid NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "period_closes_year_plausible" CHECK ("period_closes"."fiscal_year" between 1990 and 2200)
);
--> statement-breakpoint
ALTER TABLE "period_closes" ADD CONSTRAINT "period_closes_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_closes" ADD CONSTRAINT "period_closes_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "period_closes_year_uq" ON "period_closes" USING btree ("fiscal_year");--> statement-breakpoint
-- The books are closed through a date: no entry may be dated on or before it. The application checks
-- first and answers politely; this is the same rule where nothing can go around it. The closing
-- entry itself (reference type YEAR_CLOSE) is the one entry allowed on the closing date.
CREATE FUNCTION journal_entries_period_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE locked date;
BEGIN
  IF NEW.reference_type = 'YEAR_CLOSE' THEN
    RETURN NEW;
  END IF;
  SELECT max(closed_through) INTO locked FROM period_closes;
  IF locked IS NOT NULL AND NEW.entry_date <= locked THEN
    RAISE EXCEPTION 'The books are closed through %; an entry dated % cannot be posted', locked, NEW.entry_date
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_entries_period_guard BEFORE INSERT ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION journal_entries_period_guard();
--> statement-breakpoint
-- A close is permanent.
CREATE FUNCTION period_closes_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A closed period cannot be changed or reopened' USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER period_closes_no_change BEFORE UPDATE OR DELETE ON period_closes
  FOR EACH ROW EXECUTE FUNCTION period_closes_immutable();
