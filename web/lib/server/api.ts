import { practiceGET, practicePOST } from './practice';
import { Store } from './store';
import { digest, login, rateLimit, sessionCookie, sessionPlayer, sessionToken } from './auth';
import { GameError } from '../game';
import { broadcast, type LiveEnv } from './live';
function storeFor(database: D1Database, env: LiveEnv, ctx?: ExecutionContext) {
    return new Store(database, game => { const task = broadcast(env, game).catch(() => {}); if (ctx) ctx.waitUntil(task); });
}
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (data: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(data, { status, headers: { ...headers, ...extra } });
function db(env: LiveEnv) { if (!env.DB)
    throw new GameError('The room is temporarily unavailable. Please try again.', 503); return env.DB; }
function failure(e: unknown) { if (e instanceof GameError)
    return json({ error: e.message }, e.status); console.error('Room request failed', e instanceof Error ? e.message : 'unknown'); return json({ error: 'The room could not save that request. Please try again.' }, 503); }
export async function handleGET(req: Request, env: LiveEnv, ctx?: ExecutionContext) { try {
    const database = db(env);
    const me = await sessionPlayer(database, req);
    if (!me)
        return json({ locked: true }, 401);
    const store = storeFor(database, env, ctx);
    if (new URL(req.url).searchParams.has('club')) return json(await store.club());
    if (new URL(req.url).searchParams.has('practice')) return json(await practiceGET(database, me));
    if (new URL(req.url).searchParams.get('live') === '1') return json({ me, game: await store.current(me), serverNow: Date.now() });
    if (new URL(req.url).searchParams.get('export') === 'all')
        return json({ exportedAt: new Date().toISOString(), ...(await store.room(me)), games: await store.export(me), ...(await store.exportClubData(me)) });
    return json(await store.room(me));
}
catch (e) {
    return failure(e);
} }
export async function handlePOST(req: Request, env: LiveEnv, ctx?: ExecutionContext) {
    try {
        if (req.headers.get('origin') !== new URL(req.url).origin)
            return json({ error: 'Please use the room page to make changes.' }, 403);
        if (!req.headers.get('content-type')?.startsWith('application/json'))
            return json({ error: 'JSON is required.' }, 415);
        if (Number(req.headers.get('content-length') || 0) > 16384)
            return json({ error: 'Request is too large.' }, 413);
        const raw = await req.text();
        if (raw.length > 16384)
            return json({ error: 'Request is too large.' }, 413);
        let body: Record<string, unknown>;
        try {
            body = JSON.parse(raw);
        }
        catch {
            return json({ error: 'Invalid request.' }, 400);
        }
        if (!body || typeof body !== 'object' || Array.isArray(body))
            return json({ error: 'Invalid request.' }, 400);
        const database = db(env);
        if (body.action === 'login') {
            const { player, token } = await login(database, req, body.pin, env as unknown as {
                PIN_ONE_HASH?: string;
                PIN_TWO_HASH?: string;
            });
            return json(await storeFor(database, env, ctx).room(player), 200, { 'Set-Cookie': sessionCookie(req, token) });
        }
        const me = await sessionPlayer(database, req);
        if (!me)
            return json({ error: 'Enter your code to unlock the room.', locked: true }, 401);
        if (body.action === 'logout') {
            await database.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(sessionToken(req))).run();
            return json({ locked: true }, 200, { 'Set-Cookie': sessionCookie(req, '') });
        }
        if (body.action === 'presence') {
            await database.prepare('INSERT INTO player_presence(token_hash,last_seen) VALUES(?,?) ON CONFLICT(token_hash) DO UPDATE SET last_seen=excluded.last_seen WHERE player_presence.last_seen<excluded.last_seen-15000').bind(await digest(sessionToken(req)),Date.now()).run();
            return json({ok:true});
        }
        if (typeof body.action === 'string' && body.action.startsWith('practice')) {
            await rateLimit(database,'practice:'+me,60,60000);
            return json(await practicePOST(database,me,body));
        }
        await rateLimit(database, 'actions:' + me, 240, 60000);
        const store = storeFor(database, env, ctx);
        let game;
        if (body.action === 'create')
            game = await store.create(me, body.rival, Number(body.minutes), Number(body.increment), body.bestOf === undefined ? 1 : Number(body.bestOf));
        else if (body.action === 'nextRound' || body.action === 'endSeries')
            game = await store.seriesAction(me,body.action,body);
        else if (body.action === 'rename')
            await store.rename(me, body.name);
        else
            game = await store.act(me, String(body.action), body);
        if (body.compact === true && game) return json({ me, game, serverNow: Date.now() });
        return json(await store.room(me));
    }
    catch (e) {
        return failure(e);
    }
}
