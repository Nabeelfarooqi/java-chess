import { mkdirSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { BlueBubbles, localBlueBubblesUrl } from './bluebubbles-client.mjs';
import { chatKind, chatSummary, chatLabel, filterChats } from './imessage-chat-list.mjs';
import { privateJson, siteOrigin } from './imessage-core.mjs';
import { question, hidden } from './terminal-input.mjs';
import { query } from './cloudflare-admin.mjs';
import { finishConnection } from './imessage-connect-cli.mjs';
import { acquireProcessLock } from './process-lock.mjs';
const directory = resolve('.imessage'), path = resolve(directory, 'config.json');
async function choose(chats, label, optional = false) {
  console.log('\n'+label);
  if (!chats.length) throw new Error('BlueBubbles supplied no selectable chats for this destination. Run npm run imessage:chats to check what the API can see. Existing Messages chats do not need to be recreated. Nothing saved.');
  while (true) {
    const search = await question('Search chat name or phone/email (Enter lists all'+(optional ? ', SKIP skips this player' : '')+'): ');
    if (optional && search.toUpperCase() === 'SKIP') return null;
    const matches = filterChats(chats, search);
    if (!matches.length) { console.log('No matches. Direct chats may have no contact name; try their phone number/email from Contacts.'); continue; }
    matches.forEach((chat, index) => console.log(`${index+1}. ${chatLabel(chat)}`));
    while (true) {
      const choice = await question(optional ? 'Chat number (Enter to skip, / to search again): ' : 'Chat number (/ to search again): ');
      if (!choice && optional) return null;
      if (choice === '/') break;
      const index = Number(choice) - 1;
      if (Number.isInteger(index) && index >= 0 && index < matches.length) return matches[index];
      console.log('Choose a listed chat number.');
    }
  }
}
let release;
try {
  if (process.platform !== 'darwin' || !process.stdin.isTTY) throw new Error('Run setup interactively on the Mac signed into Messages.');
  if (existsSync(resolve('.cloudflare-subdomain.json')) || existsSync(resolve('.cloudflare-subdomain.lock'))) throw new Error('Finish the address change with npm run cloudflare:subdomain first.');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  release = acquireProcessLock(resolve(directory, 'sender.lock'));
  const previous = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  console.log('Open BlueBubbles Server first. This setup reads chat names/participants but sends no messages.');
  const site = siteOrigin(await question('Chess site URL'+(previous ? ' ['+previous.site+']' : '')+': ') || previous?.site || '');
  const blueBubblesUrl = localBlueBubblesUrl(await question('Local BlueBubbles URL [http://127.0.0.1:1234]: ') || 'http://127.0.0.1:1234');
  const blueBubblesPassword = await hidden('BlueBubbles server password (hidden): ');
  const bb = new BlueBubbles(blueBubblesUrl, blueBubblesPassword); await bb.ping();
  const chats = await bb.chats();
  console.log(chatSummary(chats));
  console.log('Direct chats may appear as phone numbers or emails rather than Contacts names. Check the participant address before choosing.');
  console.log('Messages auto chats use the existing conversation\'s service. Choose your blue-bubble conversations and verify group members; duplicate names have separate Chat IDs.');
  const players = query('SELECT id,name,character FROM players ORDER BY name');
  const targets = {}, labels = [];
  for (const player of players) {
    const contactName = player.id === 'one' ? 'Nabeel' : player.id === 'two' ? 'Saif' : player.character === 'gud' ? 'Usman' : player.name;
    const chosen = await choose(chats.filter(c => chatKind(c) === 'direct'), 'Private challenge links for '+player.name+' (select '+contactName+"'s direct chat)", true);
    if (chosen) { targets[player.id] = chosen.guid; labels.push(player.name+' → '+chatLabel(chosen)); }
  }
  const group = await choose(chats.filter(c => chatKind(c) === 'group'), 'Results and updated head-to-head records (select FRQ and verify its members)');
  console.log('\nConfirm destinations:\n'+labels.join('\n')+'\nResults → '+chatLabel(group));
  console.log('Starting the sender later will send as the Apple account signed into Messages on this Mac.');
  if ((await question('Type SAVE to use these destinations: ')) !== 'SAVE') throw new Error('Cancelled. Nothing saved.');
  const bridgeToken = previous?.site === site ? previous.bridgeToken : randomBytes(32).toString('hex');
  const config = { site, blueBubblesUrl, blueBubblesPassword, bridgeToken, targets, groupChatGuid: group.guid,
    ...(previous?.site === site && previous.journalSite ? { journalSite: previous.journalSite } : {}),
    ...(previous?.site === site && previous.deployment ? { deployment: previous.deployment } : {}) };
  mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
  // Save credentials before updating Cloudflare so interrupted setup can be rerun safely.
  privateJson(path, config); chmodSync(path, 0o600);
  console.log('Destinations saved on this Mac. If connection verification fails, resume with npm run imessage:connect.');
  await finishConnection(config);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { release?.(); }
