DELETE FROM sale_items;
--> statement-breakpoint
DELETE FROM sales;
--> statement-breakpoint
DELETE FROM door_events;
--> statement-breakpoint
DELETE FROM visits;
--> statement-breakpoint
DELETE FROM payments;
--> statement-breakpoint
DELETE FROM members;
--> statement-breakpoint
INSERT OR IGNORE INTO settings (key, value) VALUES ('seed_data_removed_v2', 'true');
