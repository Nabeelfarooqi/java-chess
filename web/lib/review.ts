import { Chess, type Color, type Move, type Square } from 'chess.js';
export type Evaluation = { cp: number; mate: number | null; best: string; pv: string[]; depth: number };
export type Quality = 'Brilliant' | 'Best' | 'Excellent' | 'Good' | 'Inaccuracy' | 'Mistake' | 'Blunder' | 'Forced';
export type ReviewedMove = { move: Move; before: Evaluation; after: Evaluation; quality: Quality; loss: number; bestSan: string; line: string; explanation: string };
export function parseInfo(line: string, turn: Color): Evaluation | null {
    const score = /\bscore (cp|mate) (-?\d+)/.exec(line), depth = /\bdepth (\d+)/.exec(line), pv = /\bpv (.+)$/.exec(line);
    if (!score || !depth || /\b(lowerbound|upperbound)\b/.test(line)) return null;
    const sign = turn === 'w' ? 1 : -1, value = Number(score[2]);
    const mate = score[1] === 'mate' ? value * sign : null;
    return { cp: score[1] === 'cp' ? value * sign : (value >= 0 ? 10000 : -10000) * sign, mate, depth: Number(depth[1]), best: pv?.[1].split(' ')[0] || '', pv: pv?.[1].split(' ') || [] };
}
export function uciMove(value: string) { return { from: value.slice(0, 2) as Square, to: value.slice(2, 4) as Square, ...(value.length > 4 ? { promotion: value[4] } : {}) }; }
export function lineToSan(fen: string, moves: string[]) { const chess = new Chess(fen), san: string[] = []; for (const move of moves.slice(0, 6)) { try { san.push(chess.move(uciMove(move)).san); } catch { break; } } return san.join(' '); }
export function classify(move: Move, before: Evaluation, after: Evaluation): ReviewedMove {
    const sign = move.color === 'w' ? 1 : -1;
    const loss = Math.max(0, (before.cp - after.cp) * sign);
    const actual = move.from + move.to + (move.promotion || '');
    const board = new Chess(move.before), forced = board.moves().length === 1;
    const afterBoard = new Chess(move.after), values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    const capture = afterBoard.moves({ verbose: true }).some(reply => reply.to === move.to && !!reply.captured && values[reply.captured] > values[reply.piece]);
    // A conservative custom label: an engine-best, sound offer of a more valuable piece.
    const brilliant = !forced && before.best === actual && before.depth >= 12 && loss <= 25 && after.cp * sign >= -50 && values[move.piece] >= 3 && capture && !afterBoard.isCheckmate();
    const quality: Quality = forced ? 'Forced' : brilliant ? 'Brilliant' : before.best === actual || afterBoard.isCheckmate() ? 'Best' : loss >= 200 ? 'Blunder' : loss >= 100 ? 'Mistake' : loss >= 50 ? 'Inaccuracy' : loss <= 20 ? 'Excellent' : 'Good';
    const bestSan = lineToSan(move.before, [before.best]) || '—';
    let explanation = quality === 'Forced' ? 'This was the only legal move.' : quality === 'Brilliant' ? 'An engine-approved offer of a more valuable piece. This is Rival Room’s sacrifice heuristic.' : quality === 'Best' ? 'This matches the engine’s first choice or delivers checkmate.' : ['Excellent', 'Good'].includes(quality) ? 'This stayed close to the engine’s preferred evaluation.' : `The evaluation dropped by about ${(loss / 100).toFixed(1)} pawns from your side. The engine preferred ${bestSan}.`;
    if (before.mate !== null && before.cp * sign > 0 && after.cp * sign < 9000) explanation = `A forced mate was available with ${bestSan}. This move lost that mating line at the searched depth.`;
    else if (after.mate !== null && after.cp * sign < 0) explanation = `The engine sees a forced mate against this side.${before.mate === null ? ` The engine preferred ${bestSan} to avoid it.` : ' This position was already facing a forced mate at the searched depth.'}`;
    return { move, before, after, quality, loss, bestSan, line: lineToSan(move.before, before.pv), explanation };
}
export function formatEvaluation(e: Evaluation) { return e.mate !== null ? `${e.cp < 0 ? '−' : ''}M${Math.abs(e.mate)}` : `${e.cp >= 0 ? '+' : '−'}${(Math.abs(e.cp) / 100).toFixed(2)}`; }
