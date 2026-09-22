-- Attach the supplied drawing to Saif's original PIN identity only.
-- Preserve display names, PIN hashes, sessions, game seats, and history.
UPDATE players SET character='saif' WHERE id='two' AND character IS NULL;
