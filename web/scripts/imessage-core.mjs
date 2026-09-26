import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { chatKind } from './imessage-chat-list.mjs';
import { blueBubblesFailureDetail } from './bluebubbles-client.mjs';
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
    if (!response.ok) { const error = new Error('Chess bridge returned HTTP '+response.status+'.'); error.status = response.status; throw error; }
    return response.json();
  };
}
export async function deliver(job, config, { bb, post, journal, memes }) {
  if (!job || !['challenge', 'result'].includes(job.kind) || typeof job.id !== 'string' || typeof job.text !== 'string') throw new Error('Invalid chess event.');
  const ack = (status, detail = '') => post({ action: 'ack', id: job.id, leaseToken: job.leaseToken, status, detail });
  const previous = journal.get(job.id);
  if (previous?.resolution) {
    if (!['sent', 'skipped'].includes(previous.resolution)) throw new Error('Invalid saved resolution.');
    await ack(previous.resolution, 'Operator resolved after checking Messages'); return previous.resolution;
  }
  const configuredChat = job.kind === 'result' ? config.groupChatGuid : config.targets[job.recipientId];
  const chatGuid = previous?.destinationApproved ? previous.chatGuid : configuredChat;
  if (!chatGuid) { await ack('skipped', 'No destination configured for this player'); return 'skipped'; }
  if (chatKind({ guid: chatGuid }) !== (job.kind === 'result' ? 'group' : 'direct')) { await ack('needs_review', 'Destination must be an existing iMessage or Messages auto chat of the correct type'); return 'needs_review'; }
  const state = previous || { chatGuid, parts: {} };
  if (state.useCurrentDestination && !Object.values(state.parts).some(part => part.status === 'done')) {
    state.chatGuid = chatGuid; delete state.useCurrentDestination; journal.put(job.id, state);
  }
  if ((job.attempts > 1 && !previous) || state.chatGuid !== chatGuid || (state.parts.text?.status === 'sending' || (state.meme && state.parts.image?.status === 'sending'))) {
    await ack('needs_review', 'Check Messages before retrying: previous delivery could not be confirmed'); return 'needs_review';
  }
  // Freeze a selection before the first send. Old journal entries stay text-only;
  // a retry never adds a newly enabled image to an earlier text announcement.
  if (!previous) {
    try { state.meme = memes ? await memes.choose(job) : null; }
    catch { await ack('needs_review','A selected meme could not be prepared. Check the local pool before retrying.'); return 'needs_review'; }
    journal.put(job.id,state);
  }
  if (state.parts.text?.status !== 'done') {
    const tempGuid = randomUUID(); state.parts.text = { status: 'sending', tempGuid }; journal.put(job.id, state);
    try {
      await bb.text(chatGuid, job.text, tempGuid);
    } catch (error) {
      await ack('needs_review', blueBubblesFailureDetail(error)+' Check Messages before retrying.'); return 'needs_review';
    }
    state.parts.text.status = 'done'; journal.put(job.id, state);
  }
  if (state.meme && state.parts.image?.status !== 'done') {
    let png;
    try { if (!memes || !(await memes.settings()).enabled) state.parts.image={status:'done',skipped:true};
      else png=await memes.read(state.meme);
    } catch { await ack('needs_review','Saved meme could not be read. Text is already confirmed; restore the image before retrying.'); return 'needs_review'; }
    if (png) {
      const tempGuid=randomUUID();state.parts.image={status:'sending',tempGuid};journal.put(job.id,state);
      try { await bb.image(chatGuid,png,tempGuid); }
      catch { await ack('needs_review','BlueBubbles did not confirm image delivery. Text is already confirmed. Check Messages before retrying.');return 'needs_review'; }
      state.parts.image.status='done';
    }
    journal.put(job.id,state);
  }
  // An acknowledgement failure can be retried without sending completed parts again.
  await ack('sent'); return 'sent';
}
