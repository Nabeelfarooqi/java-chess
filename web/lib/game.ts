import { Chess, type Square } from 'chess.js';
export type PlayerId = 'one' | 'two';
export type Player = {
    id: PlayerId;
    name: string;
};
export type Game = {
    id: string;
    version: number;
    status: 'pending' | 'active' | 'finished' | 'cancelled';
    challenger: PlayerId;
    white: PlayerId;
    black: PlayerId;
    minutes: number;
    increment: number;
    whiteMs: number;
    blackMs: number;
    turnAt: number;
    createdAt: number;
    finishedAt: number | null;
    moves: string[];
    fen: string;
    winner: PlayerId | null;
    reason: string;
    drawOffer: PlayerId | null;
};
export type Room = {
    me: PlayerId;
    players: Player[];
    game: Game | null;
    recent: Game[];
    stats: Record<PlayerId, {
        wins: number;
        losses: number;
        draws: number;
    }>;
    serverNow: number;
};
export const opponent = (p: PlayerId): PlayerId => p === 'one' ? 'two' : 'one';
export class GameError extends Error {
    status: number;
    constructor(message: string, status = 400) { super(message); this.status = status; }
}
export function assert(ok: unknown, message: string, status = 400): asserts ok { if (!ok)
    throw new GameError(message, status); }
export function replay(g: Game) { const chess = new Chess(); for (const m of g.moves)
    chess.move(m); return chess; }
export function createGame(player: PlayerId, minutes: number, increment: number, now = Date.now(), white: PlayerId = player): Game {
    assert([1, 3, 5, 10].includes(minutes), 'Choose 1, 3, 5, or 10 minutes.');
    assert([0, 2].includes(increment), 'Choose 0 or 2 seconds of increment.');
    return { id: crypto.randomUUID(), version: 0, status: 'pending', challenger: player, white, black: opponent(white), minutes, increment, whiteMs: minutes * 60000, blackMs: minutes * 60000, turnAt: 0, createdAt: now, finishedAt: null, moves: [], fen: new Chess().fen(), winner: null, reason: '', drawOffer: null };
}
function finish(g: Game, winner: PlayerId | null, reason: string, now: number) { g.status = 'finished'; g.winner = winner; g.reason = reason; g.finishedAt = now; g.drawOffer = null; }
// Online-room convention: time is a draw when the non-flagging side has only a king,
// a lone bishop/knight, or bishops confined to one color. No lag compensation.
export function hasMatingMaterial(chess: Chess, color: 'w' | 'b') {
    const pieces = chess.board().flat().filter(p => p && p.color === color && p.type !== 'k');
    if (pieces.some(p => p && ['p', 'r', 'q'].includes(p.type)))
        return true;
    if (pieces.length < 2)
        return false;
    if (pieces.every(p => p?.type === 'b'))
        return new Set(pieces.map(p => (p!.square.charCodeAt(0) + Number(p!.square[1])) % 2)).size > 1;
    return true;
}
export function expireGame(original: Game, now = Date.now()): Game {
    if (original.status === 'pending' && now - original.createdAt >= 15 * 60000)
        return { ...original, status: 'cancelled', reason: 'Challenge expired', finishedAt: now };
    if (original.status !== 'active')
        return original;
    const g = { ...original };
    const white = g.fen.split(' ')[1] === 'w';
    const remaining = (white ? g.whiteMs : g.blackMs) - (now - g.turnAt);
    if (remaining > 0)
        return original;
    if (white)
        g.whiteMs = 0;
    else
        g.blackMs = 0;
    const winner = white ? g.black : g.white;
    const chess = replay(g);
    finish(g, hasMatingMaterial(chess, white ? 'b' : 'w') ? winner : null, 'Time expired', now);
    return g;
}
export function transition(original: Game, player: PlayerId, action: string, body: Record<string, unknown>, now = Date.now()): Game {
    assert(original.white === player || original.black === player, 'You are not a player in this game.', 403);
    const expired = expireGame(original, now);
    if (expired !== original)
        return expired;
    const g = { ...original, moves: [...original.moves] };
    if (action === 'accept') {
        assert(g.status === 'pending', 'This challenge is no longer waiting.', 409);
        assert(player !== g.challenger, 'Your friend needs to accept this challenge.');
        g.status = 'active';
        g.turnAt = now;
        return g;
    }
    if (action === 'cancel') {
        assert(g.status === 'pending', 'An active game cannot be cancelled.', 409);
        g.status = 'cancelled';
        g.reason = player === g.challenger ? 'Challenge cancelled' : 'Challenge declined';
        g.finishedAt = now;
        return g;
    }
    assert(g.status === 'active', 'This game is not active.', 409);
    if (action === 'resign') {
        finish(g, opponent(player), 'Resignation', now);
        return g;
    }
    if (action === 'offerDraw') {
        assert(!g.drawOffer, 'A draw offer is already pending.');
        g.drawOffer = player;
        return g;
    }
    if (action === 'acceptDraw') {
        assert(g.drawOffer === opponent(player), 'There is no draw offer to accept.');
        finish(g, null, 'Draw by agreement', now);
        return g;
    }
    if (action === 'declineDraw') {
        assert(g.drawOffer === opponent(player), 'There is no draw offer to decline.');
        g.drawOffer = null;
        return g;
    }
    assert(action === 'move', 'Unknown game action.');
    const chess = replay(g);
    const white = chess.turn() === 'w';
    assert((white ? g.white : g.black) === player, 'Wait for your turn.', 409);
    assert(typeof body.from === 'string' && /^[a-h][1-8]$/.test(body.from) && typeof body.to === 'string' && /^[a-h][1-8]$/.test(body.to), 'Choose valid squares.');
    assert(body.promotion === undefined || ['q', 'r', 'b', 'n'].includes(String(body.promotion)), 'Choose a valid promotion.');
    let move;
    try {
        move = chess.move({ from: body.from as Square, to: body.to as Square, promotion: body.promotion as string | undefined });
    }
    catch {
        throw new GameError('That move is not legal.');
    }
    const spent = Math.max(0, now - g.turnAt);
    if (white)
        g.whiteMs = Math.max(0, g.whiteMs - spent) + g.increment * 1000;
    else
        g.blackMs = Math.max(0, g.blackMs - spent) + g.increment * 1000;
    g.turnAt = now;
    g.moves.push(move.san);
    g.fen = chess.fen();
    if (g.drawOffer === opponent(player))
        g.drawOffer = null;
    if (chess.isCheckmate())
        finish(g, player, 'Checkmate', now);
    else if (chess.isStalemate())
        finish(g, null, 'Stalemate', now);
    else if (chess.isInsufficientMaterial())
        finish(g, null, 'Insufficient material', now);
    else if (chess.isThreefoldRepetition())
        finish(g, null, 'Threefold repetition', now);
    else if (chess.isDrawByFiftyMoves())
        finish(g, null, '50-move rule', now);
    return g;
}
export function clockMs(g: Game, color: 'w' | 'b', now: number) { const base = color === 'w' ? g.whiteMs : g.blackMs; return Math.max(0, base - (g.status === 'active' && g.fen.split(' ')[1] === color ? Math.max(0, now - g.turnAt) : 0)); }
export function pgn(g: Game, players: Player[]) { const c = replay(g); c.setHeader('Event', 'Rival Room'); c.setHeader('White', players.find(p => p.id === g.white)?.name || 'Player 1'); c.setHeader('Black', players.find(p => p.id === g.black)?.name || 'Player 2'); c.setHeader('Date', new Date(g.createdAt).toISOString().slice(0, 10).replaceAll('-', '.')); c.setHeader('TimeControl', `${g.minutes * 60}+${g.increment}`); c.setHeader('Result', g.status !== 'finished' ? '*' : g.winner === g.white ? '1-0' : g.winner === g.black ? '0-1' : '1/2-1/2'); return c.pgn(); }
