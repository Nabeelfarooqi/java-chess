// Exercise the actual CLI with an isolated fake Wrangler and mock network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = mkdtempSync(join(tmpdir(), 'rival-subdomain-cli-'));
const cli = fileURLToPath(new URL('../scripts/cloudflare-subdomain-cli.mjs', import.meta.url));
const write = (path, value) => writeFileSync(join(directory, path), typeof value === 'string' ? value : JSON.stringify(value));
const read = path => JSON.parse(readFileSync(join(directory, path), 'utf8'));
try {
  mkdirSync(join(directory, 'node_modules/wrangler/bin'), { recursive: true });
  mkdirSync(join(directory, '.imessage'));
  write('cloudflare.local.json', { name: 'rival-room', d1_databases: [{ binding: 'DB', database_id: 'existing-db' }] });
  write('.imessage/config.json', { site: 'https://rival-room.old-name.workers.dev', bridgeToken: 'fake-bridge-token', groupChatGuid: 'any;+;group', targets: { saif: 'any;-;saif' } });
  write('remote.json', { subdomain: 'old-name', puts: 0 });
  write('node_modules/wrangler/bin/wrangler.js', `
    if (process.env.TEST_AUTH_FAILURE) { console.error('fake-secret-must-not-leak'); process.exit(1); }
    console.log(JSON.stringify(process.argv.includes('whoami') ? { loggedIn: true, accounts: [{id: 'a'.repeat(32)}] } : {type: 'oauth', token: 'fake-cloudflare-token'}));
  `);
  write('mock.mjs', `
    import {readFileSync,writeFileSync} from 'node:fs';
    Object.defineProperty(process.stdin, 'isTTY', {value: true});
    globalThis.fetch = async (url, options) => {
      const state = JSON.parse(readFileSync('remote.json'));
      let result;
      if (url.startsWith('https://api.cloudflare.com/client/v4/')) {
        if (options.headers.Authorization !== 'Bearer fake-cloudflare-token') throw Error('wrong CF auth');
        const path = new URL(url).pathname;
        if (path.endsWith('/subdomain')) {
          if (options.method === 'PUT') { state.subdomain = JSON.parse(options.body).subdomain; state.puts++; writeFileSync('remote.json', JSON.stringify(state)); }
          result = {subdomain: state.subdomain};
        } else if (path.endsWith('/settings')) result = {bindings: [{type:'d1',name:'DB',id:'existing-db'}]};
        else if (path.endsWith('/workers/workers')) result = [{name:'rival-room'},{name:'other-app'}];
        else throw Error('Unexpected API path');
        return Response.json({success:true,result});
      }
      if (url === 'https://rival-room.rivalchess.workers.dev/api/imessage') {
        if (process.env.TEST_DNS_FAILURE) throw Error('DNS');
        if (options.headers.Authorization !== 'Bearer fake-bridge-token' || JSON.parse(options.body).action !== 'status') throw Error('wrong bridge auth/action');
        return Response.json({settings:{enabled:1},jobs:[]});
      }
      throw Error('Unexpected network request');
    };
  `);
  const run = (input, env = {}) => {
    const result = spawnSync(process.execPath, ['--import', join(directory, 'mock.mjs'), cli, 'rivalchess'], { cwd: directory, encoding: 'utf8', input, env: { ...process.env, ...env, CLOUDFLARE_ACCOUNT_ID: '' } });
    for (const secret of ['fake-bridge-token', 'fake-cloudflare-token', 'fake-secret-must-not-leak']) assert.ok(!(result.stdout+result.stderr).includes(secret));
    return result;
  };
  assert.equal(run('', { TEST_AUTH_FAILURE: '1' }).status, 1);
  assert.equal(read('remote.json').puts, 0);
  const cancelled = run('NO\n');
  assert.equal(cancelled.status, 1); assert.match(cancelled.stdout, /other-app\.rivalchess\.workers\.dev/);
  assert.equal(read('remote.json').puts, 0); assert.ok(!existsSync(join(directory, '.cloudflare-subdomain.json')));
  const waiting = run('CHANGE\n', { TEST_DNS_FAILURE: '1' });
  assert.equal(waiting.status, 1); assert.equal(read('remote.json').puts, 1);
  assert.ok(existsSync(join(directory, '.cloudflare-subdomain.json')));
  assert.equal(read('.imessage/config.json').journalSite, 'https://rival-room.old-name.workers.dev');
  assert.equal(statSync(join(directory, '.imessage/config.json')).mode & 0o777, 0o600);
  const resumed = run('');
  assert.equal(resumed.status, 0, resumed.stderr); assert.equal(read('remote.json').puts, 1);
  assert.match(resumed.stdout, /Address updated/); assert.ok(!existsSync(join(directory, '.cloudflare-subdomain.json')));
  assert.ok(!existsSync(join(directory, '.imessage/sender.lock')));
  assert.equal(read('cloudflare.local.json').name, 'rival-room');
  assert.equal(run('').status, 0); assert.equal(read('remote.json').puts, 1);
  console.log('PASS Terminal flow: private auth, cancellation, affected URLs, DNS failure, recovery, private saves, idempotence. No external requests.');
} finally { rmSync(directory, { recursive: true, force: true }); }
