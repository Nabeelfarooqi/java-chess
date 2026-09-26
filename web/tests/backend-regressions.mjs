import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const root = new URL('../', import.meta.url);
const require = createRequire(realpathSync(new URL('node_modules/wrangler/package.json', root)));
const { build } = require('esbuild');
async function load(path) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(path, root))], bundle: true, format: 'esm', platform: 'node', target: 'es2022', write: false });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const auth = await load('lib/server/auth.ts');
const { readJson } = await load('lib/server/request.ts');
const { handlePOST } = await load('lib/server/api.ts');
const { handleSpectator } = await load('lib/server/spectator.ts');
const { Store } = await load('lib/server/store.ts');
const sql = new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
for (const file of readdirSync(new URL('drizzle/', root)).filter(f => f.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL('drizzle/' + file, root), 'utf8'));
let beforeBatch;
let queried = [];
const db = {
  prepare(text) {
    queried.push(text);
    let values = [];
    const statement = {
      text,
      bind(...args) { values = args; return statement; },
      async first() { return sql.prepare(text).get(...values) || null; },
      async all() { return { results: sql.prepare(text).all(...values) }; },
      async run() {
        const s = sql.prepare(text), results = s.columns().length ? s.all(...values) : [];
        if (!s.columns().length) s.run(...values);
        return { results, success: true, meta: { changes: Number(sql.prepare('SELECT changes() AS n').get().n) } };
      },
    };
    return statement;
  },
  async batch(statements) {
    if (beforeBatch) { const hook = beforeBatch; beforeBatch = undefined; hook(statements); }
    sql.exec('BEGIN');
    try { const results = []; for (const s of statements) results.push(await s.run()); sql.exec('COMMIT'); return results; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  },
};
const req = () => new Request('https://regression.invalid/');
const salt = sql.prepare('SELECT salt FROM pin_settings WHERE id=1').get().salt;
const a = await auth.pinHash('123456', salt), b = await auth.pinHash('654321', salt);
const resetAttempts = () => sql.exec('DELETE FROM attempts');
try {
  for (const restore of [false, true]) {
    sql.prepare("UPDATE players SET pin_hash=? WHERE id='one'").run(a);
    beforeBatch = () => {
      sql.prepare("UPDATE players SET pin_hash=? WHERE id='one'").run(b);
      if (restore) sql.prepare("UPDATE players SET pin_hash=? WHERE id='one'").run(a);
    };
    await assert.rejects(auth.login(db, req(), '123456', {}), e => e.status === 401);
    assert.equal(sql.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
    resetAttempts();
  }
  const good = await auth.login(db, req(), '123456', {});
  assert.equal(await auth.sessionPlayer(db, new Request(req(), { headers: { Cookie: 'rr_session=' + good.token } })), 'one');
  const revision = sql.prepare("SELECT auth_version FROM players WHERE id='one'").get().auth_version;
  sql.prepare("UPDATE players SET name='Custom name' WHERE id='one'").run();
  assert.equal(sql.prepare("SELECT auth_version FROM players WHERE id='one'").get().auth_version, revision);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM sessions').get().n, 1);
  sql.prepare("UPDATE players SET pin_hash=? WHERE id='one'").run(b);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
  console.log('PASS Chosen-code rotations invalidate existing and in-flight sessions, including A→B→A; profile edits preserve sessions');

  const oldLegacy = 'old:' + await auth.pinHash('12345678', 'old');
  const newLegacy = 'new:' + await auth.pinHash('87654321', 'new');
  sql.prepare("UPDATE players SET pin_hash=NULL,legacy_pin_hash=NULL WHERE id='one'").run();
  resetAttempts();
  beforeBatch = () => sql.prepare("UPDATE players SET legacy_pin_hash=? WHERE id='one'").run(newLegacy);
  await assert.rejects(auth.login(db, req(), '12345678', { PIN_ONE_HASH: oldLegacy }), e => e.status === 401);
  resetAttempts();
  await assert.rejects(auth.login(db, req(), '12345678', { PIN_ONE_HASH: oldLegacy }), e => e.status === 401);
  resetAttempts();
  assert.equal((await auth.login(db, req(), '87654321', { PIN_ONE_HASH: oldLegacy })).player, 'one');
  console.log('PASS Database legacy-code revision defeats an in-flight rotation and supersedes stale Worker configuration');

  const payload = new TextEncoder().encode(JSON.stringify({ name: 'é♟️' }));
  assert.equal((await readJson(new Request(req(), { method: 'POST', body: payload }), payload.length)).name, 'é♟️');
  await assert.rejects(readJson(new Request(req(), { method: 'POST', body: payload }), payload.length - 1), e => e.status === 413);
  for (const body of ['null', '[]', '"text"', '{', new Uint8Array([0xff])]) {
    await assert.rejects(readJson(new Request(req(), { method: 'POST', body }), 1024), e => e.status === 400);
  }
  let read = 0, cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { read += 8192; controller.enqueue(new Uint8Array(8192)); },
    cancel() { cancelled = true; return new Promise(() => {}); },
  }, { highWaterMark: 0 });
  const oversized = new Request('https://regression.invalid/api/room', { method: 'POST', headers: { Origin: 'https://regression.invalid', 'Content-Type': 'application/json' }, body: stream, duplex: 'half' });
  assert.equal((await handlePOST(oversized, {})).status, 413);
  assert.equal(cancelled, true);
  assert.ok(read <= 24576, `read ${read} bytes`);
  console.log('PASS Request limits count UTF-8 bytes, reject malformed/non-object JSON and stop streaming at the bound without awaiting producer cancellation');

  const now = Date.now();
  await auth.rateLimit(db, 'short-window', 1, 30000, now);
  await assert.rejects(auth.rateLimit(db, 'short-window', 1, 30000, now + 5000), e => e.status === 429 && e.retryAfter === 25 && /25 seconds/.test(e.message));
  await auth.rateLimit(db, 'short-window', 1, 30000, now + 30000);
  resetAttempts();
  for (let i = 0; i < 8; i++) await handlePOST(new Request('https://regression.invalid/api/room', { method: 'POST', headers: { Origin: 'https://regression.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', pin: 'bad' }) }), { DB: db });
  const limited = await handlePOST(new Request('https://regression.invalid/api/room', { method: 'POST', headers: { Origin: 'https://regression.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', pin: 'bad' }) }), { DB: db });
  assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('Retry-After')) > 0);
  console.log('PASS Retry-After and user-visible delay match the remaining rate-limit window');

  sql.exec('UPDATE notification_settings SET enabled=1 WHERE id=1');
  const store = new Store(db);
  let game = await store.create('one', 'two', 1, 0);
  const old = Date.now() - 16 * 60000;
  sql.prepare("UPDATE games SET state=json_set(state,'$.createdAt',?),created_at=? WHERE id=?").run(old, old, game.id);
  assert.ok((await store.club()).players.every(p => !p.busy));
  assert.equal((await store.get(game.id)).status, 'cancelled');
  game = await store.create('one', 'two', 1, 0);
  game = await store.act('two', 'accept', { gameId: game.id, version: game.version });
  sql.prepare("UPDATE games SET state=json_set(state,'$.turnAt',?) WHERE id=?").run(Date.now() - 61000, game.id);
  const club = await store.club();
  assert.ok(club.players.every(p => !p.busy));
  const settled = await store.get(game.id);
  assert.equal(settled.status, 'finished'); assert.equal(settled.reason, 'Time expired');
  await store.club(); assert.equal((await store.get(game.id)).version, settled.version);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM notification_outbox WHERE id=?").get(game.id + ':result').n, 1);
  console.log('PASS Club visits settle abandoned challenges and clocks, release seats and record each result once');

  queried = [];
  assert.equal((await store.current('one')).id, game.id);
  const latest = queried.find(q => q.includes('UNION ALL'));
  const plan = sql.prepare('EXPLAIN QUERY PLAN ' + latest).all('one', 'one').map(r => r.detail).join('\n');
  assert.match(plan, /idx_games_white_created/); assert.match(plan, /idx_games_black_created/); assert.doesNotMatch(plan, /SCAN games/);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
  console.log('PASS Latest-game lookup uses both participant indexes without scanning retained game history');

  // A conditional spectator insert must not emit a cookie if rotation removes its match.
  resetAttempts();
  sql.prepare('UPDATE spectator_settings SET pin_hash=? WHERE id=1').run(a);
  beforeBatch = () => sql.prepare('UPDATE spectator_settings SET pin_hash=? WHERE id=1').run(b);
  const spectator = await handleSpectator(new Request('https://regression.invalid/api/spectate', { method: 'POST', headers: { Origin: 'https://regression.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login', pin: '123456' }) }), { DB: db });
  assert.equal(spectator.status, 401); assert.equal(spectator.headers.has('set-cookie'), false);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM spectator_sessions').get().n, 0);
  console.log('PASS Spectator rotation during login returns no session cookie');
} finally { sql.close(); }
