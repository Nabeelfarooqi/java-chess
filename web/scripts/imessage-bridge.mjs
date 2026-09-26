import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { MemePool } from './meme-pool.mjs';
import { BlueBubbles } from './bluebubbles-client.mjs';
import { Journal, cloudBridge, deliver } from './imessage-core.mjs';
import { question } from './terminal-input.mjs';
import { acquireProcessLock } from './process-lock.mjs';
import { resolveDelivery } from './imessage-recovery.mjs';
const directory = resolve('.imessage'), configFile = resolve(directory, 'config.json');
let release;
const lockPath = resolve(directory, 'sender.lock');
try {
  if (existsSync(resolve('.cloudflare-subdomain.json')) || existsSync(resolve('.cloudflare-subdomain.lock'))) throw new Error('Finish the address change with npm run cloudflare:subdomain before starting or reviewing the sender.');
  if (!existsSync(configFile)) throw new Error('Run npm run imessage:setup first.');
  const mode = process.argv[2] || 'start';
  if (mode !== 'status') release = acquireProcessLock(lockPath);
  const config = JSON.parse(readFileSync(configFile, 'utf8')), post = cloudBridge(config);
  const memes = new MemePool(resolve(directory,'memes'));
  const journal = new Journal(resolve(directory, 'journal'), config.journalSite || config.site);
  if (mode === 'status') {
    const id = process.argv[3];
    const status = await post({ action: 'status', ...(id && id !== '--review' ? { id } : id === '--review' ? { status: 'needs_review' } : {}) });
    console.log('Notifications '+(status.settings?.enabled ? 'enabled' : 'disabled')); console.table(status.jobs);
    if (id === '--review') {
      let cursor = status.nextCursor;
      while (cursor) { const page = await post({ action: 'status', status: 'needs_review', cursor }); console.table(page.jobs); cursor = page.nextCursor; }
    } else console.log('Use imessage:status -- --review for all events needing review, or -- JOB_ID for one older event.');
  } else if (mode === 'retry') {
    const id = process.argv[3]; if (!id) throw new Error('Use npm run imessage:retry -- JOB_ID from imessage:status.');
    const choice = process.argv[4] || 'retry';
    if (!['retry', 'original', 'current', 'sent', 'discard'].includes(choice)) throw new Error('Use JOB_ID followed by retry, original, current, sent, or discard.');
    console.log('Check the destination in Messages first. Retrying an unconfirmed send can duplicate it.');
    console.log('Resolution: '+choice+'. Original keeps the recorded chat; current deliberately uses the configured destination. Sent/discard sends nothing.');
    if ((await question('Type '+choice.toUpperCase()+' to confirm this resolution: ')) !== choice.toUpperCase()) throw new Error('Cancelled.');
    const result = await resolveDelivery(id, choice, config, { post, journal });
    console.log(result.updated ? (['sent','discard'].includes(choice) ? 'Resolved. No message was sent.' : 'Queued. Start the sender again.') : 'Event changed; check status.');
  } else if (mode === 'start') {
    const bb = new BlueBubbles(config.blueBubblesUrl, config.blueBubblesPassword);
    let stopping = false; for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { stopping = true; });
    const awake = process.platform === 'darwin' ? spawn('/usr/bin/caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' }) : null;
    console.log('iMessage sender running. Challenge links go privately to the configured DMs; text results and head-to-head records go to the selected group. Images follow your local meme-pool setting (imessage:memes). Ctrl+C stops it. Keep the Mac online and awake.');
    let reported = '';
    try { while (!stopping) {
      try {
        await bb.ping(); // Do not claim jobs while the Mac's message server is offline.
        const { job } = await post({ action: 'claim' });
        if (job) {
          const deliveryPost = async body => {
            if (body.action === 'ack' && body.status === 'needs_review') console.error(body.detail);
            return post(body);
          };
          console.log(new Date().toLocaleTimeString(), job.kind, await deliver(job, config, { bb, post: deliveryPost, journal, memes }), job.id);
        }
        reported = '';
      } catch (error) { if (reported !== error.message) console.error(error.message); reported = error.message; }
      for (let second = 0; second < 10 && !stopping; second++) await new Promise(resolve => setTimeout(resolve, 1000));
    }} finally { awake?.kill(); }
  } else throw new Error('Use start, status, or retry.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { release?.(); }
