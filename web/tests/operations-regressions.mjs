import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { BlueBubbles } from '../scripts/bluebubbles-client.mjs';
import { Journal, deliver } from '../scripts/imessage-core.mjs';
import { resolveDelivery } from '../scripts/imessage-recovery.mjs';
import { acquireProcessLock } from '../scripts/process-lock.mjs';
import { verifyDeploymentIdentity } from '../scripts/cloudflare-identity.mjs';

const directory = mkdtempSync(join(tmpdir(), 'rival-operations-'));
const config = { site: 'https://rival-room.test-account.workers.dev', bridgeToken: 'a'.repeat(64), groupChatGuid: 'iMessage;+;group', targets: { friend: 'iMessage;-;friend' } };
const job = { id: 'job', kind: 'result', text: 'Synthetic result', attempts: 1, leaseToken: 'lease' };
let checks = 0;
async function check(name, test) { await test(); checks++; console.log('PASS '+name); }

await check('Text and image require the official serialized Message confirmation, not merely HTTP success', async () => {
  for (const data of [undefined, {}, { error: 22 }, { guid: 'x', error: 22 }, { guid: 'x', isFromMe: false }, { guid: 'x', tempGuid: 'wrong' }]) {
    const bb = new BlueBubbles('http://127.0.0.1:1234', 'synthetic', async () => Response.json({ status: 200, data }));
    await assert.rejects(bb.text(config.groupChatGuid, job.text, 'expected'), /no valid send confirmation/);
    await assert.rejects(bb.image(config.groupChatGuid, Buffer.from('fake'), 'expected'), /no valid send confirmation/);
  }
  const bb = new BlueBubbles('http://127.0.0.1:1234', 'synthetic', async () => Response.json({ status: 200, data: { guid: 'message-guid', error: 0, isFromMe: true } }));
  assert.deepEqual(await bb.text(config.groupChatGuid, job.text, 'expected'), { guid: 'message-guid' });
  assert.deepEqual(await bb.image(config.groupChatGuid, Buffer.from('fake'), 'expected'), { guid: 'message-guid' });
  const accepted = new BlueBubbles('http://127.0.0.1:1234', 'synthetic', async () => Response.json({ status: 202, data: { guid: 'queued-guid' } }, { status: 202 }));
  await assert.rejects(accepted.text(config.groupChatGuid, job.text, 'expected'), /no final send confirmation/);
  const acks = [], journal = new Journal(join(directory, 'receipts'), config.site);
  const broken = new BlueBubbles('http://127.0.0.1:1234', 'synthetic', async () => Response.json({}));
  assert.equal(await deliver(job, config, { bb: broken, journal, post: async body => acks.push(body) }), 'needs_review');
  assert.equal(acks[0].status, 'needs_review');
  assert.equal(journal.get(job.id).parts.text.status, 'sending');
});

await check('Deployment verification requires matching account, actual D1 binding, and public origin', async () => {
  const accountId = 'a'.repeat(32), worker = { name: 'rival-room', d1_databases: [{ binding: 'DB', database_id: 'actual-db' }] };
  const deps = { whoami: async () => ({ accounts: [{ id: accountId }] }), api: async path => path.endsWith('/settings') ? { bindings: [{ type: 'd1', name: 'DB', id: 'actual-db' }] } : path.endsWith('/subdomain') ? { subdomain: 'test-account' } : [{ hostname: 'chess.example', service: 'rival-room', environment: 'production' }] };
  assert.deepEqual(await verifyDeploymentIdentity(worker, config, deps), { accountId, worker: 'rival-room', databaseId: 'actual-db', site: config.site });
  assert.equal((await verifyDeploymentIdentity(worker, { ...config, site: 'https://chess.example' }, deps)).site, 'https://chess.example');
  for (const [w, b, d] of [
    [{ ...worker, account_id: 'b'.repeat(32) }, config, deps],
    [{ ...worker, d1_databases: [{ binding: 'DB', database_id: 'wrong' }] }, config, deps],
    [worker, { ...config, site: 'https://other.example' }, deps],
    [worker, { ...config, site: 'https://chess.example:8443' }, deps],
    [worker, { ...config, deployment: { accountId, worker: 'other', databaseId: 'actual-db' } }, deps],
    [worker, config, { ...deps, whoami: async () => ({ accounts: [{ id: accountId }, { id: 'b'.repeat(32) }] }) }],
  ]) await assert.rejects(verifyDeploymentIdentity(w, b, d));
});

await check('Held process locks exclude concurrent commands and recover a terminated owner', () => {
  const path = join(directory, 'sender.lock'), release = acquireProcessLock(path);
  assert.throws(() => acquireProcessLock(path), /Another sender/);
  const lockModule = new URL('../scripts/process-lock.mjs', import.meta.url).href;
  const contender = spawnSync(process.execPath, ['--input-type=module', '-e', `import {acquireProcessLock} from ${JSON.stringify(lockModule)};try{acquireProcessLock(${JSON.stringify(path)});process.exit(2)}catch{process.exit(0)}`]);
  assert.equal(contender.status, 0);
  release(); release(); assert.equal(existsSync(path), false);
  const dead = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' });
  writeFileSync(path, dead.stdout.trim());
  const recovered = acquireProcessLock(path); recovered(); assert.equal(existsSync(path), false);
});

await check('Actual reconnect CLI makes zero mutations for site/Worker/DB mismatches', () => {
  const fixture = join(directory, 'reconnect'); mkdirSync(join(fixture, 'node_modules/wrangler/bin'), { recursive: true }); mkdirSync(join(fixture, '.imessage'));
  const accountId = 'a'.repeat(32), write = (path, value) => writeFileSync(join(fixture, path), typeof value === 'string' ? value : JSON.stringify(value));
  write('cloudflare.local.json', { name: 'rival-room', d1_databases: [{ binding: 'DB', database_id: 'actual-db' }] });
  write('.imessage/config.json', config);
  write('node_modules/wrangler/bin/wrangler.js', `const fs=require('node:fs'); const args=process.argv.slice(2); if(args.includes('whoami'))console.log(JSON.stringify({accounts:[{id:'${accountId}'}]}));else if(args.includes('auth'))console.log(JSON.stringify({type:'oauth',token:'fake-token'}));else{fs.appendFileSync('mutations.log',JSON.stringify(args)+'\\n');console.log(JSON.stringify([{success:true,results:[]}]))}`);
  write('mock.mjs', `globalThis.fetch=async(url,options)=>{if(url.startsWith('https://api.cloudflare.com/')){const path=new URL(url).pathname;const result=path.endsWith('/settings')?{bindings:[{type:'d1',name:'DB',id:process.env.TEST_MISMATCH==='database'?'wrong':'actual-db'}]}:path.endsWith('/subdomain')?{subdomain:process.env.TEST_MISMATCH==='site'?'other-account':'test-account'}:[];return Response.json({success:true,result})}if(url===${JSON.stringify(config.site+'/api/imessage')})return Response.json({settings:{enabled:1},jobs:[]});throw Error('Unexpected network request')}`);
  const cli = fileURLToPath(new URL('../scripts/imessage-connect-cli.mjs', import.meta.url));
  const run = mismatch => spawnSync(process.execPath, ['--import', pathToFileURL(join(fixture, 'mock.mjs')).href, cli], { cwd: fixture, encoding: 'utf8', env: { ...process.env, TEST_MISMATCH: mismatch, CLOUDFLARE_ACCOUNT_ID: '' } });
  for (const mismatch of ['database','site']) { const result=run(mismatch); assert.equal(result.status,1,result.stdout+result.stderr); assert.equal(existsSync(join(fixture,'mutations.log')),false); }
  const result=run(''); assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(readFileSync(join(fixture,'mutations.log'),'utf8').trim().split('\n').length,1);
  assert.equal(JSON.parse(readFileSync(join(fixture,'.imessage/config.json'),'utf8')).deployment.databaseId,'actual-db');
});

await check('Explicit recovery preserves confirmed parts and never sends while resolving', async () => {
  const journal = new Journal(join(directory, 'recover'), config.site), calls = [];
  const post = async body => { calls.push(body); return body.action === 'status' ? { jobs: [{ id: job.id, kind: 'result', status: 'needs_review' }] } : { updated: true }; };
  journal.put(job.id, { chatGuid: 'iMessage;+;old', parts: { text: { status: 'sending' } } });
  await resolveDelivery(job.id, 'current', config, { journal, post });
  let sends = 0;
  assert.equal(await deliver(job, config, { journal, post, bb: { text: async guid => { sends++; assert.equal(guid, config.groupChatGuid); } } }), 'sent');
  assert.equal(sends, 1);
  await assert.rejects(resolveDelivery(job.id, 'current', config, { journal, post }), /already sent/);
  await resolveDelivery(job.id, 'original', config, { journal, post });
  await deliver(job, config, { journal, post, bb: { text: async () => { sends++; } } });
  assert.equal(sends, 1);
  await resolveDelivery(job.id, 'sent', config, { journal, post });
  await deliver(job, config, { journal, post, bb: { text: async () => { sends++; } } });
  assert.equal(sends, 1); assert.equal(journal.get(job.id).resolution, 'sent');
  assert.ok(calls.some(body => body.action === 'status' && body.id === job.id));
  const emptyJournal = new Journal(join(directory, 'lost-journal'), config.site);
  await resolveDelivery(job.id, 'retry', config, { journal: emptyJournal, post });
  assert.equal(await deliver(job, config, { journal: emptyJournal, post, bb: { text: async () => { sends++; } } }), 'sent');
  assert.equal(sends, 2);
});

await check('Initial PIN rotation persists the same legacy hashes and checks schema before secrets', () => {
  const fixture = join(directory, 'pins'); mkdirSync(join(fixture, 'node_modules/wrangler/bin'), { recursive: true });
  writeFileSync(join(fixture, 'cloudflare.local.json'), JSON.stringify({ name: 'synthetic', d1_databases: [{ binding: 'DB', database_id: 'synthetic-db' }] }));
  writeFileSync(join(fixture, 'tty.mjs'), `Object.defineProperty(process.stdout,'isTTY',{value:true});`);
  writeFileSync(join(fixture, 'node_modules/wrangler/bin/wrangler.js'), `const fs=require('node:fs');const args=process.argv.slice(2);const command=args[args.indexOf('--command')+1];if(process.env.TEST_SCHEMA_FAIL&&command?.startsWith('SELECT'))process.exit(1);if(args.includes('bulk')){fs.writeFileSync('hashes.json',fs.readFileSync(0,'utf8'));console.log('private-hash-output-must-not-escape')}else if(command?.startsWith('UPDATE'))fs.writeFileSync('rotation.sql',command);`);
  const cli = fileURLToPath(new URL('../scripts/cloudflare-setup.mjs', import.meta.url));
  const run = fail => spawnSync(process.execPath, ['--import', pathToFileURL(join(fixture,'tty.mjs')).href, cli, 'pins'], { cwd: fixture, encoding:'utf8', env:{...process.env,TEST_SCHEMA_FAIL:fail?'1':''} });
  assert.equal(run(true).status,1); assert.equal(existsSync(join(fixture,'hashes.json')),false);
  const result=run(false); assert.equal(result.status,0,result.stderr); assert.ok(!result.stdout.includes('private-hash-output-must-not-escape'));
  const hashes=JSON.parse(readFileSync(join(fixture,'hashes.json'),'utf8')),sql=readFileSync(join(fixture,'rotation.sql'),'utf8');
  for(const hash of Object.values(hashes)){assert.match(hash,/^[a-f0-9]{48}:[a-f0-9]{64}$/);assert.ok(sql.includes(hash));assert.ok(!result.stdout.includes(hash));}
  assert.equal((sql.match(/auth_version=auth_version\+1/g)||[]).length,2);assert.match(sql,/DELETE FROM sessions WHERE player_id IN \('one','two'\)/);
});

await check('Real bridge API looks up old review IDs, paginates ties, and resolves only review events', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const wranglerRequire = createRequire(realpathSync(new URL('../node_modules/wrangler/package.json', import.meta.url)));
  const { build } = wranglerRequire('esbuild');
  const buildDirectory = join(root, '.test-build', 'operations'); mkdirSync(buildDirectory, { recursive: true });
  const bundle = join(buildDirectory, 'bridge.cjs');
  await build({ entryPoints: [join(root, 'lib/server/imessage.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs' });
  const { handleBridge } = createRequire(import.meta.url)(bundle);
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE notification_settings(id INTEGER PRIMARY KEY,enabled INTEGER); INSERT INTO notification_settings VALUES(1,0); CREATE TABLE notification_outbox(id TEXT PRIMARY KEY,kind TEXT,status TEXT,attempts INTEGER,detail TEXT,created_at INTEGER,lease_token TEXT,lease_until INTEGER)');
  sql.prepare('INSERT INTO notification_outbox VALUES(?,?,?,?,?,?,NULL,0)').run('old', 'result', 'needs_review', 1, '', 0);
  for (let i = 0; i < 100; i++) sql.prepare('INSERT INTO notification_outbox VALUES(?,?,?,?,?,?,NULL,0)').run('recent-'+String(i).padStart(3,'0'), 'result', i % 2 ? 'sent' : 'needs_review', 1, '', 1);
  const db = { prepare(text) { let params = []; return { bind(...args) { params = args; return this; }, async all() { return { results: sql.prepare(text).all(...params) }; }, async first() { return sql.prepare(text).get(...params) || null; }, async run() { return { meta: { changes: sql.prepare(text).run(...params).changes } }; } }; } };
  const env = { DB: db, IMESSAGE_BRIDGE_HASH: createHash('sha256').update(config.bridgeToken).digest('hex') };
  const request = body => handleBridge(new Request(config.site+'/api/imessage', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer '+config.bridgeToken }, body: JSON.stringify(body) }), env);
  try {
    assert.equal((await (await request({ action: 'status', id: 'old' })).json()).jobs[0].id, 'old');
    let cursor, ids = [];
    do { const page = await (await request({ action: 'status', status: 'needs_review', limit: 7, ...(cursor ? { cursor } : {}) })).json(); ids.push(...page.jobs.map(j => j.id)); cursor = page.nextCursor; } while (cursor);
    assert.equal(ids.length, 51); assert.equal(new Set(ids).size, 51); assert.ok(ids.includes('old'));
    for (const body of [{ action: 'status', limit: 101 }, { action: 'status', cursor: { createdAt: 0, id: '' } }, { action: 'resolve', id: 'old', status: 'leased' }]) assert.equal((await request(body)).status, 400);
    assert.equal((await (await request({ action: 'resolve', id: 'old', status: 'sent' })).json()).updated, true);
    assert.equal((await (await request({ action: 'resolve', id: 'old', status: 'skipped' })).json()).updated, false);
    assert.equal((await (await request({ action: 'retry', id: 'old' })).json()).updated, false);
    assert.equal((await (await request({ action: 'retry', id: 'recent-000' })).json()).updated, true);
    assert.equal(sql.prepare('SELECT status FROM notification_outbox WHERE id=?').get('old').status, 'sent');
  } finally { sql.close(); }
});

console.log(`\n${checks} operations regression groups passed. Synthetic transports and databases only; no real messages or account mutations.`);
rmSync(directory, { recursive: true, force: true });
