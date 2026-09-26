import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { question } from './terminal-input.mjs';
import { cloudBridge, privateJson } from './imessage-core.mjs';
import { changeSubdomain, dnsLabel, workerOrigin } from './cloudflare-subdomain.mjs';
import { acquireProcessLock } from './process-lock.mjs';

const pendingFile = resolve('.cloudflare-subdomain.json');
const bridgeFile = resolve('.imessage/config.json');
const locks = [];
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
function lock(path) {
  locks.push(acquireProcessLock(path));
}
function wranglerJson(args) {
  const result = spawnSync(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), ...args, '--json'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG: 'log' },
  });
  // In particular, never print auth-token stdout or stderr.
  if (result.status !== 0) throw new Error('Cloudflare login could not be read. Run npx wrangler login, then retry.');
  try { return JSON.parse(result.stdout); }
  catch { throw new Error('Wrangler returned unreadable JSON. Check your installed project dependencies.'); }
}

try {
  if (!process.stdin.isTTY) throw new Error('Run this interactively in your Mac Terminal.');
  const to = dnsLabel(process.argv[2] || 'rivalchess');
  if (process.argv.length > 3) throw new Error('Use npm run cloudflare:subdomain -- rivalchess');
  const config = readJson(resolve('cloudflare.local.json'));
  const databaseId = config.d1_databases?.find(b => b.binding === 'DB')?.database_id;
  if (!databaseId || databaseId === '00000000-0000-4000-8000-000000000000') throw new Error('Use your existing deployed web folder with its real database configuration.');
  dnsLabel(config.name);
  lock(resolve('.cloudflare-subdomain.lock'));
  if (existsSync(resolve('.imessage'))) lock(resolve('.imessage/sender.lock'));
  const identity = wranglerJson(['whoami']);
  const accountId = config.account_id || process.env.CLOUDFLARE_ACCOUNT_ID || (identity.accounts?.length === 1 ? identity.accounts[0].id : null);
  if (!accountId || !identity.accounts?.some(a => a.id === accountId)) throw new Error('Select the correct account_id in cloudflare.local.json; more than one account or an account mismatch was found.');
  if (!/^[a-f0-9]{32}$/.test(accountId)) throw new Error('Invalid Cloudflare account ID.');
  const credentials = wranglerJson(['auth', 'token']);
  if (!['oauth', 'api_token'].includes(credentials.type) || !credentials.token) throw new Error('Use Wrangler login or a scoped Cloudflare API token.');
  const api = async (path, options = {}) => {
    if (!path.startsWith(`/accounts/${accountId}/workers/`)) throw new Error('Unexpected Cloudflare API path.');
    let response;
    try {
      response = await fetch('https://api.cloudflare.com/client/v4'+path, {
        method: options.method || 'GET', redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { Authorization: 'Bearer '+credentials.token, 'Content-Type': 'application/json' },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch { throw new Error('Cloudflare request was interrupted. Rerun the same command to check and resume safely.'); }
    let data;
    try { data = await response.json(); } catch { throw new Error('Cloudflare returned an unreadable response. Rerun the same command.'); }
    if (!response.ok || data.success !== true) {
      const codes = (data.errors || []).map(e => e.code).filter(Number.isInteger);
      const error = new Error(codes.includes(10031) ? 'That subdomain is taken. Try another name.' : `Cloudflare rejected the request (HTTP ${response.status}, codes ${codes.join(', ') || 'unknown'}). Check permissions; you can also change Your subdomain in Workers & Pages and rerun this command.`);
      error.rejected = response.status < 500 && data.success === false;
      throw error;
    }
    return options.page ? data : data.result;
  };
  const from = dnsLabel((await api(`/accounts/${accountId}/workers/subdomain`)).subdomain);
  let plan;
  if (existsSync(pendingFile)) {
    plan = readJson(pendingFile);
    if (plan.accountId !== accountId || plan.worker !== config.name || plan.to !== to || plan.databaseId !== databaseId) throw new Error('An unfinished address change exists. Rerun with its original name and configuration.');
    console.log('Resuming the saved address change.');
  } else {
    if (from === to) {
      console.log('Your account already uses '+workerOrigin(config.name, to)+'.');
      if (existsSync(bridgeFile) && readJson(bridgeFile).site !== workerOrigin(config.name, to)) throw new Error('Your saved bridge uses another address. Run imessage:setup to review its site and destinations.');
      process.exitCode = 0;
    } else {
      const workers = [];
      for (let page = 1; ; page++) {
        const data = await api(`/accounts/${accountId}/workers/workers?page=${page}&per_page=100`, { page: true });
        if (!Array.isArray(data.result)) throw new Error('Could not list the Workers affected by this change.');
        workers.push(...data.result);
        if (data.result.length < 100 || page >= data.result_info?.total_pages) break;
        if (page >= 100) throw new Error('The account has too many Workers to preview safely. Use the Cloudflare dashboard.');
      }
      if (!workers.some(w => w.name === config.name)) throw new Error('The configured chess Worker was not found in this account.');
      console.log('\nThis replaces the public account subdomain for ALL Workers. Finish active games first.');
      for (const worker of workers) console.log(workerOrigin(worker.name, from)+' → '+workerOrigin(worker.name, to));
      console.log('Old workers.dev links will need replacing. Custom domains are unchanged.');
      if ((await question('Type CHANGE to apply these addresses: ')) !== 'CHANGE') throw new Error('Cancelled. No address or saved settings changed.');
      plan = { accountId, worker: config.name, from, to, databaseId };
    }
  }
  if (plan) {
    const site = await changeSubdomain(plan, {
      api, savePending: value => privateJson(pendingFile, value),
      clearPending: () => { if (existsSync(pendingFile)) unlinkSync(pendingFile); },
      loadBridge: () => existsSync(bridgeFile) ? readJson(bridgeFile) : null,
      saveBridge: value => privateJson(bridgeFile, value),
      verifyBridge: async value => {
        const status = await cloudBridge(value)({ action: 'status' });
        if (![0, 1].includes(status.settings?.enabled) || !Array.isArray(status.jobs)) throw new Error('The new address did not return a valid bridge status. Rerun this command to resume.');
      },
    });
    console.log('\nAddress updated: '+site);
    console.log('The same Worker, database, PINs, and records are retained.');
    if (existsSync(bridgeFile)) console.log('Saved iMessage URL updated and connection checked. No messages were sent. Run npm run imessage:start.');
    console.log('Players and spectators should open the new link and enter their existing PINs.');
  }
} catch (error) {
  console.error(error.message);
  if (existsSync(pendingFile)) console.error('Recovery details are saved. If DNS is still updating, wait a minute and rerun the same command.');
  process.exitCode = 1;
} finally {
  for (const release of locks.reverse()) release();
}
