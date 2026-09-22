import { GameError, assert, createGame, expireGame, transition, type Game, type PlayerId, type Player, type Room, type Score } from '../game';
import { presenceStatus, leaderboard, type ResultSummary } from '../club';
import type { Series } from '../series';
const seriesColumns = 'id,player_one AS playerOne,player_two AS playerTwo,best_of AS bestOf,minutes,increment,status,one_wins AS oneWins,two_wins AS twoWins,draws,winner,version,created_at AS createdAt,finished_at AS finishedAt';
type Row = { state: string; version: number };
const parse = (r: Row): Game => ({ ...JSON.parse(r.state), version: r.version });
const participant = "(json_extract(state,'$.white')=? OR json_extract(state,'$.black')=?)";
const finished = "json_extract(state,'$.status')='finished'";
const zero = (): Score => ({ wins: 0, losses: 0, draws: 0 });
export class Store {
    constructor(private db: D1Database, private onChange: (game: Game) => void = () => {}) { }
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
        this.onChange(saved);
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
    async seriesFor(me: string, game?: Game | null) {
        const seat = await this.db.prepare('SELECT series_id FROM series_seats WHERE player_id=?').bind(me).first<{series_id:string}>();
        const id = seat?.series_id || game?.seriesId;
        return id ? this.db.prepare(`SELECT ${seriesColumns} FROM series WHERE id=? AND (player_one=? OR player_two=?)`).bind(id,me,me).first<Series>() : null;
    }
    async roster(): Promise<Player[]> {
        const now = Date.now();
        const rows = await this.db.prepare(`SELECT p.id,p.name,p.character,
            (gs.player_id IS NOT NULL OR ss.player_id IS NOT NULL) AS busy,
            COALESCE(json_extract(g.state,'$.status'),CASE WHEN ss.player_id IS NOT NULL THEN 'series' END) AS activity,
            (SELECT MAX(pp.last_seen) FROM player_presence pp JOIN sessions s ON s.token_hash=pp.token_hash WHERE s.player_id=p.id AND s.expires>?) AS lastSeen
            FROM players p LEFT JOIN game_seats gs ON gs.player_id=p.id LEFT JOIN games g ON g.id=gs.game_id
            LEFT JOIN series_seats ss ON ss.player_id=p.id ORDER BY p.name,p.id`).bind(now).all<Player & {lastSeen:number|null}>();
        return rows.results.map(({lastSeen,...p}) => ({...p,busy:!!p.busy,presence:presenceStatus(lastSeen,now)}));
    }
    async club() {
        const [players, results] = await Promise.all([this.roster(),this.db.prepare(`SELECT id,json_extract(state,'$.white') AS white,json_extract(state,'$.black') AS black,json_extract(state,'$.winner') AS winner,finished_at AS finishedAt FROM games WHERE ${finished}`).all<ResultSummary>()]);
        return {players,leaders:leaderboard(players,results.results)};
    }
    async room(me: PlayerId): Promise<Room> {
        const game = await this.current(me);
        // One D1 round trip for the slower roster/history view; live moves skip this entirely.
        const [history, totals, pairs] = await this.db.batch([
            this.db.prepare(`SELECT state,version FROM games WHERE ${participant} AND ${finished} ORDER BY finished_at DESC,rowid DESC LIMIT 20`).bind(me, me),
            this.db.prepare(`WITH results AS (
                SELECT json_extract(state,'$.white') AS white,json_extract(state,'$.black') AS black,json_extract(state,'$.winner') AS winner FROM games WHERE ${finished}
            ), entries AS (SELECT white AS player,winner FROM results UNION ALL SELECT black AS player,winner FROM results)
            SELECT player,SUM(winner=player) AS wins,SUM(winner IS NOT NULL AND winner<>player) AS losses,SUM(winner IS NULL) AS draws FROM entries GROUP BY player`),
            this.db.prepare(`SELECT CASE WHEN json_extract(state,'$.white')=? THEN json_extract(state,'$.black') ELSE json_extract(state,'$.white') END AS rival,
                SUM(json_extract(state,'$.winner')=?) AS wins,
                SUM(json_extract(state,'$.winner') IS NOT NULL AND json_extract(state,'$.winner')<>?) AS losses,
                SUM(json_extract(state,'$.winner') IS NULL) AS draws FROM games WHERE ${participant} AND ${finished} GROUP BY rival`).bind(me, me, me, me, me)
        ]);
        const [players, series] = await Promise.all([this.roster(), this.seriesFor(me, game)]);
        const recent = (history.results as Row[]).map(parse);
        const stats: Record<string, Score> = Object.fromEntries(players.map(p => [p.id, zero()]));
        for (const t of totals.results as (Score & { player: string })[]) stats[t.player] = { wins: t.wins || 0, losses: t.losses || 0, draws: t.draws || 0 };
        const headToHead: Record<string, Score> = Object.fromEntries(players.filter(p => p.id !== me).map(p => [p.id, zero()]));
        for (const p of pairs.results as (Score & { rival: string })[]) headToHead[p.rival] = { wins: p.wins || 0, losses: p.losses || 0, draws: p.draws || 0 };
        return { me, players, game, series, recent, stats, headToHead, serverNow: Date.now() };
    }
    async create(me: PlayerId, rival: unknown, minutes: number, increment: number, bestOf = 1, series?: Series) {
        assert([1,3,5].includes(bestOf), 'Choose a single game, best of 3, or best of 5.');
        assert(typeof rival === 'string' && rival !== me && rival.length <= 64, 'Choose another player.');
        assert(await this.db.prepare('SELECT id FROM players WHERE id=?').bind(rival).first(), 'That player was not found.', 404);
        for (const player of [me, rival]) {
            const current = await this.current(player);
            if (current && ['pending', 'active'].includes(current.status))
                throw new GameError(player === me ? 'Finish or cancel your current game first.' : 'That rival already has a game or challenge. Try another rival.', 409);
        }
        if (!series) {
            const reserved = await this.db.prepare('SELECT player_id FROM series_seats WHERE player_id IN (?,?)').bind(me,rival).first();
            assert(!reserved,'Finish or end the current series first.',409);
        }
        const last = await this.db.prepare(`SELECT state,version FROM games WHERE ${participant} AND ${participant} AND json_extract(state,'$.status')<>'cancelled' ORDER BY created_at DESC,rowid DESC LIMIT 1`).bind(me, me, rival, rival).first<Row>();
        const previous = last ? parse(last) : null;
        const nextWhite = previous ? (previous.white === me ? rival : me) : me;
        const g = createGame(me, rival, minutes, increment, Date.now(), nextWhite);
        if (series || bestOf !== 1) { g.seriesId = series?.id || crypto.randomUUID(); g.seriesRound = series ? series.oneWins+series.twoWins+1 : 1; }
        try {
            if (series) {
                const result = await this.db.prepare(`INSERT INTO games(id,active_key,state,version,created_at,finished_at)
                    SELECT ?,1,?,0,?,NULL WHERE EXISTS (SELECT 1 FROM series WHERE id=? AND version=? AND status='active')`)
                    .bind(g.id,JSON.stringify(g),g.createdAt,series.id,series.version).run();
                assert(result.meta.changes,'The series changed. Refresh and try again.',409);
            } else if (bestOf !== 1) {
                await this.db.batch([
                    this.db.prepare('INSERT INTO series(id,player_one,player_two,best_of,minutes,increment,created_at) VALUES(?,?,?,?,?,?,?)').bind(g.seriesId!,me,rival,bestOf,minutes,increment,g.createdAt),
                    this.db.prepare('INSERT INTO games(id,active_key,state,version,created_at,finished_at) VALUES (?,1,?,0,?,NULL)').bind(g.id,JSON.stringify(g),g.createdAt)
                ]);
            } else await this.db.prepare('INSERT INTO games(id,active_key,state,version,created_at,finished_at) VALUES (?,1,?,0,?,NULL)').bind(g.id, JSON.stringify(g), g.createdAt).run();
        } catch (e) {
            if (/UNIQUE|series seat|invalid series/.test(String(e))) throw new GameError('One of you just joined another challenge or series. Your board has refreshed.', 409);
            throw e;
        }
        this.onChange(g);
        return g;
    }
    async seriesAction(me: string, action: string, body: Record<string,unknown>) {
        assert(typeof body.seriesId === 'string' && Number.isInteger(body.seriesVersion),'A current series is required.');
        const series = await this.seriesFor(me);
        assert(series && series.id === body.seriesId,'Series not found.',404);
        assert(series.version === body.seriesVersion && series.status === 'active','The series changed. Refresh and try again.',409);
        if (action === 'nextRound') return this.create(me,series.playerOne === me ? series.playerTwo : series.playerOne,series.minutes,series.increment,series.bestOf,series);
        for (const id of [series.playerOne,series.playerTwo]) await this.current(id);
        const active = await this.db.prepare("SELECT id FROM games WHERE json_extract(state,'$.seriesId')=? AND json_extract(state,'$.status')='active'").bind(series.id).first();
        assert(!active,'Finish the active game before ending the series.',409);
        const result = await this.db.prepare("UPDATE series SET status='cancelled',finished_at=?,version=version+1 WHERE id=? AND version=? AND status='active'").bind(Date.now(),series.id,series.version).run();
        assert(result.meta.changes,'The series changed. Refresh and try again.',409);
        const game = await this.current(me); if (game) this.onChange(game);
        return game;
    }
    async act(me: PlayerId, action: string, body: Record<string, unknown>) {
        assert(typeof body.gameId === 'string' && body.gameId.length <= 64 && Number.isInteger(body.version), 'A current game and version are required.');
        const g = await this.get(body.gameId);
        assert(g, 'Game not found.', 404);
        assert(g.white === me || g.black === me, 'You are not a player in this game.', 403);
        assert(g.version === body.version, 'The game changed. Your board has refreshed; try again.', 409);
        const next = transition(g, me, action, body);
        delete next.delivery;
        if (action === 'move' && next.moves.length === g.moves.length+1 && typeof body.moveId === 'string' && /^[a-f0-9-]{36}$/.test(body.moveId)) next.delivery = {id:body.moveId,player:me};
        return await this.save(g, next);
    }
    async rename(me: PlayerId, name: unknown) {
        assert(typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 24 && !/[\x00-\x1f]/.test(name), 'Use a name between 1 and 24 characters.');
        await this.db.prepare('UPDATE players SET name=? WHERE id=?').bind(name.trim(), me).run();
    }
    async exportClubData(me:string) {
        const [series,puzzles] = await this.db.batch([
            this.db.prepare(`SELECT ${seriesColumns} FROM series WHERE player_one=? OR player_two=? ORDER BY created_at`).bind(me,me),
            this.db.prepare('SELECT id,game_id AS gameId,ply,fen,solution,loss,depth,created_at AS createdAt,solved_at AS solvedAt,attempts FROM practice_puzzles WHERE player_id=? ORDER BY created_at').bind(me)
        ]);
        return {seriesHistory:series.results,practicePuzzles:puzzles.results};
    }
    async export(me: PlayerId) {
        return (await this.db.prepare(`SELECT state,version FROM games WHERE ${participant} ORDER BY created_at,rowid`).bind(me, me).all<Row>()).results.map(parse);
    }
}
