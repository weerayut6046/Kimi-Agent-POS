SET lock_timeout = '5s';
SET statement_timeout = '2min';

ALTER TABLE "pos"."staff_users"
  ADD COLUMN "passkey_user_handle" text;
ALTER TABLE "pos"."staff_users"
  ADD CONSTRAINT "staff_users_passkey_user_handle_unique"
  UNIQUE ("passkey_user_handle");

CREATE TABLE "pos"."passkey_credentials" (
  "id" text PRIMARY KEY,
  "staff_id" integer NOT NULL REFERENCES "pos"."staff_users"("id") ON DELETE cascade,
  "public_key" text NOT NULL,
  "counter" bigint NOT NULL DEFAULT 0,
  "transports" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_used_at" timestamp with time zone
);

CREATE INDEX "passkey_credential_staff_idx"
  ON "pos"."passkey_credentials" ("staff_id");

CREATE TABLE "pos"."passkey_challenges" (
  "id" uuid PRIMARY KEY,
  "purpose" text NOT NULL,
  "challenge" text NOT NULL,
  "staff_id" integer REFERENCES "pos"."staff_users"("id") ON DELETE cascade,
  "user_handle" text,
  "request_ip" text,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "passkey_registration_staff_check"
    CHECK ("purpose" <> 'registration' OR ("staff_id" IS NOT NULL AND "user_handle" IS NOT NULL))
);

CREATE INDEX "passkey_challenge_expires_idx"
  ON "pos"."passkey_challenges" ("expires_at");
CREATE INDEX "passkey_challenge_ip_created_idx"
  ON "pos"."passkey_challenges" ("request_ip", "created_at");

ALTER TABLE "pos"."passkey_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pos"."passkey_challenges" ENABLE ROW LEVEL SECURITY;

-- The browser only talks to these tables through the authenticated POS API.
REVOKE ALL ON TABLE "pos"."passkey_credentials", "pos"."passkey_challenges"
  FROM public, anon, authenticated;
CREATE POLICY "server_only_deny_client_access"
  ON "pos"."passkey_credentials"
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY "server_only_deny_client_access"
  ON "pos"."passkey_challenges"
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
