import { GameError, createGame, expireGame, transition, type Game, type PlayerId, type Player, type Room } from '../game';
type Row = {
    state: string;
    version: number;
};
const parse = (r: Row): Game => ({ ...JSON.parse(r.state), version: r.version });
export class Store {
    constructor(private db: D1Database) { }
    async get(id: string) { const r = await this.db.prepare('SELECT state,version FROM games WHERE id=?').bind(id).first<Row>(); return r ? parse(r) : null; }
    async save(previous: Game, next: Game) { const version = previous.version + 1; const saved = { ...next, version }; const r = await this.db.prepare('UPDATE games SET state=?,version=?,active_key=?,finished_at=? WHERE id=? AND version=?').bind(JSON.stringify(saved), version, ['pending', 'active'].includes(saved.status) ? 1 : null, saved.finishedAt, saved.id, previous.version).run(); if (!r.meta.changes)
        throw new GameError('The game changed. Your board has refreshed; try again.', 409); return saved; }
    async settle(g: Game) { const next = expireGame(g); if (next !== g) {
        try {
            return await this.save(g, next);
        }
        catch (e) {
            if (e instanceof GameError && e.status === 409)
                return await this.get(g.id);
            throw e;
        }
    } return g; }
    async current() { const r = await this.db.prepare('SELECT state,version FROM games WHERE active_key=1').first<Row>(); if (r)
        return await this.settle(parse(r)); const latest = await this.db.prepare('SELECT state,version FROM games ORDER BY created_at DESC LIMIT 1').first<Row>(); return latest ? parse(latest) : null; }
    async room(me: PlayerId): Promise<Room> {
        const game = await this.current();
        const players = (await this.db.prepare('SELECT id,name FROM players ORDER BY id').all<Player>()).results;
        const recent = (await this.db.prepare("SELECT state,version FROM games WHERE finished_at IS NOT NULL AND json_extract(state,'$.status')='finished' ORDER BY finished_at DESC LIMIT 20").all<Row>()).results.map(parse);
        const totals = (await this.db.prepare("SELECT json_extract(state,'$.winner') AS winner,COUNT(*) AS n FROM games WHERE json_extract(state,'$.status')='finished' GROUP BY json_extract(state,'$.winner')").all<{
            winner: PlayerId | null;
            n: number;
        }>()).results;
        const wins = (p: PlayerId) => totals.find(t => t.winner === p)?.n || 0;
        const draws = totals.find(t => t.winner === null)?.n || 0;
        return { me, players, game, recent, stats: { one: { wins: wins('one'), losses: wins('two'), draws }, two: { wins: wins('two'), losses: wins('one'), draws } }, serverNow: Date.now() };
    }
    async create(me: PlayerId, minutes: number, increment: number) {
        const current = await this.current();
        if (current && ['pending', 'active'].includes(current.status))
            throw new GameError('Finish or cancel the current game first.', 409);
        const nextWhite = current ? (current.white === 'one' ? 'two' : 'one') : me;
        const g = createGame(me, minutes, increment, Date.now(), nextWhite);
        try {
            await this.db.prepare('INSERT INTO games(id,active_key,state,version,created_at,finished_at) VALUES (?,1,?,0,?,NULL)').bind(g.id, JSON.stringify(g), g.createdAt).run();
        }
        catch (e) {
            if (String(e).includes('UNIQUE'))
                throw new GameError('A challenge was just created. Your board has refreshed.', 409);
            throw e;
        }
        return g;
    }
    async act(me: PlayerId, action: string, body: Record<string, unknown>) { if (typeof body.gameId !== 'string' || body.gameId.length > 64 || !Number.isInteger(body.version))
        throw new GameError('A current game and version are required.'); const g = await this.get(body.gameId); if (!g)
        throw new GameError('Game not found.', 404); if (g.version !== body.version)
        throw new GameError('The game changed. Your board has refreshed; try again.', 409); return await this.save(g, transition(g, me, action, body)); }
    async rename(me: PlayerId, name: unknown) { if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 24 || /[\x00-\x1f]/.test(name))
        throw new GameError('Use a name between 1 and 24 characters.'); await this.db.prepare('UPDATE players SET name=? WHERE id=?').bind(name.trim(), me).run(); }
    async export() { return (await this.db.prepare('SELECT state,version FROM games ORDER BY created_at').all<Row>()).results.map(parse); }
}
