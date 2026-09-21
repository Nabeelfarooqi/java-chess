CREATE TABLE `game_seats` (
	`player_id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_game_seats_game` ON `game_seats` (`game_id`);--> statement-breakpoint
CREATE TABLE `pin_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`salt` text NOT NULL
);
--> statement-breakpoint
DROP INDEX `idx_games_active`;--> statement-breakpoint
CREATE INDEX `idx_games_active` ON `games` (`active_key`);--> statement-breakpoint
ALTER TABLE `players` ADD `pin_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_players_pin` ON `players` (`pin_hash`);
--> statement-breakpoint
-- Keep existing identities, display names, sessions, games and scores intact.
INSERT OR IGNORE INTO players(id,name) VALUES ('one','Nabeel'),('two','Saif');
--> statement-breakpoint
INSERT INTO pin_settings(id,salt) VALUES (1,lower(hex(randomblob(24))));
--> statement-breakpoint
-- Backfill occupied seats for a game already running during the upgrade.
INSERT INTO game_seats(player_id,game_id)
SELECT json_extract(state,'$.white'),id FROM games WHERE active_key=1
UNION ALL SELECT json_extract(state,'$.black'),id FROM games WHERE active_key=1;
--> statement-breakpoint
CREATE TRIGGER games_reserve_seats AFTER INSERT ON games WHEN NEW.active_key=1
BEGIN
  INSERT INTO game_seats(player_id,game_id) VALUES (json_extract(NEW.state,'$.white'),NEW.id),(json_extract(NEW.state,'$.black'),NEW.id);
END;
--> statement-breakpoint
CREATE TRIGGER games_release_seats AFTER UPDATE OF active_key ON games WHEN OLD.active_key=1 AND NEW.active_key IS NULL
BEGIN
  DELETE FROM game_seats WHERE game_id=NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER games_delete_seats AFTER DELETE ON games
BEGIN
  DELETE FROM game_seats WHERE game_id=OLD.id;
END;
