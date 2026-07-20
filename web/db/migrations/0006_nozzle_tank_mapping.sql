ALTER TABLE `nozzles` ADD `tank_id` integer;
--> statement-breakpoint
UPDATE `nozzles`
SET `tank_id` = (
	SELECT `fuel_tanks`.`id`
	FROM `fuel_tanks`
	WHERE `fuel_tanks`.`product_id` = `nozzles`.`product_id`
	ORDER BY `fuel_tanks`.`id`
	LIMIT 1
)
WHERE `tank_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `nozzle_tank_idx` ON `nozzles` (`tank_id`);
