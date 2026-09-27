ALTER TABLE "pos"."passkey_challenges" ADD COLUMN "request_ip" text;--> statement-breakpoint
ALTER TABLE "pos"."passkey_challenges" ADD COLUMN "consumed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "passkey_challenge_ip_created_idx" ON "pos"."passkey_challenges" USING btree ("request_ip","created_at");