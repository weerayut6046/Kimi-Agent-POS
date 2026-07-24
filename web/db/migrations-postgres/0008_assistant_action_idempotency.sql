ALTER TABLE "pos"."assistant_action_proposals"
	ADD COLUMN "idempotency_key" text;
--> statement-breakpoint
UPDATE "pos"."assistant_action_proposals"
SET "idempotency_key" = 'legacy:' || "id"::text
WHERE "idempotency_key" IS NULL;
--> statement-breakpoint
ALTER TABLE "pos"."assistant_action_proposals"
	ALTER COLUMN "idempotency_key" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "pos"."assistant_action_proposals"
	ADD CONSTRAINT "assistant_action_proposals_idempotency_key_unique" UNIQUE("idempotency_key");
