CREATE TABLE "pos"."assistant_settings" (
	"branch_id" integer PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'ollama' NOT NULL,
	"ollama_model" text DEFAULT 'qwen3:4b-instruct' NOT NULL,
	"deepseek_model" text DEFAULT 'deepseek-v4-flash' NOT NULL,
	"deepseek_api_key_encrypted" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pos"."assistant_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "pos"."assistant_settings" FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON TABLE "pos"."assistant_settings" FROM anon;--> statement-breakpoint
REVOKE ALL ON TABLE "pos"."assistant_settings" FROM authenticated;--> statement-breakpoint
ALTER TABLE "pos"."assistant_settings" ADD CONSTRAINT "assistant_settings_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "pos"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_settings_provider_idx" ON "pos"."assistant_settings" USING btree ("provider");
