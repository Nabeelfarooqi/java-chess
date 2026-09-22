import { digest } from './auth';
import { Store } from './store';
import { broadcast, type LiveEnv } from './live';
import type { Game, Player } from '../game';
type JobRow = { id: string; game_id: string; kind: 'challenge' | 'result'; status: string; created_at: number; lease_token: string; attempts: number };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
function same(a: string, b: string) { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
export async function notificationPayload(db: D1Database, job: JobRow, origin: string) {
    const game = await new Store(db).get(job.game_id);
    if (!game || (job.kind === 'challenge' && (game.status !== 'pending' || game.createdAt + 15 * 60000 <= Date.now()))) return null;
    const roster = (await db.prepare('SELECT id,name,character FROM players WHERE id IN (?,?)').bind(game.white, game.black).all<Player>()).results;
    const white = roster.find(p => p.id === game.white), black = roster.find(p => p.id === game.black);
    if (!white || !black) return null;
    const time = `${game.minutes}+${game.increment}`;
    const common = { id: job.id, kind: job.kind, gameId: game.id, leaseToken: job.lease_token, attempts: job.attempts };
    if (job.kind === 'challenge') {
        const challenger = game.challenger === white.id ? white : black, rival = challenger.id === white.id ? black : white;
        return { ...common, recipientId: rival.id, text: `${challenger.name} challenged you to ${time} chess.\nPlay: ${origin}/` };
    }
    if (game.status !== 'finished') return null;
    const score = await db.prepare(`SELECT
      COALESCE(SUM(json_extract(state,'$.winner')=?),0) AS whiteWins,
      COALESCE(SUM(json_extract(state,'$.winner')=?),0) AS blackWins,
      COALESCE(SUM(json_extract(state,'$.winner') IS NULL),0) AS draws
      FROM games WHERE json_extract(state,'$.status')='finished' AND finished_at<=?
      AND ((json_extract(state,'$.white')=? AND json_extract(state,'$.black')=?)
      OR (json_extract(state,'$.white')=? AND json_extract(state,'$.black')=?))`)
      .bind(white.id, black.id, job.created_at, white.id, black.id, black.id, white.id).first<{ whiteWins: number; blackWins: number; draws: number }>();
    const winner = game.winner === white.id ? white : black, loser = winner.id === white.id ? black : white;
    const headline = game.winner ? `${winner.name} beat ${loser.name}!` : `${white.name} and ${black.name} drew.`;
    const result = { white, black, winnerId: game.winner, time, reason: game.reason, score: score || { whiteWins: 0, blackWins: 0, draws: 0 } };
    return { ...common, recipientId: null, result, text: `${headline}\n${time} · ${game.reason}\nHead-to-head: ${white.name} ${result.score.whiteWins}–${result.score.blackWins} ${black.name} · ${result.score.draws} draws\n${origin}/` };
}
export async function handleBridge(req: Request, env: LiveEnv, ctx?: ExecutionContext): Promise<Response> {
    if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
    const match = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.get('authorization') || '');
    if (!env.IMESSAGE_BRIDGE_HASH || !match || !same(await digest(match[1]), env.IMESSAGE_BRIDGE_HASH)) return json({ error: 'Bridge authorization required' }, 401);
    if (!env.DB) return json({ error: 'Database unavailable' }, 503);
    if (!req.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'JSON required' }, 415);
    const raw = await req.text(); if (raw.length > 4096) return json({ error: 'Request too large' }, 413);
    let body: Record<string, unknown>; try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (!body || Array.isArray(body) || typeof body !== 'object') return json({ error: 'Invalid request' }, 400);
    const db = env.DB;
    try {
        if (body.action === 'status') {
            const settings = await db.prepare('SELECT enabled FROM notification_settings WHERE id=1').first();
            const jobs = (await db.prepare('SELECT id,kind,status,attempts,detail,created_at FROM notification_outbox ORDER BY created_at DESC LIMIT 30').all()).results;
            return json({ settings, jobs });
        }
        if (body.action === 'retry') {
            if (typeof body.id !== 'string' || body.id.length > 100) return json({ error: 'Job ID required' }, 400);
            const r = await db.prepare("UPDATE notification_outbox SET status='pending',lease_token=NULL,lease_until=0,attempts=0,detail='' WHERE id=? AND status='needs_review'").bind(body.id).run();
            return json({ updated: !!r.meta.changes });
        }
        if (body.action === 'ack') {
            if (typeof body.id !== 'string' || typeof body.leaseToken !== 'string' || !['sent', 'skipped', 'needs_review'].includes(String(body.status))) return json({ error: 'Invalid acknowledgement' }, 400);
            const detail = typeof body.detail === 'string' ? body.detail.slice(0, 160) : '';
            const r = await db.prepare("UPDATE notification_outbox SET status=?,detail=?,lease_until=0 WHERE id=? AND status='leased' AND lease_token=?")
                .bind(body.status, detail, body.id, body.leaseToken).run();
            return json({ updated: !!r.meta.changes }, r.meta.changes ? 200 : 409);
        }
        if (body.action !== 'claim') return json({ error: 'Unknown action' }, 400);
        const settings = await db.prepare('SELECT enabled FROM notification_settings WHERE id=1').first<{ enabled: number }>();
        if (!settings?.enabled) return json({ job: null, enabled: false });
        // Settle persisted clocks even if both browsers have closed.
        const store = new Store(db, game => { const task = broadcast(env, game).catch(() => {}); if (ctx) ctx.waitUntil(task); });
        const active = (await db.prepare('SELECT state,version FROM games WHERE active_key=1 LIMIT 25').all<{ state: string; version: number }>()).results;
        for (const row of active) await store.settle({ ...JSON.parse(row.state), version: row.version } as Game);
        for (let i = 0; i < 5; i++) {
            const now = Date.now(), lease = crypto.randomUUID();
            const job = await db.prepare(`UPDATE notification_outbox SET status='leased',lease_token=?,lease_until=?,attempts=attempts+1
              WHERE id=(SELECT id FROM notification_outbox WHERE status='pending' OR (status='leased' AND lease_until<?) ORDER BY created_at,id LIMIT 1) RETURNING *`)
              .bind(lease, now + 300000, now).first<JobRow>();
            if (!job) return json({ job: null, enabled: true });
            const payload = await notificationPayload(db, job, new URL(req.url).origin);
            if (payload) return json({ job: payload, enabled: true });
            await db.prepare("UPDATE notification_outbox SET status='skipped',detail='Challenge expired, accepted, cancelled, or game unavailable',lease_until=0 WHERE id=? AND lease_token=?").bind(job.id, lease).run();
        }
        return json({ job: null, enabled: true });
    } catch { return json({ error: 'Bridge request could not complete; retry later' }, 503); }
}
