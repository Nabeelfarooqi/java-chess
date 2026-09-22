-- Keep each trigger on one line for the pinned Wrangler remote D1 query path.
-- Nested conditional expressions use IIF or SELECT RAISE ... WHERE, not CASE.
CREATE TABLE player_presence (
  token_hash TEXT PRIMARY KEY NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
  last_seen INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE series (
  id TEXT PRIMARY KEY NOT NULL,
  player_one TEXT NOT NULL REFERENCES players(id),
  player_two TEXT NOT NULL REFERENCES players(id),
  best_of INTEGER NOT NULL CONSTRAINT series_best_of CHECK (best_of IN (3,5)),
  minutes INTEGER NOT NULL CONSTRAINT series_minutes CHECK (minutes IN (1,3,5,10)),
  increment INTEGER NOT NULL CONSTRAINT series_increment CHECK (increment IN (0,2)),
  status TEXT NOT NULL DEFAULT 'active' CONSTRAINT series_status CHECK (status IN ('active','finished','cancelled')),
  one_wins INTEGER NOT NULL DEFAULT 0, two_wins INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0, winner TEXT,
  version INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, finished_at INTEGER,
  CONSTRAINT series_players CHECK (player_one <> player_two)
);
--> statement-breakpoint
CREATE TABLE series_seats (
  player_id TEXT PRIMARY KEY NOT NULL REFERENCES players(id),
  series_id TEXT NOT NULL REFERENCES series(id)
);
--> statement-breakpoint
CREATE INDEX idx_games_series ON games(json_extract(state,'$.seriesId'));
--> statement-breakpoint
CREATE TRIGGER series_reserve AFTER INSERT ON series WHEN NEW.status='active' BEGIN INSERT INTO series_seats(player_id,series_id) VALUES (NEW.player_one,NEW.id),(NEW.player_two,NEW.id); END;
--> statement-breakpoint
-- The insert and both seat reservations succeed together or roll back together.
CREATE TRIGGER games_series_guard BEFORE INSERT ON games BEGIN SELECT RAISE(ABORT,'series seat is reserved') WHERE EXISTS ( SELECT 1 FROM series_seats WHERE player_id IN (json_extract(NEW.state,'$.white'),json_extract(NEW.state,'$.black')) AND series_id IS NOT json_extract(NEW.state,'$.seriesId') ); SELECT RAISE(ABORT,'invalid series round') WHERE json_extract(NEW.state,'$.seriesId') IS NOT NULL AND NOT EXISTS ( SELECT 1 FROM series s WHERE s.id=json_extract(NEW.state,'$.seriesId') AND s.status='active' AND s.player_one IN (json_extract(NEW.state,'$.white'),json_extract(NEW.state,'$.black')) AND s.player_two IN (json_extract(NEW.state,'$.white'),json_extract(NEW.state,'$.black')) AND s.minutes=json_extract(NEW.state,'$.minutes') AND s.increment=json_extract(NEW.state,'$.increment') AND json_extract(NEW.state,'$.seriesRound')=s.one_wins+s.two_wins+1 ); END;
--> statement-breakpoint
CREATE TRIGGER games_series_insert AFTER INSERT ON games WHEN json_extract(NEW.state,'$.seriesId') IS NOT NULL BEGIN UPDATE series SET version=version+1 WHERE id=json_extract(NEW.state,'$.seriesId'); END;
--> statement-breakpoint
CREATE TRIGGER games_series_result AFTER UPDATE OF state ON games WHEN json_extract(NEW.state,'$.seriesId') IS NOT NULL AND json_extract(OLD.state,'$.status')<>'finished' AND json_extract(NEW.state,'$.status')='finished' BEGIN UPDATE series SET one_wins=one_wins+IIF(json_extract(NEW.state,'$.winner')=player_one,1,0), two_wins=two_wins+IIF(json_extract(NEW.state,'$.winner')=player_two,1,0), draws=draws+IIF(json_extract(NEW.state,'$.winner') IS NULL,1,0), version=version+1 WHERE id=json_extract(NEW.state,'$.seriesId') AND status='active'; UPDATE series SET status='finished',finished_at=NEW.finished_at, winner=IIF(one_wins>two_wins,player_one,player_two) WHERE id=json_extract(NEW.state,'$.seriesId') AND status='active' AND (one_wins>best_of/2 OR two_wins>best_of/2); END;
--> statement-breakpoint
CREATE TRIGGER games_series_pending AFTER UPDATE OF state ON games WHEN json_extract(NEW.state,'$.seriesId') IS NOT NULL AND json_extract(OLD.state,'$.status')='pending' AND json_extract(NEW.state,'$.status') IN ('active','cancelled') BEGIN UPDATE series SET version=version+1 WHERE id=json_extract(NEW.state,'$.seriesId') AND status='active'; UPDATE series SET status='cancelled',finished_at=NEW.finished_at WHERE id=json_extract(NEW.state,'$.seriesId') AND status='active' AND json_extract(NEW.state,'$.status')='cancelled' AND one_wins+two_wins+draws=0; END;
--> statement-breakpoint
CREATE TRIGGER series_cannot_abandon_active BEFORE UPDATE OF status ON series WHEN NEW.status='cancelled' AND EXISTS ( SELECT 1 FROM games WHERE json_extract(state,'$.seriesId')=NEW.id AND json_extract(state,'$.status')='active' ) BEGIN SELECT RAISE(ABORT,'finish the active game before ending the series'); END;
--> statement-breakpoint
CREATE TRIGGER series_release AFTER UPDATE OF status ON series WHEN OLD.status='active' AND NEW.status<>'active' BEGIN DELETE FROM series_seats WHERE series_id=NEW.id; UPDATE games SET state=json_set(state,'$.status','cancelled','$.reason','Series ended','$.finishedAt',NEW.finished_at), version=version+1,active_key=NULL,finished_at=NEW.finished_at WHERE json_extract(state,'$.seriesId')=NEW.id AND json_extract(state,'$.status')='pending'; END;
--> statement-breakpoint
CREATE TABLE practice_puzzles (
  id TEXT PRIMARY KEY NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id), game_id TEXT NOT NULL REFERENCES games(id),
  ply INTEGER NOT NULL, fen TEXT NOT NULL, solution TEXT NOT NULL,
  loss INTEGER NOT NULL, depth INTEGER NOT NULL, created_at INTEGER NOT NULL,
  solved_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX idx_practice_player ON practice_puzzles(player_id,created_at);

--> statement-breakpoint
CREATE UNIQUE INDEX practice_puzzles_player_id_game_id_ply_unique ON practice_puzzles(player_id,game_id,ply);
