CREATE TABLE `customers` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`tax_id` varchar(20) NOT NULL DEFAULT '',
	`branch` varchar(64) NOT NULL DEFAULT '',
	`address` text,
	`phone` varchar(20) NOT NULL DEFAULT '',
	`vehicle_plate` varchar(32) NOT NULL DEFAULT '',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fuel_tanks` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`name` varchar(64) NOT NULL,
	`capacity_liters` decimal(12,2) NOT NULL,
	`current_liters` decimal(12,2) NOT NULL DEFAULT 0,
	`low_alert_at` decimal(12,2) NOT NULL DEFAULT 0,
	CONSTRAINT `fuel_tanks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`member_code` varchar(32) NOT NULL,
	`name` varchar(128) NOT NULL,
	`phone` varchar(20) NOT NULL,
	`points` int NOT NULL DEFAULT 0,
	`tier` enum('silver','gold','platinum') NOT NULL DEFAULT 'silver',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `members_id` PRIMARY KEY(`id`),
	CONSTRAINT `members_member_code_unique` UNIQUE(`member_code`),
	CONSTRAINT `members_phone_unique` UNIQUE(`phone`)
);
--> statement-breakpoint
CREATE TABLE `nozzles` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`pump_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned NOT NULL,
	`label` varchar(64) NOT NULL,
	`current_meter` decimal(14,2) NOT NULL DEFAULT 0,
	`current_money` decimal(16,2) NOT NULL DEFAULT 0,
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `nozzles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `point_transactions` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`member_id` bigint unsigned NOT NULL,
	`sale_id` bigint unsigned,
	`type` enum('earn','redeem','adjust') NOT NULL,
	`points` int NOT NULL,
	`note` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `point_transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`code` varchar(32) NOT NULL,
	`name` varchar(128) NOT NULL,
	`category` enum('fuel','lubricant','other') NOT NULL,
	`unit` varchar(16) NOT NULL DEFAULT 'ชิ้น',
	`price` decimal(10,2) NOT NULL,
	`cost` decimal(10,2) NOT NULL DEFAULT 0,
	`stock_qty` decimal(12,2) NOT NULL DEFAULT 0,
	`low_stock_at` decimal(12,2) NOT NULL DEFAULT 0,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `pumps` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(64) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `pumps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reward_redemptions` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`member_id` bigint unsigned NOT NULL,
	`reward_id` bigint unsigned NOT NULL,
	`points_used` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reward_redemptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rewards` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`points_required` int NOT NULL,
	`stock` int NOT NULL DEFAULT 0,
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `rewards_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sale_items` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`sale_id` bigint unsigned NOT NULL,
	`product_id` bigint unsigned,
	`name` varchar(128) NOT NULL,
	`qty` decimal(12,2) NOT NULL,
	`unit` varchar(16) NOT NULL DEFAULT 'ชิ้น',
	`unit_price` decimal(10,2) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	CONSTRAINT `sale_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sales` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`receipt_no` varchar(32) NOT NULL,
	`shift_id` bigint unsigned,
	`staff_name` varchar(128) NOT NULL DEFAULT '',
	`member_id` bigint unsigned,
	`subtotal` decimal(12,2) NOT NULL,
	`discount` decimal(12,2) NOT NULL DEFAULT 0,
	`vat_rate` decimal(5,2) NOT NULL DEFAULT 7,
	`vat_amount` decimal(12,2) NOT NULL DEFAULT 0,
	`total` decimal(12,2) NOT NULL,
	`payment_method` enum('cash','qr','card') NOT NULL DEFAULT 'cash',
	`received` decimal(12,2) NOT NULL DEFAULT 0,
	`change_amt` decimal(12,2) NOT NULL DEFAULT 0,
	`points_earned` int NOT NULL DEFAULT 0,
	`points_redeemed` int NOT NULL DEFAULT 0,
	`status` enum('completed','voided') NOT NULL DEFAULT 'completed',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sales_id` PRIMARY KEY(`id`),
	CONSTRAINT `sales_receipt_no_unique` UNIQUE(`receipt_no`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` varchar(64) NOT NULL,
	`value` mediumtext NOT NULL,
	CONSTRAINT `settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `shift_readings` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`shift_id` bigint unsigned NOT NULL,
	`nozzle_id` bigint unsigned NOT NULL,
	`open_meter` decimal(14,2) NOT NULL,
	`close_meter` decimal(14,2),
	`open_money` decimal(16,2) NOT NULL DEFAULT 0,
	`close_money` decimal(16,2),
	`price_per_liter` decimal(10,2) NOT NULL DEFAULT 0,
	CONSTRAINT `shift_readings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`staff_id` bigint unsigned,
	`staff_name` varchar(128) NOT NULL,
	`opened_at` timestamp NOT NULL DEFAULT (now()),
	`closed_at` timestamp,
	`status` enum('open','closed') NOT NULL DEFAULT 'open',
	`total_liters` decimal(14,2) NOT NULL DEFAULT 0,
	`total_amount` decimal(14,2) NOT NULL DEFAULT 0,
	`total_money_meter` decimal(16,2) NOT NULL DEFAULT 0,
	`pos_amount` decimal(14,2) NOT NULL DEFAULT 0,
	`note` text,
	CONSTRAINT `shifts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `staff_users` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`username` varchar(64) NOT NULL,
	`pin` varchar(128) NOT NULL,
	`name` varchar(128) NOT NULL,
	`role` enum('admin','manager','cashier') NOT NULL DEFAULT 'cashier',
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `staff_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `staff_users_username_unique` UNIQUE(`username`)
);
--> statement-breakpoint
CREATE TABLE `tank_refills` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tank_id` bigint unsigned NOT NULL,
	`liters` decimal(12,2) NOT NULL,
	`cost_per_liter` decimal(10,2) NOT NULL DEFAULT 0,
	`note` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tank_refills_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tax_invoices` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tax_invoice_no` varchar(32) NOT NULL,
	`sale_id` bigint unsigned NOT NULL,
	`customer_name` varchar(255) NOT NULL,
	`customer_tax_id` varchar(20) NOT NULL DEFAULT '',
	`customer_branch` varchar(64) NOT NULL DEFAULT '',
	`customer_address` text,
	`customer_phone` varchar(20) NOT NULL DEFAULT '',
	`vehicle_plate` varchar(32) NOT NULL DEFAULT '',
	`issued_by` varchar(128) NOT NULL DEFAULT '',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tax_invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `tax_invoices_tax_invoice_no_unique` UNIQUE(`tax_invoice_no`),
	CONSTRAINT `tax_invoices_sale_id_unique` UNIQUE(`sale_id`)
);
--> statement-breakpoint
CREATE INDEX `pump_idx` ON `nozzles` (`pump_id`);--> statement-breakpoint
CREATE INDEX `member_idx` ON `point_transactions` (`member_id`);--> statement-breakpoint
CREATE INDEX `cat_idx` ON `products` (`category`);--> statement-breakpoint
CREATE INDEX `sale_idx` ON `sale_items` (`sale_id`);--> statement-breakpoint
CREATE INDEX `created_idx` ON `sales` (`created_at`);--> statement-breakpoint
CREATE INDEX `shift_idx` ON `shift_readings` (`shift_id`);