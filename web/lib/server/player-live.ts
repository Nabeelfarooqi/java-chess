import type { Game } from '../game';
import { digest, sessionToken } from './auth';
import type { LiveEnv } from './live';
type Connection = { player: string; tokenHash: string; expires: number; revoked?: boolean; seen?: {gameId:string;version:number;moveId:string;actor:string;expires:number}[] };
// A hibernating notification hub. D1 remains the sole authority for all moves and results.
export class PlayerLive {
    constructor(private ctx: DurableObjectState, private env: LiveEnv) {
        ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    }
    async fetch(req: Request): Promise<Response> {
        if (!this.env.DB) return new Response('Unavailable', { status: 503 });
        // Only the Worker binding can reach this internal endpoint; it is not a public route.
        if (new URL(req.url).pathname === '/receipt' && req.method === 'POST') {
            const receipt = await req.json() as {actor:string;gameId:string;moveId:string;version:number};
            for (const ws of this.ctx.getWebSockets()) {
                const c = ws.deserializeAttachment() as Connection;
                if (c.player!==receipt.actor || c.expires<=Date.now()) continue;
                const valid = await this.env.DB.prepare('SELECT token_hash FROM sessions WHERE token_hash=? AND expires>?').bind(c.tokenHash,Date.now()).first();
                if (valid) { try { ws.send(JSON.stringify({type:'receipt',...receipt})); } catch {} }
            }
            return new Response(null,{status:204});
        }
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
                    else if (game.white === c.player || game.black === c.player) {
                        if (game.delivery && game.delivery.player!==c.player) {
                            c.seen = [...(c.seen||[]).filter(r=>r.expires>Date.now() && r.moveId!==game.delivery!.id),{gameId:game.id,version:game.version,moveId:game.delivery.id,actor:game.delivery.player,expires:Date.now()+30000}].slice(-8);
                            ws.serializeAttachment(c);
                        }
                        ws.send(message);
                    }
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
        const existing = this.ctx.getWebSockets();
        if (existing.length) {
            const hashes = [...new Set(existing.map(ws => (ws.deserializeAttachment() as Connection).tokenHash))];
            const valid = (await this.env.DB.prepare(`SELECT token_hash FROM sessions WHERE player_id=? AND expires>? AND token_hash IN (${hashes.map(() => '?').join(',')})`).bind(session.player_id, Date.now(), ...hashes).all<{token_hash:string}>()).results;
            const allowed = new Set(valid.map(row => row.token_hash));
            for (const ws of existing) {
                const attachment = ws.deserializeAttachment() as Connection;
                if (!allowed.has(attachment.tokenHash) || attachment.expires <= Date.now()) {
                    // A peer may delay the close handshake. Do not count it again.
                    attachment.revoked = true;
                    ws.serializeAttachment(attachment);
                    try { ws.send(JSON.stringify({ type: 'locked' })); ws.close(4001, 'Session expired'); } catch {}
                }
            }
        }
        // Re-read after awaiting D1 so concurrent admissions cannot exceed the cap.
        const open = this.ctx.getWebSockets().filter(ws => {
            const c = ws.deserializeAttachment() as Connection;
            return !c.revoked && c.expires > Date.now() && ws.readyState === 1;
        });
        if (open.length >= 8) return new Response('Too many open tabs', { status: 429 });
        const pair = new WebSocketPair();
        this.ctx.acceptWebSocket(pair[1]);
        pair[1].serializeAttachment({ player: session.player_id, tokenHash, expires: session.expires } satisfies Connection);
        return new Response(null, { status: 101, webSocket: pair[0] });
    }
    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
        if (typeof message!=='string' || message.length>512) { ws.close(1008,'Use the game API for moves'); return; }
        let body; try { body=JSON.parse(message); } catch { ws.close(1008,'Invalid message'); return; }
        if (body?.type!=='seen') { ws.close(1008,'Use the game API for moves'); return; }
        const c=ws.deserializeAttachment() as Connection;
        const receipt=c.seen?.find(r=>r.gameId===body.gameId && r.version===body.version && r.moveId===body.moveId && r.expires>Date.now());
        if (!receipt || !this.env.DB || !this.env.LIVE_PLAYERS) return;
        // Consume synchronously before awaiting D1 so concurrent receipts cannot replay it
        // or overwrite attachment updates from a newer published move.
        c.seen=c.seen?.filter(r=>r!==receipt); ws.serializeAttachment(c);
        if (c.expires<=Date.now() || !await this.env.DB.prepare('SELECT token_hash FROM sessions WHERE token_hash=? AND expires>?').bind(c.tokenHash,Date.now()).first()) { ws.close(4001,'Session expired'); return; }
        await this.env.LIVE_PLAYERS.get(this.env.LIVE_PLAYERS.idFromName(receipt.actor)).fetch('https://live.internal/receipt',{method:'POST',body:JSON.stringify(receipt)});
    }
    webSocketClose(ws: WebSocket) { try { ws.close(1000); } catch {} }
    webSocketError(ws: WebSocket) { ws.close(1011, 'Reconnect'); }
}
