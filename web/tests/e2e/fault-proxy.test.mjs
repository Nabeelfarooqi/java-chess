import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { startFaultProxy } from './fault-proxy.mjs';

const sockets = new Set();
const upstream = createServer(async (incoming, outgoing) => {
  if (incoming.url.startsWith('/assets/club-hub-')) {
    outgoing.writeHead(200, { 'Content-Type': 'text/javascript' });
    outgoing.end('export default "Healthy club";');
  } else {
    let body = '';
    for await (const chunk of incoming) body += chunk;
    outgoing.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'fixture=synthetic; Path=/; HttpOnly' });
    outgoing.end(JSON.stringify({ method: incoming.method, headers: incoming.headers, body }));
  }
});
upstream.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
let websocketHeaders;
upstream.on('upgrade', (incoming, socket) => {
  websocketHeaders = incoming.headers;
  const accept = createHash('sha1').update(incoming.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.once('data', () => socket.write(Buffer.from([0x8a, 0]))); // Empty pong.
});
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
const upstreamOrigin = `http://127.0.0.1:${upstream.address().port}`;
let proxy;
try {
  await assert.rejects(startFaultProxy('https://example.com'), /loopback/);
  proxy = await startFaultProxy(upstreamOrigin);
  const chunkUrl = proxy.origin + '/assets/club-hub-fixture.js?version=1';
  proxy.setChunkOutage(true);
  const failed = await fetch(chunkUrl);
  assert.equal(failed.status, 503); assert.equal(failed.headers.get('cache-control'), 'no-store');
  assert.equal(await failed.text(), 'Synthetic chunk outage');
  assert.deepEqual(proxy.setChunkOutage(false), { failedRequests: 1, healthyRequests: 0 });
  const healthy = await fetch(chunkUrl);
  assert.equal(healthy.status, 200); assert.match(await healthy.text(), /Healthy club/);
  assert.deepEqual(proxy.setChunkOutage(false), { failedRequests: 1, healthyRequests: 1 });
  const echoed = await fetch(proxy.origin + '/api/room', { method: 'POST',
    headers: { Origin: proxy.origin, 'Content-Type': 'application/json', Cookie: 'fixture=synthetic' }, body: '{"action":"fixture"}' });
  const echo = await echoed.json();
  assert.equal(echo.method, 'POST'); assert.equal(echo.body, '{"action":"fixture"}');
  assert.equal(echo.headers.host, new URL(upstreamOrigin).host); assert.equal(echo.headers.origin, upstreamOrigin);
  assert.equal(echo.headers.cookie, 'fixture=synthetic'); assert.match(echoed.headers.get('set-cookie'), /fixture=synthetic/);
  const websocket = await new Promise((resolve, reject) => {
    const req = request(proxy.origin + '/api/live', { headers: { Connection: 'Upgrade', Upgrade: 'websocket',
      Origin: proxy.origin, 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version': '13' } });
    req.on('error', reject); req.on('upgrade', (response, socket) => { assert.equal(response.statusCode, 101); resolve(socket); });
    req.end();
  });
  const pong = once(websocket, 'data');
  websocket.write(Buffer.from([0x89, 0x80, 0, 0, 0, 0])); // Masked empty ping.
  assert.deepEqual((await pong)[0], Buffer.from([0x8a, 0]));
  assert.equal(websocketHeaders.origin, upstreamOrigin); assert.equal(websocketHeaders.host, new URL(upstreamOrigin).host);
  const closed = once(websocket, 'close');
  await proxy.stop(); proxy = null; await closed;
  console.log('PASS Real loopback 503/no-store, healthy chunk recovery, POST/cookies/origin, WebSocket upgrade, and active-socket cleanup');
} finally {
  if (proxy) await proxy.stop();
  const closed = new Promise(resolve => upstream.close(resolve));
  for (const socket of sockets) socket.destroy();
  await closed;
}
