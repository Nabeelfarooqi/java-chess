'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Chess, type Move, type Square } from 'chess.js';
import { ArrowLeftRight, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Download, Search, Sparkles, Undo2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChessBoard } from './chess-board';
import { ReviewArrows, ReviewGraph, ReviewPlayer } from './review-widgets';
import { formatEvaluation, type Evaluation } from '@/lib/review';
import { keyMoments, moveLabel, reviewInsight, toUci, variationMoves } from '@/lib/review-workspace';
import { useGameReview } from '@/lib/use-game-review';
import type { EngineMode } from '@/lib/review-assets';
import type { Game, Player } from '@/lib/game';

type Props = { game: Game; players: Player[]; me: string; onClose: () => void };
type Branch = { base: number; moves: Move[]; step: number; kind: 'try' | 'line' };
const noop = () => {};
export default function GameReview(props: Props) {
    const [mode, setMode] = useState<EngineMode>('lite');
    return <Dialog open onOpenChange={open => { if (!open) props.onClose(); }}><DialogContent className="review-studio">
        <ReviewWorkspace key={props.game.id + mode} {...props} mode={mode} onMode={setMode}/>
    </DialogContent></Dialog>;
}

function ReviewWorkspace({ game, players, me, mode, onMode }: Props & { mode: EngineMode; onMode: (mode: EngineMode) => void }) {
    const moves = useMemo(() => { const board = new Chess(); return game.moves.map(san => board.move(san)); }, [game.moves]);
    const review = useGameReview(game.id, moves, game.status === 'finished', mode);
    const { rows, evaluations, task, stop } = review;
    const [index, setIndex] = useState(0), [before, setBefore] = useState(false);
    const [orientation, setOrientation] = useState<'w' | 'b'>(game.black === me ? 'b' : 'w');
    const [tab, setTab] = useState<'moments' | 'moves'>('moments'), [mine, setMine] = useState(false);
    const [branch, setBranch] = useState<Branch | null>(null), [branchScore, setBranchScore] = useState<Evaluation | null>(null);
    const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null), [hint, setHint] = useState(false);
    const [saving, setSaving] = useState(false);
    const white = players.find(p => p.id === game.white), black = players.find(p => p.id === game.black);
    const myColor = game.white === me ? 'w' : game.black === me ? 'b' : undefined;
    const displayed = moves[index], selected = rows[index];
    const baseFen = (ply: number) => ply ? moves[ply - 1].after : moves[0]?.before || new Chess().fen();
    const fen = branch ? (branch.step ? branch.moves[branch.step - 1].after : baseFen(branch.base)) : displayed ? (before ? displayed.before : displayed.after) : new Chess().fen();
    const board = useMemo(() => new Chess(fen), [fen]);
    const last = branch ? branch.moves[branch.step - 1] : before ? moves[index - 1] : displayed;
    const position = before ? index : index + 1;
    const score = branch ? branchScore : evaluations[position];
    const moments = keyMoments(rows, mine ? myColor : undefined);
    const analyzed = rows.filter(Boolean).length;
    const finished = analyzed === moves.length;
    const choices = review.alternatives[index] || (selected ? [selected.before] : []);
    const select = useCallback((next: number, showBefore = false) => {
        if (task && task !== 'review') stop();
        setIndex(Math.max(0, Math.min(moves.length - 1, next))); setBefore(showBefore);
        setBranch(null); setBranchScore(null); setPromotion(null); setHint(false);
    }, [moves.length, stop, task]);
    const selectPosition = useCallback((ply: number) => select(Math.max(0, ply - 1), ply === 0), [select]);
    useEffect(() => {
        const keydown = (e: KeyboardEvent) => {
            if (e.altKey || e.ctrlKey || e.metaKey || branch || !moves.length || (e.target instanceof HTMLElement && (e.target.matches('input,select,textarea,button') || e.target.isContentEditable))) return;
            const next = e.key === 'ArrowLeft' ? position - 1 : e.key === 'ArrowRight' ? position + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? moves.length : null;
            if (next !== null) { e.preventDefault(); selectPosition(Math.max(0, Math.min(moves.length, next))); }
        };
        window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
    }, [branch, moves.length, position, selectPosition]);
    const openLine = (base: number, pv: string[], step = 1) => {
        if (task && task !== 'review') stop();
        const line = variationMoves(baseFen(base), pv);
        setBranch({ base, moves: line, step: Math.min(step, line.length), kind: 'line' }); setBranchScore(null); setPromotion(null); setHint(false);
    };
    const tryMove = () => { stop(); setBranch({ base: index, moves: [], step: 0, kind: 'try' }); setBranchScore(null); setPromotion(null); setHint(false); };
    const play = (from: Square, to: Square, piece?: string) => {
        if (!branch || branch.kind !== 'try' || task) return;
        if (!piece && board.get(from)?.type === 'p' && (to[1] === '1' || to[1] === '8')) { setPromotion({ from, to }); return; }
        try {
            const move = new Chess(fen).move({ from, to, ...(piece ? { promotion: piece } : {}) });
            const next = [...branch.moves.slice(0, branch.step), move];
            setBranch({ ...branch, moves: next, step: next.length }); setBranchScore(null); setPromotion(null); setHint(false);
        } catch { toast('That move is not legal in this position.'); }
    };
    const changeBranchStep = (step: number) => { if (task === 'variation') stop(); setBranch(branch && { ...branch, step }); setBranchScore(null); setPromotion(null); };
    async function saveMistakes() {
        const items = rows.flatMap((row, ply) => row && row.move.color === myColor && ['Mistake', 'Blunder'].includes(row.quality) ? [{ ply, solution: row.before.best, loss: Math.min(20000, Math.round(row.loss)), depth: row.before.depth }] : []).slice(0, 40);
        if (!items.length) { toast('No reviewed mistakes to save for your side.'); return; }
        setSaving(true);
        try {
            const r = await fetch('/api/room', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'practiceSave', gameId: game.id, items }) });
            const d = await r.json() as { error?: string; saved: number }; if (!r.ok) throw Error(d.error || 'Could not save practice.');
            toast.success(`${d.saved} positions saved. Open Club → Practice my mistakes.`);
        } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
    }
    const status = review.loading !== null ? `Loading Full engine · ${review.loading}%` : task === 'review' ? `Analyzing · ${review.progress.done}/${review.progress.total || moves.length + 1} positions` : task === 'position' ? 'Comparing three candidate moves…' : task === 'variation' ? 'Analyzing your line…' : finished ? 'Review ready' : 'Review paused';
    return <>
        <DialogHeader className="review-heading"><span className="review-kicker"><Sparkles size={13}/> THE POSTGAME</span><DialogTitle>Every move tells a story.</DialogTitle><DialogDescription>{white?.name || 'White'} vs. {black?.name || 'Black'} · {game.minutes}+{game.increment} · {game.reason}</DialogDescription></DialogHeader>
        <div className="review-engine-bar"><div><strong>Stockfish 19 {mode === 'full' ? 'Full' : 'Lite'}</strong><span role="status">{status}</span></div><div className="review-button-row">
            {task ? <Button variant="outline" size="sm" onClick={stop}>Stop analysis</Button> : <><Button variant="outline" size="sm" disabled={!moves.length} onClick={() => review.fullReview(250, !finished)}>{finished ? 'Quick review' : 'Resume review'}</Button><Button size="sm" disabled={!moves.length} onClick={() => review.fullReview(1000)}>Deeper review</Button></>}
        </div><progress aria-label="Review progress" value={review.loading ?? analyzed} max={review.loading !== null ? 100 : Math.max(1, moves.length)}/></div>
        <details className="review-engine-options"><summary>Engine strength · {mode === 'lite' ? 'Fast, light download' : 'Full neural network'}</summary><p>Lite loads quickly. Full uses a stronger evaluation network and downloads about 99 MB (94.5 MiB). Both run on your device for free; Full uses more memory and works best on a computer. More thinking time can improve either review.</p><Button variant="outline" size="sm" onClick={() => onMode(mode === 'lite' ? 'full' : 'lite')}>{mode === 'lite' ? <><Download size={14}/>Load Full · 99 MB</> : 'Switch to Lite'}</Button></details>
        {review.error && <p className="error" role="alert">{review.error} {mode === 'full' && <button onClick={() => onMode('lite')}>Use Lite instead</button>}</p>}
        {!moves.length ? <p className="review-empty">No moves were played in this game.</p> : <div className="review-layout"><section className="review-board-column" aria-label="Review board and explanation">
            <div className="review-board-label"><span>{branch ? branch.kind === 'try' ? 'YOUR ANALYSIS BOARD' : 'ENGINE CONTINUATION' : before ? 'BEFORE THE MOVE' : 'PLAYED IN THE GAME'}</span><b>{score ? formatEvaluation(score) : '—'}<small> White’s view</small></b></div>
            <div className="review-board-wrap"><ChessBoard whiteCharacter={white?.character} blackCharacter={black?.character} fen={fen} orientation={orientation} color={board.turn()} active={branch?.kind === 'try'} canMove={!task && !promotion} online lastMove={last ? { from: last.from, to: last.to } : null} premove={null} onMove={play} onCancel={noop}/>
                {((!branch && before) || (branch?.kind === 'try' && branch.step === 0 && hint)) && <ReviewArrows orientation={orientation} best={selected?.before.best} played={!branch ? displayed : undefined}/>}
            </div>
            {promotion && <div className="review-promotion" role="group" aria-label="Choose promotion piece">Promote to {(['q', 'r', 'b', 'n'] as const).map((piece, i) => <Button key={piece} size="sm" onClick={() => play(promotion.from, promotion.to, piece)}>{['Queen', 'Rook', 'Bishop', 'Knight'][i]}</Button>)}<Button variant="ghost" size="sm" onClick={() => setPromotion(null)}>Cancel</Button></div>}
            {!branch ? <><div className="review-transport"><Button variant="ghost" size="icon" aria-label="Starting position" disabled={position === 0} onClick={() => selectPosition(0)}><ChevronFirst/></Button><Button variant="ghost" size="icon" aria-label="Previous position" disabled={position === 0} onClick={() => selectPosition(position - 1)}><ChevronLeft/></Button><strong>{before ? 'Before ' : ''}{moveLabel(index, displayed.san)}</strong><Button variant="ghost" size="icon" aria-label="Next position" disabled={position === moves.length} onClick={() => selectPosition(position + 1)}><ChevronRight/></Button><Button variant="ghost" size="icon" aria-label="Final position" disabled={position === moves.length} onClick={() => selectPosition(moves.length)}><ChevronLast/></Button></div>
                <div className="review-position-tools"><Button variant="outline" size="sm" onClick={() => setBefore(v => !v)}>{before ? 'Show played position' : 'Compare move arrows'}</Button><Button variant="ghost" size="icon" aria-label="Flip review board" onClick={() => setOrientation(v => v === 'w' ? 'b' : 'w')}><ArrowLeftRight size={16}/></Button></div>{before && <p className="review-arrow-legend"><span>● Engine choice</span><span>● Played move</span></p>}</> : <div className="review-branch-panel">
                <div className="review-section-label"><strong>{branch.kind === 'try' ? `${board.turn() === 'w' ? 'White' : 'Black'} to move` : 'Explore the engine line'}</strong><Button variant="outline" size="sm" onClick={() => select(index)}>Back to game</Button></div>
                <p>{branch.kind === 'try' ? 'Play either side. Your saved game stays as it was.' : 'Tap a move to see the continuation on the board.'}</p>
                <div className="review-line-moves"><button aria-pressed={branch.step === 0} onClick={() => changeBranchStep(0)}>Start</button>{branch.moves.map((move, i) => <button key={i} aria-pressed={branch.step === i + 1} onClick={() => changeBranchStep(i + 1)}>{moveLabel(branch.base + i, move.san)}</button>)}</div>
                {branch.kind === 'try' && <><div className="review-button-row"><Button variant="outline" size="sm" disabled={!branch.step || !!task} onClick={() => changeBranchStep(branch.step - 1)}><Undo2 size={14}/>Undo</Button><Button variant="outline" size="sm" disabled={!!task || branch.step !== 0 || !selected} onClick={() => setHint(v => !v)}>{hint ? 'Hide hint' : 'Show hint'}</Button><Button size="sm" disabled={!!task || !branch.step} onClick={() => review.analyzeVariation([...moves.slice(0, branch.base).map(toUci), ...branch.moves.slice(0, branch.step).map(toUci)], fen, setBranchScore)}>Analyze my line</Button></div>
                {branch.step > 0 && <p>{toUci(branch.moves[0]) === selected?.before.best ? 'Your first move matches the engine’s choice.' : 'Another good move may exist. Analyze your line to compare the position.'}</p>}{branchScore && <p><b>White evaluation {formatEvaluation(branchScore)}</b> · depth {branchScore.depth || 'terminal'}</p>}</>}
            </div>}
            <article className="review-coach"><div className="review-section-label"><strong>{moveLabel(index, displayed.san)}</strong>{selected ? <span className={`quality quality-${selected.quality.toLowerCase()}`}>{selected.quality}</span> : <span className="review-muted">Waiting for analysis</span>}</div>
                {selected ? <><p className="review-coach-lead">{selected.explanation}</p><p>{reviewInsight(selected)}</p><div className="review-eval-change"><span>White evaluation</span><b>{formatEvaluation(selected.before)} → {formatEvaluation(selected.after)}</b><small>Depth {selected.before.depth}/{selected.after.depth || 'terminal'}</small></div><div className="review-button-row"><Button size="sm" onClick={tryMove}>Try a better move</Button><Button variant="outline" size="sm" disabled={!!task} onClick={() => review.deepen(index)}><Search size={14}/>Deepen this move</Button></div></> : <p>Browse the game while Stockfish evaluates it. You can pause and resume at any time.</p>}
            </article>
            {selected && <section className="review-candidates"><div className="review-section-label"><strong>What else was possible?</strong><small>{choices.length > 1 ? 'Top candidates' : 'Engine choice'}</small></div>{choices.map((evaluation, rank) => <div className="review-candidate" key={rank}><div><b>{rank + 1}</b><strong>{formatEvaluation(evaluation)}</strong><small>Depth {evaluation.depth}</small></div><div className="review-line-moves">{variationMoves(displayed.before, evaluation.pv).map((move, i) => <button key={i} onClick={() => openLine(index, evaluation.pv, i + 1)}>{moveLabel(index + i, move.san)}</button>)}</div></div>)}{choices.length === 1 && <p className="review-muted">Deepen this move to compare up to three choices.</p>}{selected.after.pv.length > 0 && <Button variant="ghost" size="sm" onClick={() => openLine(index + 1, selected.after.pv)}>Explore the reply to {displayed.san}<ChevronRight size={14}/></Button>}</section>}
        </section><aside className="review-sidebar" aria-label="Review overview"><div className="review-players"><ReviewPlayer player={white} color="w" rows={rows} me={me}/><ReviewPlayer player={black} color="b" rows={rows} me={me}/></div>
            <ReviewGraph evaluations={evaluations} total={moves.length} position={branch ? branch.base : position} onSelect={selectPosition}/>
            <section className="review-move-panel"><div className="review-tabs" role="group" aria-label="Move list view"><button aria-pressed={tab === 'moments'} onClick={() => setTab('moments')}>Key moments <span>{moments.length}</span></button><button aria-pressed={tab === 'moves'} onClick={() => setTab('moves')}>All moves</button></div>
                {myColor && <label className="review-mine"><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)}/> Only my moves</label>}
                <div className="review-move-scroll" aria-label={tab === 'moments' ? 'Key moments' : 'All reviewed moves'}>{(tab === 'moments' ? moments.map(item => item.index) : moves.flatMap((move, i) => !mine || move.color === myColor ? [i] : [])).map(i => <button className="review-moment" key={i} aria-current={i === index ? 'step' : undefined} onClick={() => select(i)}><div><strong>{moveLabel(i, moves[i].san)}</strong><small>{moves[i].color === 'w' ? white?.name : black?.name}</small></div>{rows[i] ? <span className={`quality quality-${rows[i]!.quality.toLowerCase()}`}>{rows[i]!.quality}</span> : <span className="review-muted">Pending</span>}<ChevronRight size={15}/></button>)}{tab === 'moments' && !moments.length && <p className="review-empty">{finished ? 'No inaccuracies, mistakes, blunders, or brilliant moves found in this pass. Browse All moves to explore.' : 'Turning points will appear here as the review progresses.'}</p>}</div>
            </section>
            {myColor && <Button variant="outline" disabled={saving || !!task || !analyzed} onClick={() => void saveMistakes()}>{saving ? 'Saving…' : 'Save my mistakes for practice'}</Button>}
            <p className="review-muted">Review scores are estimates. Deeper searches can change move labels. Average loss is in pawns and excludes forced-mate evaluations.</p>
        </aside></div>}
        <details className="review-method"><summary>About the analysis and move labels</summary><p>All scores use White’s perspective: positive favors White, negative favors Black. Best matches the engine’s first choice. Other moves lose roughly: under 0.5 pawns (good/excellent), 0.5–0.99 (inaccuracy), 1–1.99 (mistake), or 2+ (blunder). Forced is the only legal move. Brilliant is our heuristic for a sound, engine-best offer of a more valuable piece at depth 12 or higher. These are Rival Room’s estimates; deeper analysis can change them.</p><p>Quick review spends 250 ms per position; Deeper review spends one second. Deepen this move compares three candidates for two seconds, then checks the played position for 1.5 seconds. Full and Lite results stay separate. Analysis runs only after the game, in a browser worker, and stops when you close this screen.</p><p><a href="/engine/Copying.txt" target="_blank" rel="noreferrer">Engine license</a> · <a href="/engine/SOURCE.txt" target="_blank" rel="noreferrer">Corresponding engine source</a></p></details>
    </>;
}
