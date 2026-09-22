import { chatKind } from './imessage-chat-list.mjs';

export async function groupActivityReport(chats, bb) {
  const groups = chats.filter(chat => chatKind(chat) === 'group');
  if (!groups.length) return 'No matching selectable groups. Try the exact group name shown in Messages.';
  // Keep each exact group separate, including groups with identical names and
  // members. Activity helps the owner choose; it never selects a destination.
  const results = await Promise.allSettled(groups.map(chat => bb.lastActivity(chat.guid)));
  const lines = ['Group activity (times use this Mac\'s timezone; no message text or participant addresses shown):'];
  groups.forEach((chat, index) => {
    const result = results[index];
    const activity = result.status === 'rejected' ? 'Lookup failed' : result.value === null ? 'No stored messages' : new Date(result.value).toLocaleString();
    const name = String(chat.displayName || 'Unnamed group').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 100);
    const id = Number.isSafeInteger(chat.originalROWID) ? chat.originalROWID : 'unavailable';
    const members = Array.isArray(chat.participants) ? chat.participants.length : 'unknown';
    lines.push(`Chat ID ${id} | ${name} | ${members} members | Last message: ${activity}`);
  });
  lines.push('Compare the time with the intended conversation in Messages, then match its Chat ID to the numbered choice in setup. A newer ID alone does not identify the active chat.');
  lines.push('Nothing was selected, saved, or sent. Equal timestamps do not establish which thread you intended.');
  return lines.join('\n');
}
