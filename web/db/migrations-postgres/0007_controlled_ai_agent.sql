CREATE TABLE "pos"."assistant_action_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" integer NOT NULL,
	"staff_id" integer NOT NULL,
	"action" text NOT NULL,
	"payload" jsonb NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"risk" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"executed_at" timestamp with time zone,
	"result_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pos"."assistant_action_proposals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "pos"."assistant_action_proposals" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "pos"."assistant_action_proposals" FROM anon;
--> statement-breakpoint
REVOKE ALL ON TABLE "pos"."assistant_action_proposals" FROM authenticated;
--> statement-breakpoint
ALTER TABLE "pos"."assistant_action_proposals" ADD CONSTRAINT "assistant_action_proposals_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "pos"."branches"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pos"."assistant_action_proposals" ADD CONSTRAINT "assistant_action_proposals_staff_id_staff_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "pos"."staff_users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "assistant_action_proposal_branch_idx" ON "pos"."assistant_action_proposals" USING btree ("branch_id");
--> statement-breakpoint
CREATE INDEX "assistant_action_proposal_staff_status_idx" ON "pos"."assistant_action_proposals" USING btree ("staff_id","status");
--> statement-breakpoint
CREATE INDEX "assistant_action_proposal_expires_idx" ON "pos"."assistant_action_proposals" USING btree ("expires_at");
