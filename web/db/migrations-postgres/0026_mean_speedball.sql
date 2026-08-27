CREATE INDEX "login_attempt_branch_idx" ON "pos"."login_attempts" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "security_event_actor_idx" ON "pos"."security_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "stockcountitem_counted_by_idx" ON "pos"."stock_count_items" USING btree ("counted_by_id");--> statement-breakpoint
CREATE INDEX "stockcountsession_started_by_idx" ON "pos"."stock_count_sessions" USING btree ("started_by_id");--> statement-breakpoint
CREATE INDEX "stockcountsession_completed_by_idx" ON "pos"."stock_count_sessions" USING btree ("completed_by_id");--> statement-breakpoint
CREATE INDEX "tankreading_staff_idx" ON "pos"."tank_readings" USING btree ("staff_id");