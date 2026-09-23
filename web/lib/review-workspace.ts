import { Chess, type Color, type Move } from 'chess.js';
import { classify, uciMove, type Evaluation, type ReviewedMove } from './review';

export const toUci = (move: Move) => move.from + move.to + (move.promotion || '');
export const moveLabel = (index: number, san: string) => `${Math.floor(index / 2) + 1}${index % 2 ? '…' : '.'} ${san}`;
// Streaming one evaluation must not re-run legal-move generation for the whole game.
// Weak keys let replaced evaluations and their classifications be garbage collected.
const classifications = new WeakMap<Evaluation, WeakMap<Evaluation, Map<string, ReviewedMove>>>();
export function reviewRows(moves: Move[], evaluations: (Evaluation | undefined)[]) {
    return moves.map((move, index) => {
        const before = evaluations[index], after = evaluations[index + 1];
        if (!before || !after) return undefined;
        let results = classifications.get(before);
        if (!results) { results = new WeakMap(); classifications.set(before, results); }
        let positions = results.get(after);
        if (!positions) { positions = new Map(); results.set(after, positions); }
        const key = move.before + ':' + toUci(move);
        let row = positions.get(key);
        if (!row) { row = classify(move, before, after); positions.set(key, row); }
        return row;
    });
}
export function reviewSummary(rows: (ReviewedMove | undefined)[], color: Color) {
    const played = rows.filter((row): row is ReviewedMove => !!row && row.move.color === color);
    const ordinary = played.filter(row => row.before.mate === null && row.after.mate === null);
    return { analyzed: played.length, best: played.filter(row => ['Best', 'Brilliant'].includes(row.quality)).length,
        inaccuracies: played.filter(row => row.quality === 'Inaccuracy').length, mistakes: played.filter(row => row.quality === 'Mistake').length,
        blunders: played.filter(row => row.quality === 'Blunder').length,
        averageLoss: ordinary.length ? ordinary.reduce((sum, row) => sum + row.loss, 0) / ordinary.length : null };
}
export function keyMoments(rows: (ReviewedMove | undefined)[], color?: Color) {
    return rows.flatMap((row, index) => row && (!color || row.move.color === color) && ['Blunder', 'Mistake', 'Inaccuracy', 'Brilliant'].includes(row.quality) ? [{ row, index }] : [])
        .sort((a, b) => b.row.loss - a.row.loss || a.index - b.index);
}
export function variationMoves(fen: string, uci: string[], max = 12): Move[] {
    const board = new Chess(fen), result: Move[] = [];
    for (const value of uci.slice(0, max)) { try { result.push(board.move(uciMove(value))); } catch { break; } }
    return result;
}
export function reviewInsight(row: ReviewedMove) {
    const reply = variationMoves(row.move.after, row.after.pv, 1)[0];
    if (new Chess(row.move.after).isCheckmate()) return 'Checkmate. The opposing king has no legal escape.';
    if (reply?.captured) return `The engine replies ${reply.san}, capturing a ${({ p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' })[reply.captured]}. Explore the response to see what follows.`;
    if (reply?.san.includes('+')) return `The engine replies ${reply.san} with check. Compare its line with the move you played.`;
    if (row.move.flags.includes('k') || row.move.flags.includes('q')) return 'Castling moves the king and rook together. Compare the resulting king safety in the suggested line.';
    return reply ? `The engine's expected reply is ${reply.san}. Play the line to inspect the continuation.` : 'This is the final analyzed position. Use the timeline to revisit the turning points.';
}
export function evaluationPercent(evaluation: Evaluation) {
    // A display scale, not a win probability. Pawn scores saturate at +/-6.
    return evaluation.mate !== null ? (evaluation.cp >= 0 ? 100 : 0) : 50 + Math.max(-600, Math.min(600, evaluation.cp)) / 12;
}
