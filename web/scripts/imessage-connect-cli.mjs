import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudBridge } from './imessage-core.mjs';
import { connectSavedBridge } from './imessage-connect.mjs';
import { requireConfig, wrangler, query } from './cloudflare-admin.mjs';

export async function finishConnection(config) {
  const worker = requireConfig();
  console.log(`Connecting saved destinations to Worker ${worker.name} at ${config.site}.`);
  await connectSavedBridge(config, {
    post: cloudBridge(config),
    installHash: hash => {
      // A read first confirms this Worker exists in the authenticated account,
      // preventing secret put from creating a new draft Worker by accident.
      wrangler(['secret', 'list']);
      wrangler(['secret', 'put', 'IMESSAGE_BRIDGE_HASH'], hash+'\n');
    },
    enableNotifications: () => query('UPDATE notification_settings SET enabled=1 WHERE id=1'),
    progress: message => console.log(message),
  });
  console.log('Connection verified. Notifications enabled. No messages were sent. Run npm run imessage:start to begin delivery.');
}

// Importing this function from setup must not run the reconnect CLI.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (existsSync(resolve('.cloudflare-subdomain.json')) || existsSync(resolve('.cloudflare-subdomain.lock'))) throw new Error('Finish the address change with npm run cloudflare:subdomain first.');
    const directory = resolve('.imessage'), path = resolve(directory, 'config.json');
    if (!existsSync(path)) throw new Error('No saved destinations. Run npm run imessage:setup first.');
    if (existsSync(resolve(directory, 'sender.lock'))) throw new Error('Stop the running sender before reconnecting.');
    await finishConnection(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
