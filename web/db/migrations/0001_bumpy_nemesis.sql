CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`actor_id` integer,
	`actor_name` text DEFAULT '' NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`ref_type` text,
	`ref_id` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_action_idx` ON `audit_logs` (`action`);--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `debt_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_no` text NOT NULL,
	`customer_id` integer NOT NULL,
	`amount` real NOT NULL,
	`method` text DEFAULT 'cash' NOT NULL,
	`staff_name` text DEFAULT '' NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `debt_payments_payment_no_unique` ON `debt_payments` (`payment_no`);--> statement-breakpoint
CREATE INDEX `debtpay_customer_idx` ON `debt_payments` (`customer_id`);--> statement-breakpoint
CREATE INDEX `debtpay_created_idx` ON `debt_payments` (`created_at`);--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`amount` real NOT NULL,
	`shift_id` integer,
	`staff_name` text DEFAULT '' NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `expenses_created_idx` ON `expenses` (`created_at`);--> statement-breakpoint
CREATE TABLE `price_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer,
	`product_code` text DEFAULT '' NOT NULL,
	`product_name` text DEFAULT '' NOT NULL,
	`old_price` real NOT NULL,
	`new_price` real NOT NULL,
	`changed_by` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pricechg_product_idx` ON `price_changes` (`product_id`);--> statement-breakpoint
ALTER TABLE `customers` ADD `credit_limit` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sales` ADD `customer_id` integer;