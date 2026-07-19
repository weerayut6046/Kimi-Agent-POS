ALTER TABLE `debt_payments` ADD `shift_id` integer;--> statement-breakpoint
ALTER TABLE `shifts` ADD `opening_float` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `shifts` ADD `expected_cash` real;--> statement-breakpoint
ALTER TABLE `shifts` ADD `cash_counts` text;