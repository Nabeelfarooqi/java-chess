import { createServer, request } from 'node:http';
import { connect } from 'node:net';

// Test-only loopback proxy. Fault control is an in-process method exposed to the
// test runner over its existing child IPC channel, never an HTTP endpoint.
export async function startFaultProxy(upstreamOrigin) {
  const upstream = new URL(upstreamOrigin);
  if (upstream.protocol !== 'http:' || upstream.hostname !== '127.0.0.1') throw new Error('Fault proxy requires a loopback HTTP upstream.');
  const sockets = new Set();
  let outage = false, failedRequests = 0, healthyRequests = 0, origin;
  const track = socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); return socket; };
  const headersFor = incoming => ({ ...incoming.headers, host: upstream.host,
    ...(incoming.headers.origin === origin ? { origin: upstream.origin } : {}) });
  const server = createServer((incoming, outgoing) => {
    const chunk = incoming.method === 'GET' && /\/club-hub-[^/]+\.js$/.test(new URL(incoming.url, origin).pathname);
    if (outage && chunk) {
      failedRequests++;
      outgoing.writeHead(503, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      outgoing.end('Synthetic chunk outage');
      return;
    }
    const forwarded = request({ hostname: upstream.hostname, port: upstream.port,
      path: incoming.url, method: incoming.method, headers: headersFor(incoming), agent: false }, response => {
      if (chunk && response.statusCode === 200) healthyRequests++;
      outgoing.writeHead(response.statusCode, response.headers);
      response.pipe(outgoing);
    });
    forwarded.on('socket', track);
    forwarded.on('error', () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); });
    outgoing.on('close', () => forwarded.destroy());
    incoming.pipe(forwarded);
  });
  server.on('connection', track);
  server.on('upgrade', (incoming, downstream, head) => {
    const socket = track(connect({ host: upstream.hostname, port: Number(upstream.port) }));
    socket.once('connect', () => {
      const headers = Object.entries(headersFor(incoming)).flatMap(([name, values]) =>
        (Array.isArray(values) ? values : [values]).map(value => `${name}: ${value}\r\n`)).join('');
      socket.write(`${incoming.method} ${incoming.url} HTTP/${incoming.httpVersion}\r\n${headers}\r\n`);
      if (head.length) socket.write(head);
      downstream.pipe(socket); socket.pipe(downstream);
    });
    socket.on('error', () => downstream.destroy());
    downstream.on('error', () => socket.destroy());
    socket.on('close', () => downstream.destroy());
    downstream.on('close', () => socket.destroy());
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    setChunkOutage(enabled) {
      if (enabled) { failedRequests = 0; healthyRequests = 0; }
      outage = !!enabled;
      return { failedRequests, healthyRequests };
    },
    stop: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      for (const socket of sockets) socket.destroy();
    }),
  };
}
