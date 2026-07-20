CREATE TABLE `employee_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`staff_id` integer NOT NULL,
	`position` text DEFAULT '' NOT NULL,
	`salary_type` text DEFAULT 'monthly' NOT NULL,
	`base_rate` real DEFAULT 0 NOT NULL,
	`overtime_rate` real DEFAULT 0 NOT NULL,
	`hire_date` text,
	`note` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employeeprofile_staff_unique` ON `employee_profiles` (`staff_id`);--> statement-breakpoint
CREATE TABLE `payroll_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payroll_month` text NOT NULL,
	`staff_id` integer NOT NULL,
	`work_days` integer DEFAULT 0 NOT NULL,
	`work_hours` real DEFAULT 0 NOT NULL,
	`base_amount` real DEFAULT 0 NOT NULL,
	`overtime_hours` real DEFAULT 0 NOT NULL,
	`overtime_amount` real DEFAULT 0 NOT NULL,
	`bonus` real DEFAULT 0 NOT NULL,
	`deduction` real DEFAULT 0 NOT NULL,
	`net_amount` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`paid_at` integer,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payroll_month_idx` ON `payroll_records` (`payroll_month`);--> statement-breakpoint
CREATE UNIQUE INDEX `payroll_staff_month_unique` ON `payroll_records` (`staff_id`,`payroll_month`);--> statement-breakpoint
CREATE TABLE `work_schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`work_date` text NOT NULL,
	`shift_template_id` integer NOT NULL,
	`staff_id` integer NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workschedule_date_idx` ON `work_schedules` (`work_date`);--> statement-breakpoint
CREATE INDEX `workschedule_staff_idx` ON `work_schedules` (`staff_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workschedule_assignment_unique` ON `work_schedules` (`work_date`,`shift_template_id`,`staff_id`);--> statement-breakpoint
CREATE TABLE `work_shift_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`break_minutes` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
INSERT INTO `work_shift_templates` (`name`, `start_time`, `end_time`, `break_minutes`, `active`) VALUES
	('กะเช้า', '06:00', '14:00', 60, true),
	('กะบ่าย', '14:00', '22:00', 60, true),
	('กะดึก', '22:00', '06:00', 60, true);
