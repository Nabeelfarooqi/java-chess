import { chatKind } from './imessage-chat-list.mjs';

/** Called only while holding sender.lock, after an explicit operator choice. */
export async function resolveDelivery(id, choice, config, { post, journal }) {
  if (!['retry', 'original', 'current', 'sent', 'discard'].includes(choice)) throw new Error('Choose retry, original, current, sent, or discard.');
  const status = await post({ action: 'status', id });
  const job = status.jobs?.find(j => j.id === id && j.status === 'needs_review');
  if (!job) throw new Error('That event is not awaiting review.');
  const prior = journal.get(id);
  if (['sent', 'discard'].includes(choice)) {
    // Journal first: an interrupted server acknowledgement must never cause a
    // later claim to send a message the operator already resolved.
    journal.put(id, { ...(prior || { parts: {} }), resolution: choice === 'sent' ? 'sent' : 'skipped' });
    return post({ action: 'resolve', id, status: choice === 'sent' ? 'sent' : 'skipped' });
  }
  if (prior?.resolution) throw new Error('This event was resolved locally. Complete the sent/discard resolution first.');
  const state = structuredClone(prior || { parts: {} });
  if (!prior) state.useCurrentDestination = true;
  if (choice === 'original') {
    if (chatKind({ guid: state.chatGuid }) !== (job.kind === 'result' ? 'group' : 'direct')) throw new Error('No original destination was recorded. Choose current or discard.');
    state.destinationApproved = true;
  } else if (choice === 'current') {
    // Never split an already-confirmed multipart result across destinations.
    if (Object.values(state.parts).some(part => part.status === 'done')) throw new Error('Some parts were already sent. Choose original, sent, or discard instead of retargeting.');
    if (job.kind === 'result') state.chatGuid = config.groupChatGuid;
    else {
      // Status intentionally contains no message payload/recipient. On the next
      // fresh claim the authenticated payload supplies the mapped recipient.
      delete state.chatGuid;
    }
    delete state.destinationApproved;
    state.useCurrentDestination = true;
  }
  for (const [part, value] of Object.entries(state.parts)) if (value.status !== 'done') delete state.parts[part];
  journal.put(id, state);
  return post({ action: 'retry', id });
}
