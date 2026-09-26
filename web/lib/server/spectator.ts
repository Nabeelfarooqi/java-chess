import { GameError, type Game, type Player } from '../game';
import type { SpectatorRoom } from '../spectator';
import { digest, hex, rateLimit, RateLimitError, verifyPin } from './auth';
import { readJson } from './request';
import { broadcast, type LiveEnv } from './live';
import { Store } from './store';

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(body, {
    status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
});
const tokenFrom = (req: Request) => req.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith('rr_spectator='))?.slice(13) || '';
const cookie = (req: Request, token: string) => `rr_spectator=${token}; HttpOnly; SameSite=Strict; Path=/api/spectate;${new URL(req.url).protocol === 'https:' ? ' Secure;' : ''}${token ? '' : ' Max-Age=0;'}`;

export async function spectatorSession(db: D1Database, req: Request) {
    const token = tokenFrom(req);
    if (!/^[0-9a-f]{64}$/.test(token)) return false;
    return !!await db.prepare('SELECT token_hash FROM spectator_sessions WHERE token_hash=? AND expires>? AND EXISTS (SELECT 1 FROM spectator_settings WHERE id=1 AND pin_hash IS NOT NULL)')
        .bind(await digest(token), Date.now()).first();
}

export async function watchView(db: D1Database, req: Request, env: LiveEnv, ctx?: ExecutionContext, viewerId?: string): Promise<SpectatorRoom> {
    const gameId = new URL(req.url).searchParams.get('game');
    if (gameId && gameId.length > 64) throw new GameError('Invalid game.', 400);
    const store = new Store(db, game => { const task = broadcast(env, game).catch(() => {}); if (ctx) ctx.waitUntil(task); });
    const [rows, roster] = await db.batch([
        db.prepare("SELECT state,version FROM games WHERE active_key=1 AND json_extract(state,'$.status')='active' ORDER BY created_at DESC LIMIT 50"),
        db.prepare('SELECT id,name,character FROM players ORDER BY name,id'),
    ]);
    const games: Game[] = [];
    let selectedGame: Game | null = null;
    for (const row of rows.results as { state: string; version: number }[]) {
        // As in a player's room, elapsed server clocks settle normally. Spectators
        // cannot submit moves, adjudicate results, or supply replacement game state.
        const game = await store.settle({ ...JSON.parse(row.state), version: row.version });
        if (game && game.white !== viewerId && game.black !== viewerId) {
            if (game.status === 'active') games.push(game);
            if (game.id === gameId) selectedGame = game;
        }
    }
    if (gameId && !selectedGame) {
        const game = await store.get(gameId);
        // Keep the selected board visible when its live game ends, without
        // exposing a club-wide history/export endpoint.
        if (game && ['active', 'finished'].includes(game.status) && game.white !== viewerId && game.black !== viewerId) selectedGame = await store.settle(game);
    }
    return { games, selectedGame, players: roster.results as Player[], serverNow: Date.now() };
}

export async function handleSpectator(req: Request, env: LiveEnv, ctx?: ExecutionContext) {
    try {
        const db = env.DB;
        if (!db) throw new GameError('The room is temporarily unavailable.', 503);
        if (req.method === 'GET') {
            if (!await spectatorSession(db, req)) return json({ locked: true }, 401);
            return json(await watchView(db, req, env, ctx));
        }
        if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET, POST' });
        if (req.headers.get('origin') !== new URL(req.url).origin) throw new GameError('Use the spectator page to continue.', 403);
        if (!req.headers.get('content-type')?.startsWith('application/json')) throw new GameError('JSON is required.', 415);
        const body = await readJson(req, 1024);
        if (body.action === 'login') {
            const ip = req.headers.get('cf-connecting-ip') || 'local-preview';
            await rateLimit(db, 'spectator-ip:' + await digest(ip), 8, 15 * 60000);
            await rateLimit(db, 'spectator-global', 50, 15 * 60000);
            if (typeof body.pin !== 'string' || !/^\d{6}$/.test(body.pin)) throw new GameError('Enter the 6-digit spectator code.', 401);
            const setting = await db.prepare('SELECT spectator_settings.pin_hash,pin_settings.salt FROM spectator_settings JOIN pin_settings ON pin_settings.id=spectator_settings.id WHERE spectator_settings.id=1').first<{ pin_hash: string | null; salt: string }>();
            if (!setting?.pin_hash) throw new GameError('Spectator access has not been enabled yet.', 503);
            if (!await verifyPin(body.pin, setting.salt + ':' + setting.pin_hash)) throw new GameError('That spectator code did not match.', 401);
            const token = hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
            const inserted = await db.batch([
                db.prepare('DELETE FROM spectator_sessions WHERE expires<=?').bind(Date.now()),
                // Compare the setting again so rotating a PIN during verification
                // cannot leave a newly-created session for an old code.
                db.prepare('INSERT INTO spectator_sessions(token_hash,expires) SELECT ?,? WHERE EXISTS (SELECT 1 FROM spectator_settings WHERE id=1 AND pin_hash=?) RETURNING token_hash')
                    .bind(await digest(token), Date.now() + 12 * 60 * 60000, setting.pin_hash),
            ]);
            if (!inserted[1].results.length) throw new GameError('The spectator code changed. Please sign in again.', 401);
            return json({ unlocked: true }, 200, { 'Set-Cookie': cookie(req, token) });
        }
        if (!await spectatorSession(db, req)) return json({ locked: true, error: 'Enter the spectator code.' }, 401);
        if (body.action === 'logout') {
            await db.prepare('DELETE FROM spectator_sessions WHERE token_hash=?').bind(await digest(tokenFrom(req))).run();
            return json({ locked: true }, 200, { 'Set-Cookie': cookie(req, '') });
        }
        return json({ error: 'Spectator access is read-only.' }, 403);
    } catch (error) {
        if (error instanceof RateLimitError) return json({ error: error.message }, 429, { 'Retry-After': String(error.retryAfter) });
        if (error instanceof GameError) return json({ error: error.message }, error.status);
        console.error('Spectator request failed', error instanceof Error ? error.message : 'unknown');
        return json({ error: 'Could not load the spectator room. Please try again.' }, 503);
    }
}
