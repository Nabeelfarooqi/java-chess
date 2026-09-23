'use client';
import { memo, useId } from 'react';
import type { Color, Square } from 'chess.js';
import type { Evaluation, ReviewedMove } from '@/lib/review';
import { formatEvaluation } from '@/lib/review';
import { evaluationPercent, reviewSummary } from '@/lib/review-workspace';
import type { Player } from '@/lib/game';
import { CharacterPortrait } from './character-art';

export function ReviewPlayer({ player, color, rows, me }: { player?: Player; color: Color; rows: (ReviewedMove | undefined)[]; me: string }) {
    const summary = reviewSummary(rows, color);
    return <div className="review-player"><div className="review-player-name"><CharacterPortrait character={player?.character} name={player?.name}/><div><strong>{player?.name || 'Player'}{player?.id === me && <small>You</small>}</strong><span>{color === 'w' ? 'White' : 'Black'} · {summary.analyzed} reviewed</span></div></div>
        <div className="review-player-stats"><span><b>{summary.best}</b>Best</span><span><b>{summary.mistakes}</b>Mistakes</span><span><b>{summary.blunders}</b>Blunders</span><span title="Average loss in pawns, excluding positions with a detected mate"><b>{summary.averageLoss === null ? '—' : (summary.averageLoss / 100).toFixed(2)}</b>Avg. loss</span></div></div>;
}

export const ReviewGraph = memo(function ReviewGraph({ evaluations, total, position, onSelect }: { evaluations: (Evaluation | undefined)[]; total: number; position: number; onSelect: (position: number) => void }) {
    let path = '', previous = -2;
    evaluations.forEach((evaluation, index) => {
        if (!evaluation) return;
        path += `${index === previous + 1 ? 'L' : 'M'}${(index / Math.max(total, 1) * 600).toFixed(2)},${(100 - evaluationPercent(evaluation)).toFixed(2)} `; previous = index;
    });
    const selected = evaluations[position];
    return <div className="review-graph"><div className="review-section-label"><strong>How the game shifted</strong><span>{selected ? formatEvaluation(selected) : 'Not analyzed'} <small>White’s view</small></span></div>
        <div className="review-graph-plot"><svg viewBox="0 -5 600 110" preserveAspectRatio="none" aria-hidden="true"><rect width="600" height="50" fill="#e8efce" opacity=".07"/><path d="M0 50H600" stroke="#75816c" strokeDasharray="4 4"/><path d={path} fill="none" stroke="#d6ec8c" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/><path d={`M${position / Math.max(total, 1) * 600} -5V105`} stroke="#fff" strokeOpacity=".65" vectorEffect="non-scaling-stroke"/></svg>
        <input type="range" min={0} max={total} value={position} aria-label="Review timeline" aria-valuetext={`${position === 0 ? 'Starting position' : `After move ${Math.ceil(position / 2)}, ${position % 2 ? 'White' : 'Black'}`}, ${selected ? formatEvaluation(selected) : 'not analyzed'}`} onChange={e => onSelect(Number(e.target.value))}/></div>
        <div className="review-graph-axis"><span>Start</span><span>Even at center · scale ±6 pawns</span><span>Finish</span></div></div>;
});

export function ReviewArrows({ orientation, best, played }: { orientation: Color; best?: string; played?: { from: Square; to: Square } }) {
    const id = useId().replaceAll(':', '');
    const point = (square: string) => { const x = square.charCodeAt(0) - 97, y = 8 - Number(square[1]); return orientation === 'w' ? [x + .5, y + .5] : [7.5 - x, 7.5 - y]; };
    const arrows = [...(played ? [{ from: played.from, to: played.to, color: '#ffb56b', key: 'played' }] : []), ...(best && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(best) ? [{ from: best.slice(0, 2), to: best.slice(2, 4), color: '#3ee6c3', key: 'best' }] : [])];
    return <svg className="review-board-arrows" viewBox="0 0 8 8" aria-hidden="true"><defs>{arrows.map(a => <marker key={a.key} id={`${id}-${a.key}`} markerWidth="2.5" markerHeight="2.5" refX="1.9" refY="1.25" orient="auto"><path d="M0 0L2.5 1.25L0 2.5Z" fill={a.color}/></marker>)}</defs>{arrows.map(a => { const [x1, y1] = point(a.from), [x2, y2] = point(a.to); return <line key={a.key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={a.color} strokeWidth=".12" opacity=".9" markerEnd={`url(#${id}-${a.key})`}/>; })}</svg>;
}
