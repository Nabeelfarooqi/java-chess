'use client';
import { memo, useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { clockMs, type Game } from '@/lib/game';
const format = (ms: number, ticking: boolean) => {
    if (ticking && ms < 10000) return (Math.max(0, ms) / 1000).toFixed(1);
    const seconds = Math.ceil(ms / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
export const PlayerClock = memo(function PlayerClock({ game, color, offset, minutes }: { game: Game | null; color: 'w' | 'b'; offset: number; minutes: number }) {
    const [now, setNow] = useState(Date.now());
    const ticking = game?.status === 'active' && game.fen.split(' ')[1] === color;
    useEffect(() => { setNow(Date.now()); if (!ticking) return; const timer = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(timer); }, [ticking, game?.turnAt]);
    const ms = game ? clockMs(game, color, (ticking ? now : Date.now()) + offset) : minutes * 60000;
    return <div className={`clock ${ticking ? 'ticking' : ''} ${ms < 10000 && game?.status === 'active' ? 'urgent' : ''}`}><Clock3 size={17}/>{format(ms, !!ticking)}</div>;
});
