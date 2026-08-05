CREATE TABLE `daily_revenue` (
	`day` text PRIMARY KEY NOT NULL,
	`revenue` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `door_events` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text,
	`action` text NOT NULL,
	`result` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`plan_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`balance_cents` integer DEFAULT 0 NOT NULL,
	`nfc_token` text,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`joined_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_visit_at` text,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_nfc_token_unique` ON `members` (`nfc_token`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text,
	`source` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`tax_cents` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'paid' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`stripe_reference` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`price_cents` integer NOT NULL,
	`interval` text DEFAULT 'month' NOT NULL,
	`stripe_price_id` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sku` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`price_cents` integer NOT NULL,
	`stock` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_sku_unique` ON `products` (`sku`);--> statement-breakpoint
CREATE TABLE `sale_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sale_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_cents` integer NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sales` (
	`id` text PRIMARY KEY NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`tax_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer NOT NULL,
	`payment_method` text NOT NULL,
	`status` text DEFAULT 'paid' NOT NULL,
	`stripe_session_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `visits` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`method` text DEFAULT 'manual' NOT NULL,
	`result` text DEFAULT 'approved' NOT NULL,
	`denial_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
