import { Chess } from 'chess.js';
import { assert, type Game } from '../game';
import { uciMove } from '../review';
type Puzzle = { id:string; player_id:string; game_id:string; ply:number; fen:string; solution:string; loss:number; depth:number; created_at:number; solved_at:number|null; attempts:number };
export async function practiceGET(db:D1Database, me:string) {
    const rows = await db.prepare('SELECT id,game_id AS gameId,ply,fen,loss,depth,created_at AS createdAt,solved_at AS solvedAt,attempts FROM practice_puzzles WHERE player_id=? ORDER BY solved_at IS NOT NULL,created_at DESC LIMIT 100').bind(me).all();
    return {puzzles:rows.results};
}
export async function practicePOST(db:D1Database, me:string, body:Record<string,unknown>) {
    if (body.action === 'practiceSave') {
        assert(typeof body.gameId === 'string' && Array.isArray(body.items) && body.items.length>0 && body.items.length<=40,'Choose up to 40 reviewed mistakes.');
        const row = await db.prepare('SELECT state FROM games WHERE id=?').bind(body.gameId).first<{state:string}>();
        assert(row,'Game not found.',404);
        const game = JSON.parse(row.state) as Game;
        assert(game.white===me || game.black===me,'This is not your game.',403);
        assert(game.status==='finished','Practice is available after the game.',409);
        const chess = new Chess(), moves = game.moves.map(san=>chess.move(san));
        const seen = new Set<number>();
        const statements = body.items.map(item=>{
            assert(item && typeof item==='object','Invalid reviewed move.');
            const {ply,solution,loss,depth} = item;
            assert(Number.isInteger(ply) && ply>=0 && ply<moves.length && !seen.has(ply),'Invalid or repeated move.'); seen.add(ply);
            const actual = moves[ply];
            assert((actual.color==='w'?game.white:game.black)===me,'Save your own mistakes only.',403);
            assert(typeof solution==='string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(solution),'Invalid engine move.');
            assert(solution!==actual.from+actual.to+(actual.promotion||''),'That move was already played.');
            assert(Number.isInteger(loss) && loss>=100 && loss<=20000 && Number.isInteger(depth) && depth>=1 && depth<=128,'Invalid review evaluation.');
            let legal = false; try { legal = !!new Chess(actual.before).move(uciMove(solution)); } catch {}
            assert(legal,'The engine move is not legal.');
            return db.prepare(`INSERT INTO practice_puzzles(id,player_id,game_id,ply,fen,solution,loss,depth,created_at) VALUES(?,?,?,?,?,?,?,?,?)
                ON CONFLICT(player_id,game_id,ply) DO UPDATE SET solution=excluded.solution,loss=excluded.loss,depth=excluded.depth,
                solved_at=CASE WHEN practice_puzzles.solution=excluded.solution THEN practice_puzzles.solved_at ELSE NULL END
                WHERE excluded.depth>=practice_puzzles.depth`).bind(crypto.randomUUID(),me,game.id,ply,actual.before,solution,loss,depth,Date.now());
        });
        await db.batch(statements);
        return {saved:statements.length};
    }
    assert(['practiceAttempt','practiceHint','practiceReveal'].includes(String(body.action)),'Unknown practice action.');
    assert(typeof body.id==='string','Choose a puzzle.');
    const puzzle = await db.prepare('SELECT * FROM practice_puzzles WHERE id=? AND player_id=?').bind(body.id,me).first<Puzzle>();
    assert(puzzle,'Puzzle not found.',404);
    if (body.action==='practiceHint') return {from:puzzle.solution.slice(0,2)};
    const san = new Chess(puzzle.fen).move(uciMove(puzzle.solution)).san;
    if (body.action==='practiceReveal') return {solution:puzzle.solution,san};
    assert(typeof body.move==='string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(body.move),'Choose a legal move.');
    let legal = false; try { legal = !!new Chess(puzzle.fen).move(uciMove(body.move)); } catch {} assert(legal,'Choose a legal move.');
    const correct = body.move===puzzle.solution;
    await db.prepare('UPDATE practice_puzzles SET attempts=attempts+1,solved_at=CASE WHEN ? THEN COALESCE(solved_at,?) ELSE solved_at END WHERE id=? AND player_id=?').bind(correct?1:0,Date.now(),puzzle.id,me).run();
    return {correct,...(correct?{san}:{})};
}
