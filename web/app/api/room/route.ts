import { env } from 'cloudflare:workers';
import { Store } from '@/lib/server/store';
import { digest, login, rateLimit, sessionCookie, sessionPlayer, sessionToken } from '@/lib/server/auth';
import { GameError } from '@/lib/game';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (data: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(data, { status, headers: { ...headers, ...extra } });
function db() { if (!env.DB)
    throw new GameError('The room is temporarily unavailable. Please try again.', 503); return env.DB; }
function failure(e: unknown) { if (e instanceof GameError)
    return json({ error: e.message }, e.status); console.error('Room request failed', e instanceof Error ? e.message : 'unknown'); return json({ error: 'The room could not save that request. Please try again.' }, 503); }
export async function GET(req: Request) { try {
    const database = db();
    const me = await sessionPlayer(database, req);
    if (!me)
        return json({ locked: true }, 401);
    const store = new Store(database);
    if (new URL(req.url).searchParams.get('export') === 'all')
        return json({ exportedAt: new Date().toISOString(), ...(await store.room(me)), games: await store.export() });
    return json(await store.room(me));
}
catch (e) {
    return failure(e);
} }
export async function POST(req: Request) {
    try {
        if (req.headers.get('origin') !== new URL(req.url).origin)
            return json({ error: 'Please use the room page to make changes.' }, 403);
        if (!req.headers.get('content-type')?.startsWith('application/json'))
            return json({ error: 'JSON is required.' }, 415);
        if (Number(req.headers.get('content-length') || 0) > 4096)
            return json({ error: 'Request is too large.' }, 413);
        const raw = await req.text();
        if (raw.length > 4096)
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
        const database = db();
        if (body.action === 'login') {
            const { player, token } = await login(database, req, body.pin, env as unknown as {
                PIN_ONE_HASH?: string;
                PIN_TWO_HASH?: string;
            });
            return json(await new Store(database).room(player), 200, { 'Set-Cookie': sessionCookie(req, token) });
        }
        const me = await sessionPlayer(database, req);
        if (!me)
            return json({ error: 'Enter your code to unlock the room.', locked: true }, 401);
        if (body.action === 'logout') {
            await database.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(sessionToken(req))).run();
            return json({ locked: true }, 200, { 'Set-Cookie': sessionCookie(req, '') });
        }
        await rateLimit(database, 'actions:' + me, 240, 60000);
        const store = new Store(database);
        if (body.action === 'create')
            await store.create(me, Number(body.minutes), Number(body.increment));
        else if (body.action === 'rename')
            await store.rename(me, body.name);
        else
            await store.act(me, String(body.action), body);
        return json(await store.room(me));
    }
    catch (e) {
        return failure(e);
    }
}
