CREATE TABLE "pos"."saas_businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"contact_email" text DEFAULT '' NOT NULL,
	"contact_phone" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"app_url" text NOT NULL,
	"supabase_project_ref" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saas_businesses_code_unique" UNIQUE("code"),
	CONSTRAINT "saas_businesses_app_url_unique" UNIQUE("app_url"),
	CONSTRAINT "saas_businesses_supabase_project_ref_unique" UNIQUE("supabase_project_ref"),
	CONSTRAINT "saas_business_status_check" CHECK ("pos"."saas_businesses"."status" in ('active', 'paused')),
	CONSTRAINT "saas_business_code_check" CHECK ("pos"."saas_businesses"."code" ~ '^[A-Z0-9_-]{2,40}$'),
	CONSTRAINT "saas_business_project_ref_check" CHECK ("pos"."saas_businesses"."supabase_project_ref" ~ '^[a-z0-9]{20}$')
);
--> statement-breakpoint
ALTER TABLE "pos"."saas_businesses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "pos"."saas_businesses" FROM anon, authenticated;
