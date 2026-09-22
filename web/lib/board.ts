import { Chess, type Square, type Color } from 'chess.js';
import { clockMs, type Game, type PlayerId } from './game';
export type BoardMove = { from: Square; to: Square; promotion?: 'q' | 'r' | 'b' | 'n' };
export const glyph = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
export const pieceName = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
export function isCastleGesture(board: Chess, from: Square, to: Square, color: Color): boolean {
    const rank = color === 'w' ? '1' : '8';
    return from === 'e' + rank && board.get(from)?.type === 'k' && board.get(from)?.color === color
        && ['a', 'c', 'g', 'h'].some(file => to === file + rank);
}
// Both king-to-destination and king-to-rook gestures produce the same legal
// king move. Keep this normalization at the board boundary, before queuing.
export function boardTargets(board: Chess, from: Square, color: Color): Square[] {
    if (board.get(from)?.color !== color) return [];
    const targets = board.turn() === color ? board.moves({ square: from, verbose: true }).map(move => move.to) : premoveTargets(board, from, color);
    const rank = color === 'w' ? '1' : '8';
    if (from === 'e' + rank && board.get(from)?.type === 'k') {
        const rights = board.getCastlingRights(color);
        for (const [wing, file, rookFile] of [['k', 'g', 'h'], ['q', 'c', 'a']] as const) {
            const rook = (rookFile + rank) as Square;
            if (rights[wing] && targets.includes((file + rank) as Square) && board.get(rook)?.type === 'r' && board.get(rook)?.color === color) targets.push(rook);
        }
    }
    return [...new Set(targets)];
}
export function boardMove(board: Chess, from: Square, to: Square, color: Color): BoardMove | null {
    if (!boardTargets(board, from, color).includes(to)) return null;
    if (isCastleGesture(board, from, to, color) && ['a', 'h'].includes(to[0])) to = ((to[0] === 'h' ? 'g' : 'c') + to[1]) as Square;
    return { from, to };
}
export function squareAt(x: number, y: number, width: number, orientation: Color): Square | null {
    if (width <= 0 || x < 0 || y < 0 || x >= width || y >= width) return null;
    const file = Math.floor(x / width * 8), row = Math.floor(y / width * 8);
    return (orientation === 'w' ? 'abcdefgh'[file] + (8 - row) : 'hgfedcba'[file] + (row + 1)) as Square;
}
// Premoves describe intent. The next authoritative position must pass chess.js before sending.
export function premoveTargets(board: Chess, from: Square, color: Color): Square[] {
    const piece = board.get(from);
    if (!piece || piece.color !== color) return [];
    const fx = from.charCodeAt(0) - 97, fy = Number(from[1]);
    const targets: Square[] = [];
    for (let x = 0; x < 8; x++) for (let y = 1; y <= 8; y++) {
        const dx = Math.abs(x - fx), dy = Math.abs(y - fy), forward = (y - fy) * (color === 'w' ? 1 : -1);
        if (!dx && !dy) continue;
        const type = piece.type;
        const valid = type === 'n' ? dx * dy === 2 : type === 'b' ? dx === dy : type === 'r' ? dx === 0 || dy === 0 : type === 'q' ? dx === dy || dx === 0 || dy === 0 : type === 'k' ? Math.max(dx, dy) === 1 || (fx === 4 && fy === (color === 'w' ? 1 : 8) && dy === 0 && dx === 2) : (forward === 1 && dx <= 1) || (dx === 0 && forward === 2 && fy === (color === 'w' ? 2 : 7));
        if (board.get(('abcdefgh'[x] + y) as Square)?.color === color) continue;
        if (valid) targets.push(('abcdefgh'[x] + y) as Square);
    }
    return targets;
}
export function legalMove(fen: string, move: BoardMove) { try { const chess = new Chess(fen); chess.move(move); return true; } catch { return false; } }
export function previewMove(g: Game, me: PlayerId, move: BoardMove, now: number): Game {
    const chess = new Chess(g.fen), color = chess.turn();
    if (g.status !== 'active' || (color === 'w' ? g.white : g.black) !== me) throw new Error('Wait for your turn.');
    const played = chess.move(move);
    const ms = clockMs(g, color, now) + g.increment * 1000;
    // Never award a result locally. Keep the version until the server acknowledges the move.
    return { ...g, fen: chess.fen(), moves: [...g.moves, played.san], turnAt: now, ...(color === 'w' ? { whiteMs: ms } : { blackMs: ms }) };
}
export function premoveReady(g: Game | null, me: PlayerId, queued: BoardMove & { gameId: string }): boolean {
    return !!g && g.id === queued.gameId && g.status === 'active' && (g.fen.split(' ')[1] === 'w' ? g.white : g.black) === me && legalMove(g.fen, queued);
}
