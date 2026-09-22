import { BlueBubbles, localBlueBubblesUrl } from './bluebubbles-client.mjs';
import { chatDiagnostics } from './imessage-chat-list.mjs';
import { question, hidden } from './terminal-input.mjs';

try {
  if (process.platform !== 'darwin' || !process.stdin.isTTY) throw new Error('Run this interactively on the Mac running BlueBubbles.');
  console.log('Read-only chat check. No messages, Cloudflare changes, or saved credentials.');
  const url = localBlueBubblesUrl(await question('Local BlueBubbles URL [http://127.0.0.1:1234]: ') || 'http://127.0.0.1:1234');
  const password = await hidden('BlueBubbles server password (hidden): ');
  const bb = new BlueBubbles(url, password);
  await bb.ping();
  console.log(chatDiagnostics(await bb.chats()));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
