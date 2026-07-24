create table "pos"."assistant_settings" (
  "branch_id" integer primary key not null,
  "provider" text default 'ollama' not null,
  "ollama_model" text default 'qwen3:4b' not null,
  "deepseek_model" text default 'deepseek-v4-flash' not null,
  "deepseek_api_key_encrypted" text,
  "updated_at" timestamp with time zone default now() not null
);

alter table "pos"."assistant_settings" enable row level security;

revoke all on table "pos"."assistant_settings" from public;
revoke all on table "pos"."assistant_settings" from anon;
revoke all on table "pos"."assistant_settings" from authenticated;

alter table "pos"."assistant_settings"
  add constraint "assistant_settings_branch_id_branches_id_fk"
  foreign key ("branch_id") references "pos"."branches"("id")
  on delete cascade on update no action;

create index "assistant_settings_provider_idx"
  on "pos"."assistant_settings" using btree ("provider");
