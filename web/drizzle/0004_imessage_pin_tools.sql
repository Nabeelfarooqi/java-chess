CREATE TABLE `notification_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`lease_token` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`detail` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_notification_pending` ON `notification_outbox` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `notification_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL
);

--> statement-breakpoint
INSERT INTO notification_settings(id,enabled) VALUES (1,0);
--> statement-breakpoint
-- Changing a PIN atomically revokes only that player's existing sessions.
CREATE TRIGGER players_pin_changed AFTER UPDATE OF pin_hash ON players
WHEN OLD.pin_hash IS NOT NEW.pin_hash
BEGIN
  DELETE FROM sessions WHERE player_id=NEW.id;
END;
--> statement-breakpoint
-- Queue new events only after the Mac setup command enables notifications.
CREATE TRIGGER games_notify_challenge AFTER INSERT ON games
WHEN json_extract(NEW.state,'$.status')='pending'
AND (SELECT enabled FROM notification_settings WHERE id=1)=1
BEGIN
  INSERT OR IGNORE INTO notification_outbox(id,game_id,kind,created_at)
  VALUES (NEW.id||':challenge',NEW.id,'challenge',NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER games_notify_result AFTER UPDATE OF state ON games
WHEN json_extract(OLD.state,'$.status')<>'finished'
AND json_extract(NEW.state,'$.status')='finished'
AND (SELECT enabled FROM notification_settings WHERE id=1)=1
BEGIN
  INSERT OR IGNORE INTO notification_outbox(id,game_id,kind,created_at)
  VALUES (NEW.id||':result',NEW.id,'result',NEW.finished_at);
END;
