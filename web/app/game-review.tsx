'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { ChevronLeft, ChevronRight, RotateCcw, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChessBoard } from './chess-board';
import { classify, formatEvaluation, type ReviewedMove } from '@/lib/review';
import { ReviewEngine } from '@/lib/review-engine';
import type { Game, Player } from '@/lib/game';
const cached = new Map<string, ReviewedMove[]>();
const noop = () => {};
export default function GameReview({ game, players, me, onClose }: { game: Game; players: Player[]; me: string; onClose: () => void }) {
    const moves = useMemo(() => { const board = new Chess(); return game.moves.map(san => board.move(san)); }, [game.id, game.moves]);
    const [rows, setRows] = useState<ReviewedMove[]>(cached.get(game.id) || []), [index, setIndex] = useState(0), [running, setRunning] = useState(false), [error, setError] = useState('');
    const engine = useRef<ReviewEngine | null>(null), generation = useRef(0);
    const name = (id: string) => players.find(p => p.id === id)?.name || 'Player';
    const selected = rows[index], displayed = moves[index];
    const stop = () => { generation.current++; engine.current?.close(); engine.current = null; setRunning(false); };
    async function analyze(ms: number) {
        stop();
        if (game.status !== 'finished' || !moves.length) return;
        const run = generation.current;
        setRows([]); setError(''); setRunning(true);
        let worker: ReviewEngine | null = null;
        try {
            worker = new ReviewEngine(); engine.current = worker;
            await worker.init();
            let before = await worker.analyze([], moves[0].before, ms);
            const uci: string[] = [], result: ReviewedMove[] = [];
            for (const move of moves) {
                if (run !== generation.current) return;
                uci.push(move.from + move.to + (move.promotion || ''));
                const after = await worker.analyze(uci, move.after, ms);
                if (run !== generation.current) return;
                result.push(classify(move, before, after)); before = after;
                setRows([...result]);
            }
            cached.set(game.id, result);
            if (cached.size > 20) cached.delete(cached.keys().next().value!);
        } catch (e) { if (run === generation.current) setError((e as Error).message); }
        finally { worker?.close(); if (run === generation.current) { engine.current = null; setRunning(false); } }
    }
    useEffect(() => {
        if (!cached.has(game.id)) void analyze(250);
        return () => { generation.current++; engine.current?.close(); };
    }, [game.id]);
    const navigate = (delta: number) => setIndex(i => Math.min(moves.length - 1, Math.max(0, i + delta)));
    return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="game-review-dialog"><DialogHeader><DialogTitle>Game review</DialogTitle><DialogDescription>{name(game.white)} vs. {name(game.black)} · {game.minutes}+{game.increment} · {game.reason}</DialogDescription></DialogHeader>
        <div className="review-progress" role="status"><span>{running ? `Analyzing ${rows.length} of ${moves.length} moves…` : rows.length === moves.length ? 'Review ready' : 'Review paused'}</span><span>Stockfish 19 Lite</span></div>
        <progress value={rows.length} max={Math.max(moves.length, 1)} aria-label="Review progress"/>
        {error && <p className="error" role="alert">{error}</p>}
        {!moves.length ? <p>No moves were played in this game.</p> : <div className="review-grid"><section>
            <ChessBoard whiteCharacter={players.find(p => p.id === game.white)?.character} blackCharacter={players.find(p => p.id === game.black)?.character} fen={displayed.after} orientation={game.black === me ? 'b' : 'w'} color={game.black === me ? 'b' : 'w'} active={false} canMove={false} online={true} lastMove={{ from: displayed.from, to: displayed.to }} premove={null} onMove={noop} onCancel={noop}/>
            <div className="review-navigation"><Button variant="outline" aria-label="Previous move" onClick={() => navigate(-1)} disabled={index === 0}><ChevronLeft/></Button><strong>{Math.floor(index / 2) + 1}{index % 2 ? '…' : '.'} {displayed.san}</strong><Button variant="outline" aria-label="Next move" onClick={() => navigate(1)} disabled={index === moves.length - 1}><ChevronRight/></Button></div>
            {selected && <div className="review-explanation"><span className={`quality quality-${selected.quality.toLowerCase()}`}>{selected.quality}</span><span>White evaluation: <b>{formatEvaluation(selected.before)} → {formatEvaluation(selected.after)}</b></span><p>{selected.explanation}</p><p><b>Engine choice:</b> {selected.bestSan}</p>{selected.line && <p className="engine-line">Suggested line: {selected.line}</p>}<small>Depth {selected.before.depth}/{selected.after.depth || 'terminal'}. Evaluations are estimates.</small></div>}
        </section><section className="review-details"><div className="review-totals">{[game.white, game.black].map(id => { const color = game.white === id ? 'w' : 'b'; const played = rows.filter(r => r.move.color === color); return <div key={id}><strong>{name(id)}</strong><span>{played.filter(r => r.quality === 'Brilliant').length} brilliant</span><span>{played.filter(r => r.quality === 'Mistake').length} mistakes</span><span>{played.filter(r => r.quality === 'Blunder').length} blunders</span></div>; })}</div>
            <div className="review-moves" aria-label="Reviewed moves">{moves.map((move, i) => <button key={i} className={`review-move ${i === index ? 'current' : ''}`} onClick={() => setIndex(i)} aria-current={i === index ? 'step' : undefined}><span>{Math.floor(i / 2) + 1}{i % 2 ? '…' : '.'} {move.san}</span>{rows[i] ? <span className={`quality quality-${rows[i].quality.toLowerCase()}`}>{rows[i].quality}</span> : <small>Waiting</small>}</button>)}</div>
        </section></div>}
        <div className="review-actions">{running ? <Button variant="outline" onClick={stop}>Stop analysis</Button> : <><Button variant="outline" onClick={() => void analyze(250)} disabled={!moves.length}><RotateCcw size={15}/>Quick review</Button><Button onClick={() => void analyze(1000)} disabled={!moves.length}><Search size={15}/>Deeper review</Button></>}</div>
        <details className="review-method"><summary>How move labels work</summary><p>Best matches the engine’s first choice. Other moves lose roughly: under 0.5 pawns (good/excellent), 0.5–0.99 (inaccuracy), 1–1.99 (mistake), or 2+ (blunder). A forced move is the only legal move. Brilliant marks a sound, engine-best offer of a more valuable piece at depth 12 or higher. These are Rival Room’s estimates, not Chess.com’s ratings; deeper analysis can change them.</p><p>Analysis runs on your device after the game. <a href="/engine/Copying.txt" target="_blank" rel="noreferrer">Engine license</a> · <a href="/engine/SOURCE.txt" target="_blank" rel="noreferrer">Engine source</a></p></details>
    </DialogContent></Dialog>;
}
