import { digest } from './auth';
import { readJson } from './request';
import { GameError } from '../game';
import { Store } from './store';
import { broadcast, type LiveEnv } from './live';
import type { Game, Player } from '../game';
type JobRow = { id: string; game_id: string; kind: 'challenge' | 'result'; status: string; created_at: number; lease_token: string; attempts: number };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
function same(a: string, b: string) { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
// Message names follow saved identities; the site's character names stay unchanged.
function messageName(player: Player) { return player.id === 'one' ? 'Nabeel' : player.id === 'two' ? 'Saif' : player.character === 'gud' ? 'Usman' : player.name; }
const count = (value: number, noun: string) => `${value} ${noun}${value === 1 ? '' : 's'}`;
export function resultOpening(first: string, second: string, draw: boolean, ordinal: number) {
    const phrases = draw ? [
        `${first} and ${second} drew. 🤝\nNobody won. Both will say they were better.`,
        `${first} and ${second} drew. 😭\nAll that thinking just to split the bill.`,
        `${first} and ${second} drew. 💀\nBoth kings survived. Both egos remain undefeated.`,
    ] : [
        `${first} gooned on ${second} 💀\nThe scoreboard has receipts.`,
        `${first} beat ${second}’s ass 😭\nThat rematch request is about to be personal.`,
        `${first} gooned on ${second}.\nSomebody’s about to blame the Wi-Fi 💀`,
        `${first} beat ${second}’s ass 💀\nThe group chat has been notified. There is no hiding.`,
    ];
    return phrases[Math.max(0, ordinal - 1) % phrases.length];
}
export async function notificationPayload(db: D1Database, job: JobRow, origin: string) {
    const game = await new Store(db).get(job.game_id);
    if (!game || (job.kind === 'challenge' && (game.status !== 'pending' || game.createdAt + 15 * 60000 <= Date.now()))) return null;
    const roster = (await db.prepare('SELECT id,name,character FROM players WHERE id IN (?,?)').bind(game.white, game.black).all<Player>()).results;
    const white = roster.find(p => p.id === game.white), black = roster.find(p => p.id === game.black);
    if (!white || !black) return null;
    const time = `${game.minutes}+${game.increment}`;
    const common = { id: job.id, kind: job.kind, gameId: game.id, leaseToken: job.lease_token, attempts: job.attempts, createdAt: job.created_at };
    if (job.kind === 'challenge') {
        const challenger = game.challenger === white.id ? white : black, rival = challenger.id === white.id ? black : white;
        return { ...common, recipientId: rival.id, text: `${messageName(challenger)} challenged you to ${time} chess.\nPlay: ${origin}/` };
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
    const result = { white, black, winnerId: game.winner, time, reason: game.reason, score: score || { whiteWins: 0, blackWins: 0, draws: 0 } };
    // Rotate separately through this pair's decisive games and draws. The score
    // cutoff above makes a retry or delayed delivery keep the same phrase.
    const ordinal = game.winner ? result.score.whiteWins + result.score.blackWins : result.score.draws;
    const headline = resultOpening(messageName(game.winner ? winner : white), messageName(game.winner ? loser : black), !game.winner, ordinal);
    const first = game.winner ? winner : white, second = first.id === white.id ? black : white;
    const firstWins = first.id === white.id ? result.score.whiteWins : result.score.blackWins;
    const secondWins = first.id === white.id ? result.score.blackWins : result.score.whiteWins;
    return { ...common, recipientId: null, result, text: `${headline}\nHead-to-head: ${messageName(first)} ${count(firstWins, 'win')} · ${messageName(second)} ${count(secondWins, 'win')} · ${count(result.score.draws, 'draw')}\n${time} · ${game.reason}` };
}
export async function handleBridge(req: Request, env: LiveEnv, ctx?: ExecutionContext): Promise<Response> {
    if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
    const match = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.get('authorization') || '');
    if (!env.IMESSAGE_BRIDGE_HASH || !match || !same(await digest(match[1]), env.IMESSAGE_BRIDGE_HASH)) return json({ error: 'Bridge authorization required' }, 401);
    if (!env.DB) return json({ error: 'Database unavailable' }, 503);
    if (!req.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'JSON required' }, 415);
    let body: Record<string, unknown>;
    try { body = await readJson(req, 4096); }
    catch (error) { if (error instanceof GameError) return json({ error: error.message }, error.status); throw error; }
    const db = env.DB;
    try {
        if (body.action === 'status') {
            const settings = await db.prepare('SELECT enabled FROM notification_settings WHERE id=1').first();
            const fields = 'SELECT id,kind,status,attempts,detail,created_at FROM notification_outbox';
            if (body.id !== undefined) {
                if (typeof body.id !== 'string' || !body.id || body.id.length > 100) return json({ error: 'Job ID required' }, 400);
                const jobs = (await db.prepare(fields+' WHERE id=?').bind(body.id).all()).results;
                return json({ settings, jobs, nextCursor: null });
            }
            if (body.status !== undefined && body.status !== 'needs_review') return json({ error: 'Invalid status filter' }, 400);
            const limit = body.limit === undefined ? 30 : body.limit;
            if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100) return json({ error: 'Invalid page limit' }, 400);
            const where: string[] = [], values: (string | number)[] = [];
            if (body.status) { where.push('status=?'); values.push(String(body.status)); }
            if (body.cursor !== undefined) {
                const cursor = body.cursor as { createdAt?: unknown; id?: unknown };
                if (!cursor || !Number.isSafeInteger(cursor.createdAt) || Number(cursor.createdAt) < 0 || typeof cursor.id !== 'string' || !cursor.id || cursor.id.length > 100) return json({ error: 'Invalid cursor' }, 400);
                where.push('(created_at<? OR (created_at=? AND id<?))');
                values.push(Number(cursor.createdAt), Number(cursor.createdAt), cursor.id);
            }
            const rows = (await db.prepare(fields+(where.length ? ' WHERE '+where.join(' AND ') : '')+' ORDER BY created_at DESC,id DESC LIMIT ?').bind(...values, Number(limit)+1).all<{ id: string; created_at: number }>()).results;
            const jobs = rows.slice(0, Number(limit)), last = jobs.at(-1);
            return json({ settings, jobs, nextCursor: rows.length > Number(limit) && last ? { createdAt: last.created_at, id: last.id } : null });
        }
        if (body.action === 'resolve') {
            if (typeof body.id !== 'string' || !body.id || body.id.length > 100 || !['sent', 'skipped'].includes(String(body.status))) return json({ error: 'Invalid resolution' }, 400);
            const detail = body.status === 'sent' ? 'Operator verified delivery in Messages' : 'Operator discarded after review';
            const r = await db.prepare("UPDATE notification_outbox SET status=?,detail=?,lease_token=NULL,lease_until=0 WHERE id=? AND status='needs_review'").bind(body.status, detail, body.id).run();
            return json({ updated: !!r.meta.changes });
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
