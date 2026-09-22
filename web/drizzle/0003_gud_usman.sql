ALTER TABLE `players` ADD `character` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_players_character` ON `players` (`character`);
--> statement-breakpoint
-- Walan remains attached to Nabeel's original PIN identity.
UPDATE players SET character='walan' WHERE id='one';
--> statement-breakpoint
-- Undo the previous release's mistaken display-name change for Saif.
UPDATE players SET name='Saif' WHERE id='two' AND lower(trim(name))='gud';
--> statement-breakpoint
-- Bind Gud once to the existing Usman profile, keeping its generated ID,
-- PIN hash, sessions, games, and scores. Allow an already-renamed Gud profile.
-- Never guess between duplicate candidates or use either original PIN slot.
UPDATE players SET character='gud', name='Gud'
WHERE id NOT IN ('one','two') AND lower(trim(name)) IN ('usman','gud')
AND (SELECT COUNT(*) FROM players WHERE id NOT IN ('one','two')
     AND lower(trim(name)) IN ('usman','gud'))=1;
