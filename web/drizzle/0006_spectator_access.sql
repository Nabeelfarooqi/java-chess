CREATE TABLE `spectator_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_spectator_sessions_expiry` ON `spectator_sessions` (`expires`);--> statement-breakpoint
CREATE TABLE `spectator_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`pin_hash` text
);
--> statement-breakpoint
INSERT INTO spectator_settings(id,pin_hash) VALUES (1,NULL);
--> statement-breakpoint
CREATE TRIGGER spectator_pin_changed AFTER UPDATE OF pin_hash ON spectator_settings
WHEN NEW.pin_hash IS NOT OLD.pin_hash
BEGIN DELETE FROM spectator_sessions; END;
--> statement-breakpoint
CREATE TRIGGER spectator_pin_unique_insert BEFORE INSERT ON spectator_settings
WHEN NEW.pin_hash IS NOT NULL AND EXISTS (SELECT 1 FROM players WHERE pin_hash=NEW.pin_hash)
BEGIN SELECT RAISE(ABORT,'Spectator code conflicts with a player code'); END;
--> statement-breakpoint
CREATE TRIGGER spectator_pin_unique_update BEFORE UPDATE OF pin_hash ON spectator_settings
WHEN NEW.pin_hash IS NOT NULL AND EXISTS (SELECT 1 FROM players WHERE pin_hash=NEW.pin_hash)
BEGIN SELECT RAISE(ABORT,'Spectator code conflicts with a player code'); END;
--> statement-breakpoint
CREATE TRIGGER players_spectator_pin_insert BEFORE INSERT ON players
WHEN NEW.pin_hash IS NOT NULL AND EXISTS (SELECT 1 FROM spectator_settings WHERE pin_hash=NEW.pin_hash)
BEGIN SELECT RAISE(ABORT,'Player code conflicts with the spectator code'); END;
--> statement-breakpoint
CREATE TRIGGER players_spectator_pin_update BEFORE UPDATE OF pin_hash ON players
WHEN NEW.pin_hash IS NOT NULL AND EXISTS (SELECT 1 FROM spectator_settings WHERE pin_hash=NEW.pin_hash)
BEGIN SELECT RAISE(ABORT,'Player code conflicts with the spectator code'); END;
