ALTER TABLE "pos"."payment_settings" ADD COLUMN "qr_mode" text DEFAULT 'promptpay' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos"."payment_settings" ADD COLUMN "merchant_payload" text;