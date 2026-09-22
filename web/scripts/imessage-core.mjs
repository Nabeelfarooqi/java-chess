import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
export function siteOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use your HTTPS chess site address without a path or query.');
  return url.origin;
}
export function privateJson(path, data) {
  const temporary = path+'.tmp'; writeFileSync(temporary, JSON.stringify(data, null, 2)+'\n', { mode: 0o600 }); renameSync(temporary, path);
}
export class Journal {
  constructor(directory, site) { this.directory = directory; this.site = site; mkdirSync(directory, { recursive: true, mode: 0o700 }); }
  path(id) { return resolve(this.directory, createHash('sha256').update(this.site+'|'+id).digest('hex')+'.json'); }
  get(id) { const path = this.path(id); return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null; }
  put(id, state) { privateJson(this.path(id), state); }
}
export function cloudBridge(config, fetcher = fetch) {
  const site = siteOrigin(config.site);
  return async body => {
    let response;
    try { response = await fetcher(site+'/api/imessage', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer '+config.bridgeToken }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) }); }
    catch { throw new Error('The chess site could not be reached. Events stay queued.'); }
    if (!response.ok) throw new Error('Chess bridge returned HTTP '+response.status+'.');
    return response.json();
  };
}
export async function deliver(job, config, { bb, post, render, journal }) {
  if (!job || !['challenge', 'result'].includes(job.kind) || typeof job.id !== 'string' || typeof job.text !== 'string') throw new Error('Invalid chess event.');
  const ack = (status, detail = '') => post({ action: 'ack', id: job.id, leaseToken: job.leaseToken, status, detail });
  const chatGuid = job.kind === 'result' ? config.groupChatGuid : config.targets[job.recipientId];
  if (!chatGuid) { await ack('skipped', 'No destination configured for this player'); return 'skipped'; }
  if (!chatGuid.startsWith(job.kind === 'result' ? 'iMessage;+;' : 'iMessage;-;')) { await ack('needs_review', 'Destination must be an existing iMessage group or direct chat'); return 'needs_review'; }
  const previous = journal.get(job.id);
  const state = previous || { chatGuid, parts: {} };
  if ((job.attempts > 1 && !previous) || state.chatGuid !== chatGuid || Object.values(state.parts).some(part => part.status === 'sending')) {
    await ack('needs_review', 'Check Messages before retrying: previous delivery could not be confirmed'); return 'needs_review';
  }
  let png;
  if (job.kind === 'result' && state.parts.image?.status !== 'done') {
    try { png = await render(job.result); } catch { await ack('needs_review', 'Could not create the winner image'); return 'needs_review'; }
  }
  for (const part of job.kind === 'result' ? ['text', 'image'] : ['text']) {
    if (state.parts[part]?.status === 'done') continue;
    const tempGuid = randomUUID(); state.parts[part] = { status: 'sending', tempGuid }; journal.put(job.id, state);
    try {
      if (part === 'text') await bb.text(chatGuid, job.text, tempGuid);
      else await bb.image(chatGuid, png, tempGuid);
    } catch {
      await ack('needs_review', 'BlueBubbles did not confirm '+part+' delivery. Check Messages before retrying.'); return 'needs_review';
    }
    state.parts[part].status = 'done'; journal.put(job.id, state);
  }
  // An acknowledgement failure can be retried without sending completed parts again.
  await ack('sent'); return 'sent';
}
