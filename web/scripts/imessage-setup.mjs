import { mkdirSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { BlueBubbles, localBlueBubblesUrl } from './bluebubbles-client.mjs';
import { privateJson, siteOrigin, cloudBridge } from './imessage-core.mjs';
import { question, hidden } from './terminal-input.mjs';
import { query, wrangler } from './cloudflare-admin.mjs';
const directory = resolve('.imessage'), path = resolve(directory, 'config.json');
function chatLabel(chat) { return [chat.displayName || 'Unnamed chat', ...(chat.participants || []).map(p => p.address)].join(' · '); }
async function choose(chats, label, optional = false) {
  console.log('\n'+label); chats.forEach((chat, index) => console.log(`${index+1}. ${chatLabel(chat)}`));
  if (!chats.length) throw new Error('Open Messages and create the required iMessage chat first, then rerun setup.');
  while (true) {
    const choice = await question(optional ? 'Chat number (Enter to skip): ' : 'Chat number: ');
    if (!choice && optional) return null;
    const index = Number(choice) - 1;
    if (Number.isInteger(index) && index >= 0 && index < chats.length) return chats[index];
    console.log('Choose a listed chat number.');
  }
}
try {
  if (process.platform !== 'darwin' || !process.stdin.isTTY) throw new Error('Run setup interactively on the Mac signed into Messages.');
  if (existsSync(resolve(directory, 'sender.lock'))) throw new Error('Stop the running sender before changing its destinations.');
  const previous = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  console.log('Open BlueBubbles Server first. This setup reads chat names/participants but sends no messages.');
  const site = siteOrigin(await question('Chess site URL'+(previous ? ' ['+previous.site+']' : '')+': ') || previous?.site || '');
  const blueBubblesUrl = localBlueBubblesUrl(await question('Local BlueBubbles URL [http://127.0.0.1:1234]: ') || 'http://127.0.0.1:1234');
  const blueBubblesPassword = await hidden('BlueBubbles server password (hidden): ');
  const bb = new BlueBubbles(blueBubblesUrl, blueBubblesPassword); await bb.ping();
  const chats = await bb.chats();
  const players = query('SELECT id,name,character FROM players ORDER BY name');
  const targets = {}, labels = [];
  for (const player of players) {
    const chosen = await choose(chats.filter(c => c.guid.startsWith('iMessage;-;')), 'Challenge messages for '+player.name+' (select their exact direct chat)', true);
    if (chosen) { targets[player.id] = chosen.guid; labels.push(player.name+' → '+chatLabel(chosen)); }
  }
  const group = await choose(chats.filter(c => c.guid.startsWith('iMessage;+;')), 'Winner/result announcements (select your existing group chat)');
  console.log('\nConfirm destinations:\n'+labels.join('\n')+'\nResults → '+chatLabel(group));
  console.log('Starting the sender later will send as the Apple account signed into Messages on this Mac.');
  if ((await question('Type SAVE to use these destinations: ')) !== 'SAVE') throw new Error('Cancelled. Nothing saved.');
  const bridgeToken = previous?.site === site ? previous.bridgeToken : randomBytes(32).toString('hex');
  const config = { site, blueBubblesUrl, blueBubblesPassword, bridgeToken, targets, groupChatGuid: group.guid };
  mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
  // Save credentials before updating Cloudflare so interrupted setup can be rerun safely.
  privateJson(path, config); chmodSync(path, 0o600);
  wrangler(['secret', 'put', 'IMESSAGE_BRIDGE_HASH'], createHash('sha256').update(bridgeToken).digest('hex')+'\n');
  // Verify the specified site is actually the Worker just configured.
  await cloudBridge(config)({ action: 'status' });
  query('UPDATE notification_settings SET enabled=1 WHERE id=1');
  console.log('Setup saved. No messages were sent. Run npm run imessage:start to send future challenges and results. Keep BlueBubbles and this sender running on the Mac.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
