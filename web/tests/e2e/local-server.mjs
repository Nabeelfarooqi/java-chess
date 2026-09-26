// Child process owned by the Playwright worker. Never reads cloudflare.local.json.
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pbkdf2Sync, randomUUID } from 'node:crypto';
import { startFaultProxy } from './fault-proxy.mjs';

if (!process.send) throw new Error('Start this local fixture through the Playwright worker.');
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'rival-playwright-'));
const configPath = join(directory, 'wrangler.json');
const statePath = join(directory, 'state');
let server;
let faultProxy;
let closing;

function wrangler(args) {
  const result = spawnSync(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'),
    ...args, '--local', '--config', configPath, '--persist-to', statePath], {
    cwd: directory, env: process.env, encoding: 'utf8', timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024, windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`Local fixture command failed: ${result.error?.message || result.stderr || result.stdout}`);
}

function stop() {
  if (closing) return closing;
  closing = (async () => {
    if (faultProxy) await faultProxy.stop();
    if (server) await server.stop();
    // Only remove the exact unique directory allocated by this fixture.
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep) || !basename(directory).startsWith('rival-playwright-')) {
      throw new Error('Refusing to remove a directory outside the fixture temp root.');
    }
    await rm(directory, { recursive: true, force: true });
  })();
  return closing;
}

process.on('message', message => {
  if (message?.type === 'stop') void stop().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
  if (message?.type === 'chunk-outage' && faultProxy) {
    process.send({ type: 'chunk-outage-set', id: message.id, ...faultProxy.setChunkOutage(message.enabled) });
  }
});
process.on('disconnect', () => { void stop().finally(() => process.exit(0)); });

try {
  const builtPath = join(root, 'dist/server/wrangler.json');
  const built = JSON.parse(await readFile(builtPath, 'utf8'));
  const entry = resolve(dirname(builtPath), built.main);
  const assets = resolve(dirname(builtPath), built.assets?.directory || '../client');
  await access(entry);
  await access(assets);
  // Copy only build/runtime fields. Never inherit account IDs, remote bindings,
  // routes, saved environment variables, bridge secrets, or production D1 IDs.
  const config = {
    name: 'rival-browser-fixture', main: entry, no_bundle: true,
    compatibility_date: built.compatibility_date,
    compatibility_flags: built.compatibility_flags || ['nodejs_compat'],
    rules: built.rules || [{ type: 'ESModule', globs: ['**/*.js', '**/*.mjs'] }],
    assets: { directory: assets },
    workers_dev: false, send_metrics: false,
    durable_objects: { bindings: [{ name: 'LIVE_PLAYERS', class_name: 'PlayerLive' }] },
    migrations: [{ tag: 'browser-fixture-v1', new_sqlite_classes: ['PlayerLive'] }],
    d1_databases: [{ binding: 'DB', database_name: 'rival-browser-fixture',
      database_id: randomUUID(), migrations_dir: join(root, 'drizzle'), remote: false }],
  };
  await writeFile(configPath, JSON.stringify(config));
  const emptyEnv = join(directory, '.dev.vars');
  await writeFile(emptyEnv, '# Isolated browser fixture; no deployed secrets.\n');
  wrangler(['d1', 'migrations', 'apply', 'DB']);
  // Public synthetic fixture codes, not credentials for any deployed account.
  const salt = 'browser-fixture-only';
  const hash = pin => pbkdf2Sync(pin, salt, 100000, 32, 'sha256').toString('hex');
  const seedPath = join(directory, 'seed.sql');
  await writeFile(seedPath, `UPDATE pin_settings SET salt='${salt}' WHERE id=1;
UPDATE players SET name='Browser One',pin_hash='${hash('100000000001')}' WHERE id='one';
UPDATE players SET name='Browser Two',pin_hash='${hash('100000000002')}' WHERE id='two';
UPDATE notification_settings SET enabled=0 WHERE id=1;\n`);
  wrangler(['d1', 'execute', 'DB', '--file', seedPath]);
  const { unstable_dev } = await import('wrangler');
  server = await unstable_dev(entry, {
    config: configPath, envFiles: [emptyEnv], local: true, ip: '127.0.0.1', port: 0,
    localProtocol: 'http', bundle: false, persistTo: statePath, logLevel: 'error',
    experimental: { forceLocal: true, disableDevRegistry: true,
      disableExperimentalWarning: true, showInteractiveDevSession: false,
      enableContainers: false, watch: false },
  });
  const origin = `http://127.0.0.1:${server.port}`;
  const response = await fetch(origin + '/api/room', { signal: AbortSignal.timeout(10_000) });
  if (response.status !== 401) throw new Error(`Expected locked local room, got ${response.status}`);
  faultProxy = await startFaultProxy(origin);
  process.send({ type: 'ready', origin, faultOrigin: faultProxy.origin });
} catch (error) {
  process.send?.({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  await stop().catch(() => {});
  process.exit(1);
}
