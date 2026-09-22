import type { Chess, Color, PieceSymbol } from 'chess.js';

export const materialValue: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const capturedOrder = ['p', 'n', 'b', 'r', 'q'] as const;
export type CapturedPiece = typeof capturedOrder[number];

export function materialSummary(chess: Chess) {
    const captures: Record<Color, Record<CapturedPiece, number>> = {
        w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
        b: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    };
    for (const move of chess.history({ verbose: true })) {
        if (move.captured && move.captured !== 'k') captures[move.color][move.captured]++;
    }
    // Score the current board, not capture totals: promotion changes material too.
    const totals = { w: 0, b: 0 };
    for (const row of chess.board()) for (const piece of row) {
        if (piece) totals[piece.color] += materialValue[piece.type];
    }
    return { captures, lead: { w: Math.max(0, totals.w - totals.b), b: Math.max(0, totals.b - totals.w) } };
}
