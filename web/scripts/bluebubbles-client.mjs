export function localBlueBubblesUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use the local BlueBubbles URL, such as http://127.0.0.1:1234.');
  return url.origin;
}
class BlueBubblesError extends Error {}
export function blueBubblesFailureDetail(error) {
  // Only our own fixed diagnostic strings may leave the Mac. Fetch/server
  // errors can contain the password URL, chat addresses, or message text.
  return error instanceof BlueBubblesError ? error.message : 'BlueBubbles did not confirm text delivery.';
}
function responseFailure(status, result) {
  const prefix = Number.isInteger(status) && status >= 400 && status <= 599 ? 'BlueBubbles HTTP '+status+'. ' : 'BlueBubbles error. ';
  if (status === 401 || status === 403) return new BlueBubblesError(prefix+'Local API access was rejected.');
  const raw = typeof result?.error === 'string' ? result.error : result?.error?.message;
  const message = typeof raw === 'string' ? raw : '';
  // AppleScript errors end with a numeric code; never echo the surrounding
  // command, which can include the whole message and destination.
  const code = /\((-\d{1,5})\)\s*$/.exec(message)?.[1];
  if (code === '-1743') return new BlueBubblesError(prefix+'Messages automation permission denied (-1743).');
  if (code === '-1728') return new BlueBubblesError(prefix+'AppleScript could not find the selected Messages object (-1728).');
  if (code === '-1712') return new BlueBubblesError(prefix+'Messages AppleScript timed out (-1712).');
  if (code) return new BlueBubblesError(prefix+'AppleScript error '+code+'; check BlueBubbles Logs.');
  const sendCode = result?.data?.error;
  if (Number.isInteger(sendCode) && sendCode > 0 && sendCode <= 99999) return new BlueBubblesError(prefix+'Messages send error code '+sendCode+'.');
  if (/message not found in database after \d+ seconds/i.test(message)) return new BlueBubblesError(prefix+'Sent message was not confirmed in the Messages database.');
  return new BlueBubblesError(prefix+'See BlueBubbles Logs for the send error.');
}
export class BlueBubbles {
  constructor(url, password, fetcher = fetch) { this.url = localBlueBubblesUrl(url); this.password = password; this.fetcher = fetcher; }
  async request(path, body, timeout = 65000) {
    const url = new URL('/api/v1/'+path, this.url); url.searchParams.set('password', this.password);
    const form = body instanceof FormData;
    let response;
    try { response = await this.fetcher(url, { method: body ? 'POST' : 'GET', redirect: 'error', headers: body && !form ? { 'Content-Type': 'application/json' } : {}, body: body ? form ? body : JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) }); }
    catch (error) { throw new BlueBubblesError(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'BlueBubbles request timed out; delivery is unconfirmed.' : 'BlueBubbles connection failed; delivery is unconfirmed.'); }
    let result;
    try { result = await response.json(); }
    catch { throw response.ok ? new BlueBubblesError('BlueBubbles returned an unreadable response.') : responseFailure(response.status); }
    if (!response.ok) throw responseFailure(response.status, result);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new BlueBubblesError('BlueBubbles returned an unreadable response.');
    if (result.status >= 400 || result.error) throw responseFailure(result.status, result);
    if (['message/text', 'message/attachment'].includes(path) && (response.status !== 200 || result.status !== 200)) {
      throw new BlueBubblesError('BlueBubbles returned no final send confirmation; delivery is unconfirmed.');
    }
    return result.data;
  }
  ping() { return this.request('ping', undefined, 4000); }
  async chats() {
    const found = [];
    for (let offset = 0; offset < 5000; offset += 100) {
      const page = await this.request('chat/query', { with: ['participants'], limit: 100, offset });
      if (!Array.isArray(page)) throw new Error('Could not read the chat list from BlueBubbles.');
      found.push(...page); if (page.length < 100) break;
    }
    // Preserve every returned chat so setup can explain unsupported services
    // instead of reporting that existing conversations do not exist.
    return found;
  }
  async lastActivity(chatGuid) {
    const messages = await this.request('chat/'+encodeURIComponent(chatGuid)+'/message?limit=1&sort=DESC', undefined, 10000);
    if (!Array.isArray(messages)) throw new Error('Could not read the last activity from BlueBubbles.');
    if (!messages.length) return null;
    // The API returns a message object; retain only its timestamp, never its
    // text, sender, attachments, or message identifier.
    const date = messages[0]?.dateCreated;
    if (typeof date !== 'number' || !Number.isFinite(date) || date <= 0 || Number.isNaN(new Date(date).getTime())) throw new Error('BlueBubbles returned no usable message timestamp.');
    return date;
  }
  // The official sendText/sendAttachment routes return a serialized Message
  // after sendMessageSync/sendAttachmentSync observes it in Messages. This is
  // a send confirmation, not a recipient read/delivery receipt.
  // https://github.com/BlueBubblesApp/bluebubbles-server/blob/f2e2286241a7c3b6617a82b37d4afaab4df3a6b9/packages/server/src/server/api/http/api/v1/routers/messageRouter.ts
  sendReceipt(data, tempGuid) {
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        typeof data.guid !== 'string' || !data.guid.trim() || data.guid.length > 512 ||
        (data.error != null && data.error !== 0) || data.isFromMe === false ||
        (data.tempGuid != null && data.tempGuid !== tempGuid)) {
      throw new BlueBubblesError('BlueBubbles returned no valid send confirmation; delivery is unconfirmed.');
    }
    return { guid: data.guid };
  }
  async text(chatGuid, message, tempGuid) {
    return this.sendReceipt(await this.request('message/text', { chatGuid, message, tempGuid, method: 'apple-script' }), tempGuid);
  }
  async image(chatGuid, png, tempGuid) {
    const body = new FormData(); body.set('chatGuid', chatGuid); body.set('tempGuid', tempGuid); body.set('method', 'apple-script'); body.set('name', 'rival-room-result.png'); body.set('attachment', new Blob([png], { type: 'image/png' }), 'rival-room-result.png');
    return this.sendReceipt(await this.request('message/attachment', body), tempGuid);
  }
}
