import handler from 'vinext/server/fetch-handler';
import { sessionPlayer } from './lib/server/auth';
import { handleGET, handlePOST } from './lib/server/api';
import type { LiveEnv } from './lib/server/live';
export { PlayerLive } from './lib/server/player-live';
export default {
    async fetch(req: Request, env: LiveEnv, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(req.url);
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
