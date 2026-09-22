import { readFileSync, existsSync, openSync, writeFileSync, closeSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { BlueBubbles } from './bluebubbles-client.mjs';
import { Journal, cloudBridge, deliver } from './imessage-core.mjs';
import { winnerCard } from './winner-card.mjs';
import { question } from './terminal-input.mjs';
const directory = resolve('.imessage'), configFile = resolve(directory, 'config.json');
let lockHeld = false;
const lockPath = resolve(directory, 'sender.lock');
try {
  if (!existsSync(configFile)) throw new Error('Run npm run imessage:setup first.');
  const config = JSON.parse(readFileSync(configFile, 'utf8')), post = cloudBridge(config);
  const journal = new Journal(resolve(directory, 'journal'), config.site);
  const mode = process.argv[2] || 'start';
  if (mode === 'status') {
    const status = await post({ action: 'status' }); console.log('Notifications '+(status.settings?.enabled ? 'enabled' : 'disabled')); console.table(status.jobs);
  } else if (mode === 'retry') {
    const id = process.argv[3]; if (!id) throw new Error('Use npm run imessage:retry -- JOB_ID from imessage:status.');
    if (existsSync(lockPath)) throw new Error('Stop the running sender before reviewing/retrying a message.');
    console.log('Check the destination in Messages first. Retrying an unconfirmed send can duplicate it.');
    if ((await question('Type RETRY to resend only unconfirmed parts: ')) !== 'RETRY') throw new Error('Cancelled.');
    const status = await post({ action: 'status' });
    if (!status.jobs.some(j => j.id === id && j.status === 'needs_review')) throw new Error('That event is not awaiting review.');
    const state = journal.get(id);
    if (state) { for (const part of Object.keys(state.parts)) if (state.parts[part].status !== 'done') delete state.parts[part]; journal.put(id, state); }
    const result = await post({ action: 'retry', id }); console.log(result.updated ? 'Queued. Start the sender again.' : 'Event changed; check status.');
  } else if (mode === 'start') {
    if (existsSync(lockPath)) {
      const pid = Number(readFileSync(lockPath, 'utf8'));
      let running = false; try { process.kill(pid, 0); running = true; } catch (error) { if (error.code !== 'ESRCH') running = true; }
      if (running) throw new Error('An iMessage sender is already running.');
      unlinkSync(lockPath);
    }
    const fd = openSync(lockPath, 'wx', 0o600); writeFileSync(fd, String(process.pid)); closeSync(fd); lockHeld = true;
    const bb = new BlueBubbles(config.blueBubblesUrl, config.blueBubblesPassword);
    let stopping = false; for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { stopping = true; });
    const awake = process.platform === 'darwin' ? spawn('/usr/bin/caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' }) : null;
    console.log('iMessage sender running. New challenges go to the configured DMs; results and PNG cards go to the selected group. Ctrl+C stops it. Keep the Mac online and awake.');
    let reported = '';
    try { while (!stopping) {
      try {
        await bb.ping(); // Do not claim jobs while the Mac's message server is offline.
        const { job } = await post({ action: 'claim' });
        if (job) console.log(new Date().toLocaleTimeString(), job.kind, await deliver(job, config, { bb, post, render: winnerCard, journal }), job.id);
        reported = '';
      } catch (error) { if (reported !== error.message) console.error(error.message); reported = error.message; }
      for (let second = 0; second < 10 && !stopping; second++) await new Promise(resolve => setTimeout(resolve, 1000));
    }} finally { awake?.kill(); }
  } else throw new Error('Use start, status, or retry.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { if (lockHeld) try { unlinkSync(lockPath); } catch {} }
