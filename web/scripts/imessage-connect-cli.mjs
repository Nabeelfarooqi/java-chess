import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudBridge, privateJson } from './imessage-core.mjs';
import { connectSavedBridge } from './imessage-connect.mjs';
import { requireConfig, wrangler, query } from './cloudflare-admin.mjs';
import { verifyDeploymentIdentity } from './cloudflare-identity.mjs';
import { acquireProcessLock } from './process-lock.mjs';

export async function finishConnection(config) {
  const worker = requireConfig();
  const whoami = JSON.parse(wrangler(['whoami', '--json']));
  const credentials = JSON.parse(wrangler(['auth', 'token', '--json']));
  if (!['oauth', 'api_token'].includes(credentials.type) || !credentials.token) throw new Error('Use Wrangler login or a scoped API token.');
  const identity = await verifyDeploymentIdentity(worker, config, {
    whoami: async () => whoami, accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    api: async path => {
      let response, data;
      try {
        response = await fetch('https://api.cloudflare.com/client/v4'+path, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Authorization: 'Bearer '+credentials.token } });
        data = await response.json();
      } catch { throw new Error('Could not verify deployment identity. Nothing changed.'); }
      if (!response.ok || data.success !== true) throw new Error('Cloudflare did not confirm deployment identity. Check account access. Nothing changed.');
      return data.result;
    },
  });
  const target = { config: worker, accountId: identity.accountId };
  console.log(`Connecting saved destinations to Worker ${worker.name} at ${config.site}.`);
  await connectSavedBridge(config, {
    post: cloudBridge(config),
    installHash: hash => {
      // A read first confirms this Worker exists in the authenticated account,
      // preventing secret put from creating a new draft Worker by accident.
      wrangler(['secret', 'list'], undefined, target);
      wrangler(['secret', 'put', 'IMESSAGE_BRIDGE_HASH'], hash+'\n', target);
    },
    enableNotifications: () => query('UPDATE notification_settings SET enabled=1 WHERE id=1', target),
    progress: message => console.log(message),
  });
  privateJson(resolve('.imessage/config.json'), { ...config, deployment: identity });
  console.log('Connection verified. Notifications enabled. No messages were sent. Run npm run imessage:start to begin delivery.');
}

// Importing this function from setup must not run the reconnect CLI.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let release;
  try {
    if (existsSync(resolve('.cloudflare-subdomain.json')) || existsSync(resolve('.cloudflare-subdomain.lock'))) throw new Error('Finish the address change with npm run cloudflare:subdomain first.');
    const directory = resolve('.imessage'), path = resolve(directory, 'config.json');
    if (!existsSync(path)) throw new Error('No saved destinations. Run npm run imessage:setup first.');
    release = acquireProcessLock(resolve(directory, 'sender.lock'));
    await finishConnection(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { release?.(); }
}
