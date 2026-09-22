import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applyMigration, checkMigrations, defaultDirectory } from '../scripts/check-migrations.mjs';

const files = readdirSync(defaultDirectory).filter(name => name.endsWith('.sql')).sort();
const source = name => readFileSync(resolve(defaultDirectory, name), 'utf8');
assert.equal(checkMigrations().migrations, files.length);
console.log('PASS Fresh database accepts every migration through the installed Wrangler SQL splitter');

const clubName = '0007_club_expansion.sql';
const clubSource = source(clubName);
const db = new DatabaseSync(':memory:');
try {
  db.exec('PRAGMA foreign_keys = ON');
  for (const name of files.filter(name => name < clubName)) applyMigration(db, name, source(name));
  db.prepare('UPDATE players SET pin_hash=? WHERE id=?').run('saved-player-hash', 'one');
  db.prepare('INSERT INTO players(id,name,pin_hash,character) VALUES (?,?,?,?)').run('gud', 'Gud', 'saved-gud-hash', 'gud');
  db.prepare('INSERT INTO sessions(token_hash,player_id,expires) VALUES (?,?,?)').run('existing-session', 'one', 2000000000000);
  db.prepare('UPDATE spectator_settings SET pin_hash=? WHERE id=1').run('saved-spectator-hash');
  db.prepare('INSERT INTO spectator_sessions(token_hash,expires) VALUES (?,?)').run('existing-spectator', 2000000000000);
  db.prepare('UPDATE notification_settings SET enabled=1 WHERE id=1').run();
  for (const [id, status, winner] of [['saved-win', 'finished', 'one'], ['saved-draw', 'finished', null], ['in-progress', 'active', null]]) {
    const state = JSON.stringify({ id, white: 'one', black: 'two', status, winner, moves: ['e4', 'e5'], minutes: 5, increment: 0 });
    db.prepare('INSERT INTO games(id,active_key,state,version,created_at,finished_at) VALUES (?,?,?,?,?,?)')
      .run(id, status === 'active' ? 1 : null, state, 2, 100, status === 'finished' ? 200 : null);
  }
  db.prepare('INSERT INTO notification_outbox(id,game_id,kind,created_at) VALUES (?,?,?,?)')
    .run('saved-win:result', 'saved-win', 'result', 200);

  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
  const snapshot = () => Object.fromEntries(tables.map(name => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
  const before = snapshot();

  // Restore the ambiguous CASE spelling responsible for the reported deployment failure.
  const broken = clubSource.replace('winner=IIF(one_wins>two_wins,player_one,player_two)',
    'winner=CASE WHEN one_wins>two_wins THEN player_one ELSE player_two END');
  assert.notEqual(broken, clubSource);
  assert.throws(() => applyMigration(db, clubName, broken), /0007_club_expansion\.sql, statement \d+: incomplete input/);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='series'").get().n, 0);
  assert.deepEqual(snapshot(), before);
  console.log('PASS Preflight catches the original incomplete-input defect and rolls back the failed migration');

  applyMigration(db, clubName, clubSource);
  assert.deepEqual(snapshot(), before);
  assert.equal(db.prepare('SELECT count(*) AS n FROM game_seats').get().n, 2);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type='trigger' AND name LIKE '%series%'").get().n, 7);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  console.log('PASS Corrected retry preserves player/PIN data, sessions, active seats, history, spectator access and queued notifications');
} finally {
  db.close();
}
