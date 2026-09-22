import { clockMs, type Game } from './game';

// A healthy socket delivers moves immediately. HTTP still recovers missed
// updates and settles clocks, including a scheduled check at the flag time.
export function roomPollDelay(game: Game | null, live: boolean, hidden: boolean, serverNow: number): number {
    if (hidden) return 5000;
    if (!live) return game?.status === 'active' ? 350 : 1500;
    if (game?.status === 'active') {
        const remaining = clockMs(game, game.fen.split(' ')[1] === 'w' ? 'w' : 'b', serverNow);
        return Math.min(5000, Math.max(250, remaining + 80));
    }
    return 5000;
}
