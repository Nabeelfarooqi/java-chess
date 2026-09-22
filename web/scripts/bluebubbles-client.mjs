export function localBlueBubblesUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use the local BlueBubbles URL, such as http://127.0.0.1:1234.');
  return url.origin;
}
export class BlueBubbles {
  constructor(url, password, fetcher = fetch) { this.url = localBlueBubblesUrl(url); this.password = password; this.fetcher = fetcher; }
  async request(path, body, timeout = 65000) {
    const url = new URL('/api/v1/'+path, this.url); url.searchParams.set('password', this.password);
    const form = body instanceof FormData;
    let response;
    try { response = await this.fetcher(url, { method: body ? 'POST' : 'GET', redirect: 'error', headers: body && !form ? { 'Content-Type': 'application/json' } : {}, body: body ? form ? body : JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) }); }
    catch { throw new Error('BlueBubbles did not confirm the request.'); }
    if (!response.ok) throw new Error('BlueBubbles returned HTTP '+response.status+'.');
    let result; try { result = await response.json(); } catch { throw new Error('BlueBubbles returned an unreadable response.'); }
    if (result.status >= 400 || result.error) throw new Error('BlueBubbles reported a send error.');
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
  text(chatGuid, message, tempGuid) { return this.request('message/text', { chatGuid, message, tempGuid, method: 'apple-script' }); }
  image(chatGuid, png, tempGuid) {
    const body = new FormData(); body.set('chatGuid', chatGuid); body.set('tempGuid', tempGuid); body.set('method', 'apple-script'); body.set('name', 'rival-room-result.png'); body.set('attachment', new Blob([png], { type: 'image/png' }), 'rival-room-result.png');
    return this.request('message/attachment', body);
  }
}
