import handler from 'vinext/server/fetch-handler';
import { sessionPlayer } from './lib/server/auth';
import { handleBridge } from './lib/server/imessage';
import { handleGET, handlePOST } from './lib/server/api';
import { handleSpectator } from './lib/server/spectator';
import type { LiveEnv } from './lib/server/live';
export { PlayerLive } from './lib/server/player-live';
const routes = {
    async fetch(req: Request, env: LiveEnv, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(req.url);
        if (url.pathname === '/api/spectate') return handleSpectator(req, env, ctx);
        if (url.pathname === '/api/imessage') return handleBridge(req, env, ctx);
        if (url.pathname === '/api/live') {
            if (req.method !== 'GET' || req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
            if (req.headers.get('Origin') !== url.origin) return new Response('Forbidden', { status: 403 });
            if (!env.DB || !env.LIVE_PLAYERS) return new Response('Live updates unavailable', { status: 503 });
            const player = await sessionPlayer(env.DB, req);
            if (!player) return new Response('Locked', { status: 401 });
            const headers = new Headers(req.headers);
            headers.set('x-player-id', player);
            return env.LIVE_PLAYERS.get(env.LIVE_PLAYERS.idFromName(player)).fetch(new Request(req, { headers }));
        }
        if (url.pathname === '/api/room') {
            if (req.method === 'GET') return handleGET(req, env, ctx);
            if (req.method === 'POST') return handlePOST(req, env, ctx);
            return new Response('Method not allowed', { status: 405 });
        }
        return handler.fetch(req, env, ctx);
    }
};
const worker = {
    async fetch(req: Request, env: LiveEnv, ctx: ExecutionContext): Promise<Response> {
        const response = await routes.fetch(req, env, ctx);
        // Preserve the live upgrade object; normal HTML/API responses get the
        // same framing/referrer policy without restricting engine Workers/WASM.
        if (response.status === 101) return response;
        const headers = new Headers(response.headers);
        headers.set('X-Content-Type-Options', 'nosniff');
        headers.set('X-Frame-Options', 'DENY');
        headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
        headers.set('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
};
export default worker;
