CREATE SEQUENCE "public"."purchase_return_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "purchase_return_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"return_id" uuid NOT NULL,
	"purchase_item_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"value_minor" bigint NOT NULL,
	"stock_cost_minor" bigint NOT NULL,
	CONSTRAINT "purchase_return_items_qty_positive" CHECK ("purchase_return_items"."quantity" > 0),
	CONSTRAINT "purchase_return_items_amounts" CHECK ("purchase_return_items"."value_minor" >= 0 and "purchase_return_items"."stock_cost_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_returns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" text NOT NULL,
	"purchase_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"value_minor" bigint NOT NULL,
	"credit_applied_minor" bigint DEFAULT 0 NOT NULL,
	"refund_method" text,
	"journal_entry_id" uuid,
	"processed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_returns_value_positive" CHECK ("purchase_returns"."value_minor" > 0),
	CONSTRAINT "purchase_returns_split_valid" CHECK ("purchase_returns"."credit_applied_minor" >= 0 and "purchase_returns"."credit_applied_minor" <= "purchase_returns"."value_minor"),
	CONSTRAINT "purchase_returns_refund_method" CHECK (("purchase_returns"."value_minor" = "purchase_returns"."credit_applied_minor") = ("purchase_returns"."refund_method" is null))
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_type_valid";--> statement-breakpoint
ALTER TABLE "purchase_items" ADD COLUMN "returned_qty" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_return_id_purchase_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."purchase_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_purchase_item_id_purchase_items_id_fk" FOREIGN KEY ("purchase_item_id") REFERENCES "public"."purchase_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_processed_by_users_id_fk" FOREIGN KEY ("processed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_return_items_return_idx" ON "purchase_return_items" USING btree ("return_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_returns_number_uq" ON "purchase_returns" USING btree ("number");--> statement-breakpoint
CREATE INDEX "purchase_returns_purchase_idx" ON "purchase_returns" USING btree ("purchase_id");--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_type_valid" CHECK ("inventory_movements"."movement_type" in ('OPENING_BALANCE', 'PURCHASE_RECEIPT', 'SALE', 'SALE_VOID', 'SALE_RETURN', 'PURCHASE_RETURN', 'DAMAGE_LOSS', 'WRITE_OFF', 'STOCK_ADJUSTMENT_INCREASE', 'STOCK_ADJUSTMENT_DECREASE'));--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_returned_valid" CHECK ("purchase_items"."returned_qty" >= 0 and "purchase_items"."returned_qty" <= "purchase_items"."received_qty");