// Only explicitly identified iMessage destinations are selectable. Diagnostic
// output retains other services, but never turns one into an iMessage target.
export function chatKind(chat) {
  if (typeof chat?.guid !== 'string') return 'unsupported';
  if (chat.guid.startsWith('iMessage;-;')) return 'direct';
  if (chat.guid.startsWith('iMessage;+;')) return 'group';
  return 'unsupported';
}
const clean = value => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 100);
export function chatCounts(chats) {
  return {
    total: chats.length,
    direct: chats.filter(chat => chatKind(chat) === 'direct').length,
    group: chats.filter(chat => chatKind(chat) === 'group').length,
    unsupported: chats.filter(chat => chatKind(chat) === 'unsupported').length,
  };
}
export function chatSummary(chats) {
  const count = chatCounts(chats);
  return `BlueBubbles returned ${count.total} chats: ${count.direct} direct iMessage, ${count.group} iMessage groups, ${count.unsupported} unsupported/unrecognized.`;
}
export function chatDiagnostics(chats) {
  const lines = [chatSummary(chats)];
  // Prefixes/types help diagnose newer Messages formats without printing the
  // address or identifier after the second semicolon, or any message bodies.
  const formats = new Map();
  for (const chat of chats) {
    const parts = typeof chat?.guid === 'string' ? chat.guid.split(';') : [];
    const service = ['iMessage', 'SMS', 'MMS', 'RCS', 'any'].includes(parts[0]) ? parts[0] : 'unrecognized';
    const marker = ['-', '+'].includes(parts[1]) ? parts[1] : '?';
    const format = `${service};${marker};[hidden]`;
    formats.set(format, (formats.get(format) || 0) + 1);
  }
  for (const [format, count] of formats) lines.push(`  ${format}: ${count}`);
  lines.push('Most recent returned chats (up to 20; addresses and message bodies omitted):');
  for (const [index, chat] of chats.slice(0, 20).entries()) {
    const name = clean(chat?.displayName) || 'Unnamed chat (contact names may not be supplied by BlueBubbles)';
    const participants = Array.isArray(chat?.participants) ? chat.participants.length : 'unknown';
    const style = Number.isInteger(chat?.style) ? chat.style : 'unknown';
    lines.push(`  ${index + 1}. ${name} | ${chatKind(chat)} | participants: ${participants} | style: ${style}`);
  }
  if (!chats.length) lines.push('The API returned an empty list. Check BlueBubbles Full Disk Access and the Mac Messages account, then use BlueBubbles Logs > Manage > Full Restart.');
  else if (!chatCounts(chats).direct || !chatCounts(chats).group) lines.push('Existing chats may be absent from the API or use a different format. Share this diagnostic output before changing destinations; do not recreate chats just because setup cannot see them.');
  return lines.join('\n');
}
