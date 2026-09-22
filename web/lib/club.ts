import type { Player, Score } from './game';
export type ResultSummary = { white: string; black: string; winner: string | null; finishedAt: number; id: string };
export type Leader = Player & Score & { games: number; winRate: number; streak: number; bestStreak: number; mainRival: string | null; rivalry: Score | null };
export function presenceStatus(lastSeen: number | null, now: number): 'online' | 'away' | 'offline' {
    return lastSeen !== null && now - lastSeen < 45000 ? 'online' : lastSeen !== null && now - lastSeen < 180000 ? 'away' : 'offline';
}
export function leaderboard(players: Player[], results: ResultSummary[]): Leader[] {
    const ordered = [...results].sort((a, b) => b.finishedAt - a.finishedAt || b.id.localeCompare(a.id));
    return players.map(player => {
        let wins = 0, losses = 0, draws = 0, streak = 0, bestStreak = 0, run = 0, stillWinning = true;
        const pairs = new Map<string, Score>();
        for (const game of ordered) {
            if (game.white !== player.id && game.black !== player.id) continue;
            const rival = game.white === player.id ? game.black : game.white;
            const score = pairs.get(rival) || { wins: 0, losses: 0, draws: 0 };
            if (game.winner === player.id) { wins++; score.wins++; run++; if (stillWinning) streak++; }
            else { stillWinning = false; run = 0; if (game.winner) { losses++; score.losses++; } else { draws++; score.draws++; } }
            bestStreak = Math.max(bestStreak, run); pairs.set(rival, score);
        }
        const games = wins + losses + draws;
        const rivals = [...pairs].sort(([a, x], [b, y]) => (y.wins + y.losses + y.draws) - (x.wins + x.losses + x.draws) || a.localeCompare(b));
        return { ...player, wins, losses, draws, games, winRate: games ? Math.round(wins / games * 100) : 0, streak, bestStreak, mainRival: rivals[0]?.[0] || null, rivalry: rivals[0]?.[1] || null };
    }).sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.games - a.games || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
export function playerStatus(player: Player) {
    const away = player.presence === 'online' ? '' : player.presence === 'away' ? ' · away' : ' · offline';
    if (player.activity === 'active') return 'Playing' + away;
    if (player.activity === 'pending') return 'In a challenge' + away;
    if (player.activity === 'series') return 'Between rounds' + away;
    return player.presence === 'online' ? 'Available' : player.presence === 'away' ? 'Away' : 'Offline';
}
