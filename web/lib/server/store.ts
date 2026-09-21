import { GameError, assert, createGame, expireGame, transition, type Game, type PlayerId, type Player, type Room, type Score } from '../game';
type Row = { state: string; version: number };
const parse = (r: Row): Game => ({ ...JSON.parse(r.state), version: r.version });
const participant = "(json_extract(state,'$.white')=? OR json_extract(state,'$.black')=?)";
const finished = "json_extract(state,'$.status')='finished'";
const zero = (): Score => ({ wins: 0, losses: 0, draws: 0 });
export class Store {
    constructor(private db: D1Database) { }
    async get(id: string) {
        const r = await this.db.prepare('SELECT state,version FROM games WHERE id=?').bind(id).first<Row>();
        return r ? parse(r) : null;
    }
    async save(previous: Game, next: Game) {
        const version = previous.version + 1;
        const saved = { ...next, version };
        // Database triggers release both occupied seats atomically with the terminal result.
        const r = await this.db.prepare('UPDATE games SET state=?,version=?,active_key=?,finished_at=? WHERE id=? AND version=?')
            .bind(JSON.stringify(saved), version, ['pending', 'active'].includes(saved.status) ? 1 : null, saved.finishedAt, saved.id, previous.version).run();
        if (!r.meta.changes) throw new GameError('The game changed. Your board has refreshed; try again.', 409);
        return saved;
    }
    async settle(g: Game) {
        const next = expireGame(g);
        if (next !== g) {
            try { return await this.save(g, next); }
            catch (e) {
                if (e instanceof GameError && e.status === 409) return await this.get(g.id);
                throw e;
            }
        }
        return g;
    }
    async current(me: PlayerId) {
        const r = await this.db.prepare('SELECT state,version FROM games JOIN game_seats ON games.id=game_seats.game_id WHERE game_seats.player_id=?').bind(me).first<Row>();
        if (r) return await this.settle(parse(r));
        const latest = await this.db.prepare(`SELECT state,version FROM games WHERE ${participant} ORDER BY created_at DESC,rowid DESC LIMIT 1`).bind(me, me).first<Row>();
        return latest ? parse(latest) : null;
    }
    async room(me: PlayerId): Promise<Room> {
        const game = await this.current(me);
        const roster = (await this.db.prepare('SELECT players.id,players.name,game_seats.player_id IS NOT NULL AS busy FROM players LEFT JOIN game_seats ON players.id=game_seats.player_id ORDER BY players.name,players.id').all<Player>()).results;
        const players = roster.map(p => ({ ...p, busy: !!p.busy }));
        const recent = (await this.db.prepare(`SELECT state,version FROM games WHERE ${participant} AND ${finished} ORDER BY finished_at DESC,rowid DESC LIMIT 20`).bind(me, me).all<Row>()).results.map(parse);
        // Each result contributes to exactly its two participants, never every club member.
        const totals = (await this.db.prepare(`WITH results AS (
            SELECT json_extract(state,'$.white') AS white,json_extract(state,'$.black') AS black,json_extract(state,'$.winner') AS winner FROM games WHERE ${finished}
        ), entries AS (
            SELECT white AS player,winner FROM results UNION ALL SELECT black AS player,winner FROM results
        ) SELECT player,SUM(winner=player) AS wins,SUM(winner IS NOT NULL AND winner<>player) AS losses,SUM(winner IS NULL) AS draws FROM entries GROUP BY player`).all<Score & { player: string }>()).results;
        const stats: Record<string, Score> = Object.fromEntries(players.map(p => [p.id, zero()]));
        for (const t of totals) stats[t.player] = { wins: t.wins || 0, losses: t.losses || 0, draws: t.draws || 0 };
        const pairs = (await this.db.prepare(`SELECT CASE WHEN json_extract(state,'$.white')=? THEN json_extract(state,'$.black') ELSE json_extract(state,'$.white') END AS rival,
            SUM(json_extract(state,'$.winner')=?) AS wins,
            SUM(json_extract(state,'$.winner') IS NOT NULL AND json_extract(state,'$.winner')<>?) AS losses,
            SUM(json_extract(state,'$.winner') IS NULL) AS draws FROM games WHERE ${participant} AND ${finished} GROUP BY rival`)
            .bind(me, me, me, me, me).all<Score & { rival: string }>()).results;
        const headToHead: Record<string, Score> = Object.fromEntries(players.filter(p => p.id !== me).map(p => [p.id, zero()]));
        for (const p of pairs) headToHead[p.rival] = { wins: p.wins || 0, losses: p.losses || 0, draws: p.draws || 0 };
        return { me, players, game, recent, stats, headToHead, serverNow: Date.now() };
    }
    async create(me: PlayerId, rival: unknown, minutes: number, increment: number) {
        assert(typeof rival === 'string' && rival !== me && rival.length <= 64, 'Choose another player.');
        assert(await this.db.prepare('SELECT id FROM players WHERE id=?').bind(rival).first(), 'That player was not found.', 404);
        for (const player of [me, rival]) {
            const current = await this.current(player);
            if (current && ['pending', 'active'].includes(current.status))
                throw new GameError(player === me ? 'Finish or cancel your current game first.' : 'That rival already has a game or challenge. Try another rival.', 409);
        }
        const last = await this.db.prepare(`SELECT state,version FROM games WHERE ${participant} AND ${participant} AND json_extract(state,'$.status')<>'cancelled' ORDER BY created_at DESC,rowid DESC LIMIT 1`).bind(me, me, rival, rival).first<Row>();
        const previous = last ? parse(last) : null;
        const nextWhite = previous ? (previous.white === me ? rival : me) : me;
        const g = createGame(me, rival, minutes, increment, Date.now(), nextWhite);
        try {
            // The INSERT trigger reserves both player IDs. A seat conflict rolls back the entire insert.
            await this.db.prepare('INSERT INTO games(id,active_key,state,version,created_at,finished_at) VALUES (?,1,?,0,?,NULL)').bind(g.id, JSON.stringify(g), g.createdAt).run();
        } catch (e) {
            if (String(e).includes('UNIQUE')) throw new GameError('One of you just joined another challenge. Your board has refreshed.', 409);
            throw e;
        }
        return g;
    }
    async act(me: PlayerId, action: string, body: Record<string, unknown>) {
        assert(typeof body.gameId === 'string' && body.gameId.length <= 64 && Number.isInteger(body.version), 'A current game and version are required.');
        const g = await this.get(body.gameId);
        assert(g, 'Game not found.', 404);
        assert(g.white === me || g.black === me, 'You are not a player in this game.', 403);
        assert(g.version === body.version, 'The game changed. Your board has refreshed; try again.', 409);
        return await this.save(g, transition(g, me, action, body));
    }
    async rename(me: PlayerId, name: unknown) {
        assert(typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 24 && !/[\x00-\x1f]/.test(name), 'Use a name between 1 and 24 characters.');
        await this.db.prepare('UPDATE players SET name=? WHERE id=?').bind(name.trim(), me).run();
    }
    async export(me: PlayerId) {
        return (await this.db.prepare(`SELECT state,version FROM games WHERE ${participant} ORDER BY created_at,rowid`).bind(me, me).all<Row>()).results.map(parse);
    }
}
