-- Rename only the two original PIN identities. All IDs, credentials, sessions,
-- game records, occupied seats and other rivals remain intact.
UPDATE players SET name='Walan' WHERE id='one';
--> statement-breakpoint
UPDATE players SET name='Gud' WHERE id='two';
