import { BlueBubbles, localBlueBubblesUrl } from './bluebubbles-client.mjs';
import { chatDiagnostics, filterChats, chatKind } from './imessage-chat-list.mjs';
import { groupActivityReport } from './imessage-group-activity.mjs';
import { question, hidden } from './terminal-input.mjs';

try {
  if (process.platform !== 'darwin' || !process.stdin.isTTY) throw new Error('Run this interactively on the Mac running BlueBubbles.');
  console.log('Read-only chat check. No messages, Cloudflare changes, or saved credentials.');
  const url = localBlueBubblesUrl(await question('Local BlueBubbles URL [http://127.0.0.1:1234]: ') || 'http://127.0.0.1:1234');
  const password = await hidden('BlueBubbles server password (hidden): ');
  const bb = new BlueBubbles(url, password);
  await bb.ping();
  const chats = await bb.chats();
  if (process.argv.includes('--groups')) {
    const search = await question('Group name to check [FRQ]: ') || 'FRQ';
    const matches = filterChats(chats.filter(chat => chatKind(chat) === 'group'), search);
    console.log('Reading the newest message timestamp for matching groups. Message content is discarded.');
    console.log(await groupActivityReport(matches, bb));
  } else console.log(chatDiagnostics(chats));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
