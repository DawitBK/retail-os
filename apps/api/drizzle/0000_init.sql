CREATE SEQUENCE "public"."expense_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."journal_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."purchase_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."sale_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"normal_balance" text NOT NULL,
	"parent_code" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_type_valid" CHECK ("accounts"."type" in ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COGS', 'EXPENSE')),
	CONSTRAINT "accounts_normal_balance_valid" CHECK ("accounts"."normal_balance" in ('DEBIT', 'CREDIT'))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "brands_name_not_blank" CHECK (length(btrim("brands"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "categories_type_valid" CHECK ("categories"."type" in ('ELECTRONICS', 'STATIONERY')),
	CONSTRAINT "categories_name_not_blank" CHECK (length(btrim("categories"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"address" text,
	"city" text,
	"type" text DEFAULT 'RETAIL' NOT NULL,
	"credit_limit_minor" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "customers_type_valid" CHECK ("customers"."type" in ('RETAIL', 'WHOLESALE', 'INSTITUTIONAL')),
	CONSTRAINT "customers_credit_non_negative" CHECK ("customers"."credit_limit_minor" >= 0),
	CONSTRAINT "customers_name_not_blank" CHECK (length(btrim("customers"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" text NOT NULL,
	"account_code" text NOT NULL,
	"description" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"payment_method" text NOT NULL,
	"expense_date" date NOT NULL,
	"vendor" text,
	"receipt_number" text,
	"journal_entry_id" uuid,
	"created_by" uuid NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_amount_positive" CHECK ("expenses"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"product_id" uuid NOT NULL,
	"movement_type" text NOT NULL,
	"quantity" integer NOT NULL,
	"value_delta_minor" bigint NOT NULL,
	"stock_before" integer NOT NULL,
	"stock_after" integer NOT NULL,
	"value_before_minor" bigint NOT NULL,
	"value_after_minor" bigint NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_qty_positive" CHECK ("inventory_movements"."quantity" > 0),
	CONSTRAINT "inventory_movements_stock_non_negative" CHECK ("inventory_movements"."stock_after" >= 0),
	CONSTRAINT "inventory_movements_type_valid" CHECK ("inventory_movements"."movement_type" in ('OPENING_BALANCE', 'PURCHASE_RECEIPT', 'SALE', 'SALE_VOID'))
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"entry_number" text NOT NULL,
	"entry_date" date NOT NULL,
	"description" text NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"status" text DEFAULT 'POSTED' NOT NULL,
	"total_minor" bigint NOT NULL,
	"created_by" uuid NOT NULL,
	"reverses_entry_id" uuid,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_status_valid" CHECK ("journal_entries"."status" in ('POSTED', 'VOIDED')),
	CONSTRAINT "journal_entries_total_positive" CHECK ("journal_entries"."total_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit_minor" bigint DEFAULT 0 NOT NULL,
	"credit_minor" bigint DEFAULT 0 NOT NULL,
	"description" text,
	CONSTRAINT "journal_lines_one_side" CHECK ("journal_lines"."debit_minor" >= 0 and "journal_lines"."credit_minor" >= 0 and ("journal_lines"."debit_minor" = 0 or "journal_lines"."credit_minor" = 0) and ("journal_lines"."debit_minor" + "journal_lines"."credit_minor") > 0)
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "outbox_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"sku" text NOT NULL,
	"barcode" text,
	"name" text NOT NULL,
	"description" text,
	"category_id" uuid NOT NULL,
	"sub_category_id" uuid,
	"brand_id" uuid,
	"unit_of_measure" text DEFAULT 'piece' NOT NULL,
	"selling_price_minor" bigint NOT NULL,
	"min_selling_price_minor" bigint,
	"current_stock" integer DEFAULT 0 NOT NULL,
	"stock_value_minor" bigint DEFAULT 0 NOT NULL,
	"reorder_point" integer DEFAULT 5 NOT NULL,
	"reorder_qty" integer DEFAULT 10 NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"last_sold_at" timestamp with time zone,
	"last_restocked_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "products_stock_non_negative" CHECK ("products"."current_stock" >= 0),
	CONSTRAINT "products_value_non_negative" CHECK ("products"."stock_value_minor" >= 0),
	CONSTRAINT "products_value_matches_stock" CHECK (("products"."current_stock" = 0 and "products"."stock_value_minor" = 0) or "products"."current_stock" > 0),
	CONSTRAINT "products_price_non_negative" CHECK ("products"."selling_price_minor" >= 0),
	CONSTRAINT "products_min_price_valid" CHECK ("products"."min_selling_price_minor" is null or "products"."min_selling_price_minor" >= 0),
	CONSTRAINT "products_status_valid" CHECK ("products"."status" in ('ACTIVE', 'DISCONTINUED')),
	CONSTRAINT "products_name_not_blank" CHECK (length(btrim("products"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"ordered_qty" integer NOT NULL,
	"received_qty" integer DEFAULT 0 NOT NULL,
	"unit_cost_minor" bigint NOT NULL,
	CONSTRAINT "purchase_items_ordered_positive" CHECK ("purchase_items"."ordered_qty" > 0),
	CONSTRAINT "purchase_items_received_valid" CHECK ("purchase_items"."received_qty" >= 0 and "purchase_items"."received_qty" <= "purchase_items"."ordered_qty"),
	CONSTRAINT "purchase_items_cost_non_negative" CHECK ("purchase_items"."unit_cost_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" text DEFAULT 'ORDERED' NOT NULL,
	"order_date" date NOT NULL,
	"expected_date" date,
	"received_date" date,
	"total_minor" bigint NOT NULL,
	"received_value_minor" bigint DEFAULT 0 NOT NULL,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"payment_status" text DEFAULT 'UNPAID' NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchases_status_valid" CHECK ("purchases"."status" in ('ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')),
	CONSTRAINT "purchases_payment_status_valid" CHECK ("purchases"."payment_status" in ('UNPAID', 'PARTIAL', 'PAID')),
	CONSTRAINT "purchases_amounts_valid" CHECK ("purchases"."total_minor" >= 0 and "purchases"."received_value_minor" >= 0 and "purchases"."paid_minor" >= 0),
	CONSTRAINT "purchases_paid_within_received" CHECK ("purchases"."paid_minor" <= "purchases"."received_value_minor")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"sale_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name" text NOT NULL,
	"category_type" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"line_total_minor" bigint NOT NULL,
	"line_cogs_minor" bigint NOT NULL,
	CONSTRAINT "sale_items_qty_positive" CHECK ("sale_items"."quantity" > 0),
	CONSTRAINT "sale_items_total_matches" CHECK ("sale_items"."line_total_minor" = "sale_items"."unit_price_minor" * "sale_items"."quantity" - "sale_items"."discount_minor"),
	CONSTRAINT "sale_items_amounts_non_negative" CHECK ("sale_items"."line_total_minor" >= 0 and "sale_items"."line_cogs_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid,
	"sale_date" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'COMPLETED' NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint NOT NULL,
	"cogs_minor" bigint NOT NULL,
	"payment_method" text NOT NULL,
	"amount_paid_minor" bigint DEFAULT 0 NOT NULL,
	"change_given_minor" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"journal_entry_id" uuid,
	"created_by" uuid NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_status_valid" CHECK ("sales"."status" in ('COMPLETED', 'VOIDED')),
	CONSTRAINT "sales_payment_method_valid" CHECK ("sales"."payment_method" in ('CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CREDIT')),
	CONSTRAINT "sales_amounts_non_negative" CHECK ("sales"."subtotal_minor" >= 0 and "sales"."total_minor" >= 0),
	CONSTRAINT "sales_total_matches" CHECK ("sales"."total_minor" = "sales"."subtotal_minor" - "sales"."discount_minor"),
	CONSTRAINT "sales_credit_has_customer" CHECK ("sales"."payment_method" <> 'CREDIT' or "sales"."customer_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"sale_id" uuid,
	"purchase_id" uuid,
	"amount_minor" bigint NOT NULL,
	"method" text NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"journal_entry_id" uuid,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_amount_positive" CHECK ("settlements"."amount_minor" > 0),
	CONSTRAINT "settlements_target" CHECK (("settlements"."kind" = 'CUSTOMER_RECEIPT' and "settlements"."sale_id" is not null and "settlements"."purchase_id" is null) or ("settlements"."kind" = 'SUPPLIER_PAYMENT' and "settlements"."purchase_id" is not null and "settlements"."sale_id" is null))
);
--> statement-breakpoint
CREATE TABLE "sub_categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "sub_categories_name_not_blank" CHECK (length(btrim("sub_categories"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"contact_person" text,
	"email" text,
	"phone" text,
	"address" text,
	"city" text,
	"country" text,
	"payment_terms_days" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "suppliers_terms_non_negative" CHECK ("suppliers"."payment_terms_days" >= 0),
	CONSTRAINT "suppliers_name_not_blank" CHECK (length(btrim("suppliers"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"role" text DEFAULT 'cashier' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_role_valid" CHECK ("users"."role" in ('owner', 'manager', 'accountant', 'cashier')),
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_sub_category_id_sub_categories_id_fk" FOREIGN KEY ("sub_category_id") REFERENCES "public"."sub_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_categories" ADD CONSTRAINT "sub_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_code_uq" ON "accounts" USING btree ("code");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_name_live_uq" ON "brands" USING btree (lower("name")) WHERE "brands"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_live_uq" ON "categories" USING btree (lower("name")) WHERE "categories"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "customers_name_idx" ON "customers" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_number_uq" ON "expenses" USING btree ("number");--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("expense_date");--> statement-breakpoint
CREATE INDEX "inventory_movements_product_idx" ON "inventory_movements" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_reference_idx" ON "inventory_movements" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_number_uq" ON "journal_entries" USING btree ("entry_number");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_reverses_uq" ON "journal_entries" USING btree ("reverses_entry_id") WHERE "journal_entries"."reverses_entry_id" is not null;--> statement-breakpoint
CREATE INDEX "journal_entries_reference_idx" ON "journal_entries" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "journal_entries_date_idx" ON "journal_entries" USING btree ("entry_date");--> statement-breakpoint
CREATE INDEX "journal_lines_entry_idx" ON "journal_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "journal_lines_account_idx" ON "journal_lines" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "outbox_unprocessed_idx" ON "outbox_events" USING btree ("created_at") WHERE "outbox_events"."processed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "products_sku_live_uq" ON "products" USING btree (lower("sku")) WHERE "products"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "products_barcode_live_uq" ON "products" USING btree ("barcode") WHERE "products"."deleted_at" is null and "products"."barcode" is not null;--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "purchase_items_purchase_idx" ON "purchase_items" USING btree ("purchase_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_number_uq" ON "purchases" USING btree ("number");--> statement-breakpoint
CREATE INDEX "purchases_supplier_idx" ON "purchases" USING btree ("supplier_id","order_date");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_hash_uq" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sale_items_sale_idx" ON "sale_items" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_items_product_idx" ON "sale_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_number_uq" ON "sales" USING btree ("number");--> statement-breakpoint
CREATE INDEX "sales_customer_idx" ON "sales" USING btree ("customer_id","sale_date");--> statement-breakpoint
CREATE INDEX "sales_date_idx" ON "sales" USING btree ("sale_date");--> statement-breakpoint
CREATE INDEX "settlements_sale_idx" ON "settlements" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "settlements_purchase_idx" ON "settlements" USING btree ("purchase_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sub_categories_name_live_uq" ON "sub_categories" USING btree ("category_id",lower("name")) WHERE "sub_categories"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_name_live_uq" ON "suppliers" USING btree (lower("name")) WHERE "suppliers"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_live_uq" ON "users" USING btree ("email") WHERE "users"."deleted_at" is null;