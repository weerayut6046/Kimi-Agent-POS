ALTER TABLE "pos"."payment_sessions" ADD COLUMN "trans_ref" text;--> statement-breakpoint
ALTER TABLE "pos"."payment_settings" ADD COLUMN "provider" text DEFAULT 'slip2go' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "paymentsession_transref_unique" ON "pos"."payment_sessions" USING btree ("trans_ref") WHERE trans_ref is not null;