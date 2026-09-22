import type { Game } from '../game';
import { digest, sessionToken } from './auth';
import type { LiveEnv } from './live';
type Connection = { player: string; tokenHash: string; expires: number };
// A hibernating notification hub. D1 remains the sole authority for all moves and results.
export class PlayerLive {
    constructor(private ctx: DurableObjectState, private env: LiveEnv) {
        ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    }
    async fetch(req: Request): Promise<Response> {
        if (!this.env.DB) return new Response('Unavailable', { status: 503 });
        // Only the Worker binding can reach this internal endpoint; it is not a public route.
        if (new URL(req.url).pathname === '/publish' && req.method === 'POST') {
            const game = await req.json() as Game;
            const sockets = this.ctx.getWebSockets();
            if (!sockets.length) return new Response(null, { status: 204 });
            const connections = sockets.map(ws => ws.deserializeAttachment() as Connection);
            const hashes = [...new Set(connections.map(c => c.tokenHash))];
            const valid = (await this.env.DB.prepare(`SELECT token_hash FROM sessions WHERE expires>? AND token_hash IN (${hashes.map(() => '?').join(',')})`).bind(Date.now(), ...hashes).all<{ token_hash: string }>()).results;
            const allowed = new Set(valid.map(s => s.token_hash));
            const message = JSON.stringify({ type: 'game', game, serverNow: Date.now() });
            sockets.forEach((ws, i) => {
                const c = connections[i];
                try {
                    if (!allowed.has(c.tokenHash) || c.expires <= Date.now()) { ws.send(JSON.stringify({ type: 'locked' })); ws.close(4001, 'Session expired'); }
                    else if (game.white === c.player || game.black === c.player) ws.send(message);
                } catch { /* a closed tab is harmless */ }
            });
            return new Response(null, { status: 204 });
        }
        if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
        const token = sessionToken(req);
        if (!/^[0-9a-f]{64}$/.test(token)) return new Response('Locked', { status: 401 });
        const tokenHash = await digest(token);
        const session = await this.env.DB.prepare('SELECT player_id,expires FROM sessions WHERE token_hash=? AND expires>?').bind(tokenHash, Date.now()).first<{ player_id: string; expires: number }>();
        if (!session || session.player_id !== req.headers.get('x-player-id')) return new Response('Locked', { status: 401 });
        if (this.ctx.getWebSockets().length >= 8) return new Response('Too many open tabs', { status: 429 });
        const pair = new WebSocketPair();
        this.ctx.acceptWebSocket(pair[1]);
        pair[1].serializeAttachment({ player: session.player_id, tokenHash, expires: session.expires } satisfies Connection);
        return new Response(null, { status: 101, webSocket: pair[0] });
    }
    webSocketMessage(ws: WebSocket) { ws.close(1008, 'Use the game API for moves'); }
    webSocketClose(ws: WebSocket) { try { ws.close(1000); } catch {} }
    webSocketError(ws: WebSocket) { ws.close(1011, 'Reconnect'); }
}
