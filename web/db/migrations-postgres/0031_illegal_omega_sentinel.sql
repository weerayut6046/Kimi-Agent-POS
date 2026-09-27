CREATE TABLE "pos"."passkey_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"challenge" text NOT NULL,
	"staff_id" integer,
	"user_handle" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passkey_registration_staff_check" CHECK ("pos"."passkey_challenges"."purpose" <> 'registration' OR ("pos"."passkey_challenges"."staff_id" IS NOT NULL AND "pos"."passkey_challenges"."user_handle" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "pos"."passkey_challenges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos"."passkey_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pos"."passkey_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pos"."staff_users" ADD COLUMN "passkey_user_handle" text;--> statement-breakpoint
ALTER TABLE "pos"."passkey_challenges" ADD CONSTRAINT "passkey_challenges_staff_id_staff_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "pos"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos"."passkey_credentials" ADD CONSTRAINT "passkey_credentials_staff_id_staff_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "pos"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "passkey_challenge_expires_idx" ON "pos"."passkey_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "passkey_credential_staff_idx" ON "pos"."passkey_credentials" USING btree ("staff_id");--> statement-breakpoint
ALTER TABLE "pos"."staff_users" ADD CONSTRAINT "staff_users_passkey_user_handle_unique" UNIQUE("passkey_user_handle");