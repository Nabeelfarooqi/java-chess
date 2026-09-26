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

  // This reproduces a LOCAL splitter defect; remote D1 parses the complete SQL itself.
  const broken = clubSource.replace('winner=IIF(one_wins>two_wins,player_one,player_two)',
    'winner=CASE WHEN one_wins>two_wins THEN player_one ELSE player_two END');
  assert.notEqual(broken, clubSource);
  assert.throws(() => applyMigration(db, clubName, broken), /0007_club_expansion\.sql, statement \d+: incomplete input/);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='series'").get().n, 0);
  assert.deepEqual(snapshot(), before);
  console.log('PASS Preflight catches the local incomplete-input defect and rolls back the failed migration');

  applyMigration(db, clubName, clubSource);
  assert.deepEqual(snapshot(), before);
  assert.equal(db.prepare('SELECT count(*) AS n FROM game_seats').get().n, 2);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type='trigger' AND name LIKE '%series%'").get().n, 7);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  console.log('PASS Corrected retry preserves player/PIN data, sessions, active seats, history, spectator access and queued notifications');

  // Preserve the remote-query compatibility form documented in workers-sdk #4998/#15044.
  const triggerBlocks = clubSource.split('--> statement-breakpoint').filter(sql => sql.includes('CREATE TRIGGER '));
  assert.equal(triggerBlocks.length, 7);
  for (const block of triggerBlocks) {
    const trigger = block.slice(block.indexOf('CREATE TRIGGER ')).trim();
    assert.doesNotMatch(trigger, /[\r\n]|\bCASE\b/);
  }

  db.prepare("DELETE FROM games WHERE id='in-progress'").run();
  db.prepare("INSERT INTO series(id,player_one,player_two,best_of,minutes,increment,created_at) VALUES ('guard-test','one','two',3,5,0,300)").run();
  const round = { white: 'one', black: 'two', status: 'pending', seriesId: 'guard-test', seriesRound: 1, minutes: 5, increment: 0 };
  const insert = changes => db.prepare('INSERT INTO games(id,active_key,state,version,created_at) VALUES (?,?,?,?,?)')
    .run('next-round', 1, JSON.stringify({ ...round, ...changes }), 0, 300);
  assert.throws(() => insert({ seriesId: null }), /series seat is reserved/);
  for (const invalid of [{ seriesRound: 2 }, { minutes: 10 }, { increment: 2 }, { black: 'gud' }]) {
    assert.throws(() => insert(invalid), /invalid series round/);
  }
  assert.equal(db.prepare("SELECT version FROM series WHERE id='guard-test'").get().version, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM game_seats').get().n, 0);
  insert({});
  assert.equal(db.prepare("SELECT version FROM series WHERE id='guard-test'").get().version, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM game_seats').get().n, 2);
  assert.equal(db.prepare("SELECT count(*) AS n FROM notification_outbox WHERE id='next-round:challenge'").get().n, 1);
  console.log('PASS Single-line triggers keep seat, round, clock and participant guards and accept valid rounds');

  const retained = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(({name}) => {
    const columns = db.prepare(`PRAGMA table_info("${name}")`).all().map(row => `"${row.name}"`).join(',');
    const query = `SELECT ${columns} FROM "${name}" ORDER BY rowid`;
    return {query, rows: db.prepare(query).all()};
  });
  const authMigration = '0008_auth_revision_and_indexes.sql';
  applyMigration(db, authMigration, source(authMigration));
  for (const {query, rows} of retained) assert.deepEqual(db.prepare(query).all(), rows);
  assert.equal(db.prepare("SELECT auth_version FROM players WHERE id='one'").get().auth_version, 0);
  db.prepare("UPDATE players SET pin_hash='replacement' WHERE id='one'").run();
  assert.equal(db.prepare("SELECT auth_version FROM players WHERE id='one'").get().auth_version, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sessions WHERE player_id='one'").get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM spectator_sessions').get().n, 1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  for (const block of source(authMigration).split('--> statement-breakpoint').filter(sql => sql.includes('CREATE TRIGGER '))) {
    assert.doesNotMatch(block.slice(block.indexOf('CREATE TRIGGER ')).trim(), /[\r\n]|\bCASE\b/);
  }
  console.log('PASS Auth revision upgrade preserves every existing row before rotation, then revokes only the changed player');
} finally {
  db.close();
}
