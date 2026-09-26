ALTER TABLE `players` ADD `legacy_pin_hash` text;--> statement-breakpoint
ALTER TABLE `players` ADD `auth_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_sessions_player` ON `sessions` (`player_id`,`expires`);
--> statement-breakpoint
-- Keep trigger bodies on one line for remote D1 splitter compatibility.
CREATE TRIGGER players_auth_version AFTER UPDATE OF pin_hash ON players WHEN OLD.pin_hash IS NOT NEW.pin_hash BEGIN UPDATE players SET auth_version=auth_version+1 WHERE id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER players_legacy_pin_changed AFTER UPDATE OF legacy_pin_hash ON players WHEN OLD.legacy_pin_hash IS NOT NEW.legacy_pin_hash BEGIN UPDATE players SET auth_version=auth_version+1 WHERE id=NEW.id; DELETE FROM sessions WHERE player_id=NEW.id; END;
--> statement-breakpoint
CREATE INDEX idx_games_white_created ON games (json_extract(state,'$.white'),created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_games_black_created ON games (json_extract(state,'$.black'),created_at DESC);
