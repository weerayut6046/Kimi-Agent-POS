CREATE TABLE `customers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`tax_id` text DEFAULT '' NOT NULL,
	`branch` text DEFAULT '' NOT NULL,
	`address` text,
	`phone` text DEFAULT '' NOT NULL,
	`vehicle_plate` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fuel_tanks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`name` text NOT NULL,
	`capacity_liters` real NOT NULL,
	`current_liters` real DEFAULT 0 NOT NULL,
	`low_alert_at` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_code` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`points` integer DEFAULT 0 NOT NULL,
	`tier` text DEFAULT 'silver' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_member_code_unique` ON `members` (`member_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_phone_unique` ON `members` (`phone`);--> statement-breakpoint
CREATE TABLE `nozzles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pump_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`label` text NOT NULL,
	`current_meter` real DEFAULT 0 NOT NULL,
	`current_money` real DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pump_idx` ON `nozzles` (`pump_id`);--> statement-breakpoint
CREATE TABLE `point_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`sale_id` integer,
	`type` text NOT NULL,
	`points` integer NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `member_idx` ON `point_transactions` (`member_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`unit` text DEFAULT 'ชิ้น' NOT NULL,
	`price` real NOT NULL,
	`cost` real DEFAULT 0 NOT NULL,
	`stock_qty` real DEFAULT 0 NOT NULL,
	`low_stock_at` real DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_code_unique` ON `products` (`code`);--> statement-breakpoint
CREATE INDEX `cat_idx` ON `products` (`category`);--> statement-breakpoint
CREATE TABLE `pumps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reward_redemptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`member_id` integer NOT NULL,
	`reward_id` integer NOT NULL,
	`points_used` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rewards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`points_required` integer NOT NULL,
	`stock` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sale_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sale_id` integer NOT NULL,
	`product_id` integer,
	`name` text NOT NULL,
	`qty` real NOT NULL,
	`unit` text DEFAULT 'ชิ้น' NOT NULL,
	`unit_price` real NOT NULL,
	`amount` real NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sale_idx` ON `sale_items` (`sale_id`);--> statement-breakpoint
CREATE TABLE `sales` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`receipt_no` text NOT NULL,
	`shift_id` integer,
	`staff_name` text DEFAULT '' NOT NULL,
	`member_id` integer,
	`subtotal` real NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`vat_rate` real DEFAULT 7 NOT NULL,
	`vat_amount` real DEFAULT 0 NOT NULL,
	`total` real NOT NULL,
	`payment_method` text DEFAULT 'cash' NOT NULL,
	`received` real DEFAULT 0 NOT NULL,
	`change_amt` real DEFAULT 0 NOT NULL,
	`points_earned` integer DEFAULT 0 NOT NULL,
	`points_redeemed` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_receipt_no_unique` ON `sales` (`receipt_no`);--> statement-breakpoint
CREATE INDEX `created_idx` ON `sales` (`created_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shift_readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shift_id` integer NOT NULL,
	`nozzle_id` integer NOT NULL,
	`open_meter` real NOT NULL,
	`close_meter` real,
	`open_money` real DEFAULT 0 NOT NULL,
	`close_money` real,
	`price_per_liter` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shift_idx` ON `shift_readings` (`shift_id`);--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`staff_id` integer,
	`staff_name` text NOT NULL,
	`opened_at` integer NOT NULL,
	`closed_at` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`total_liters` real DEFAULT 0 NOT NULL,
	`total_amount` real DEFAULT 0 NOT NULL,
	`total_money_meter` real DEFAULT 0 NOT NULL,
	`pos_amount` real DEFAULT 0 NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `staff_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`pin` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'cashier' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_users_username_unique` ON `staff_users` (`username`);--> statement-breakpoint
CREATE TABLE `tank_refills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tank_id` integer NOT NULL,
	`liters` real NOT NULL,
	`cost_per_liter` real DEFAULT 0 NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tax_invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tax_invoice_no` text NOT NULL,
	`sale_id` integer NOT NULL,
	`customer_name` text NOT NULL,
	`customer_tax_id` text DEFAULT '' NOT NULL,
	`customer_branch` text DEFAULT '' NOT NULL,
	`customer_address` text,
	`customer_phone` text DEFAULT '' NOT NULL,
	`vehicle_plate` text DEFAULT '' NOT NULL,
	`issued_by` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_invoices_tax_invoice_no_unique` ON `tax_invoices` (`tax_invoice_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `tax_invoices_sale_id_unique` ON `tax_invoices` (`sale_id`);