ALTER TABLE "pos"."sale_items" ADD COLUMN "original_sale_item_id" integer;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD COLUMN "transaction_type" text DEFAULT 'sale' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD COLUMN "original_sale_id" integer;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD COLUMN "return_reason" text;--> statement-breakpoint
ALTER TABLE "pos"."sale_items" ADD CONSTRAINT "sale_items_original_sale_item_id_sale_items_id_fk" FOREIGN KEY ("original_sale_item_id") REFERENCES "pos"."sale_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."sales" ADD CONSTRAINT "sales_original_sale_id_sales_id_fk" FOREIGN KEY ("original_sale_id") REFERENCES "pos"."sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saleitem_original_item_idx" ON "pos"."sale_items" USING btree ("original_sale_item_id");--> statement-breakpoint
CREATE INDEX "sales_transaction_type_idx" ON "pos"."sales" USING btree ("transaction_type");--> statement-breakpoint
CREATE INDEX "sales_original_sale_idx" ON "pos"."sales" USING btree ("original_sale_id");