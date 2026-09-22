'use client';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Chess, type Color, type Square } from 'chess.js';
import { boardMove, boardTargets, isCastleGesture, pieceName, squareAt, type BoardMove } from '@/lib/board';
import { toast } from 'sonner';
import { characterForColor, type CharacterKey } from '@/lib/characters';
import { BoardPiece } from './character-art';
type Props = {
    whiteCharacter?: CharacterKey | null; blackCharacter?: CharacterKey | null;
    fen: string; orientation: Color; color: Color; active: boolean; canMove: boolean; online: boolean;
    lastMove: { from: Square; to: Square } | null; premove: BoardMove | null;
    onMove: (from: Square, to: Square) => void; onCancel: () => void;
};
export const ChessBoard = memo(function ChessBoard({ fen, orientation, color, active, canMove, online, lastMove, premove, onMove, onCancel, whiteCharacter, blackCharacter }: Props) {
    const board = useMemo(() => new Chess(fen), [fen]);
    const [selected, setSelected] = useState<Square | null>(null), [dragged, setDragged] = useState<Square | null>(null), [hover, setHover] = useState<Square | null>(null);
    const element = useRef<HTMLDivElement>(null), ghost = useRef<HTMLSpanElement>(null);
    const drag = useRef<{ id: number; from: Square; x: number; y: number; latestX: number; latestY: number; bounds: DOMRect | null; moving: boolean; target: HTMLButtonElement } | null>(null);
    const frame = useRef<number | null>(null), dropped = useRef<Square | null>(null);
    const previousPosition = useRef({ fen, orientation });
    const enabled = active && online;
    const myTurn = board.turn() === color;
    const targets = useMemo(() => !selected || !enabled ? [] : boardTargets(board, selected, color), [board, selected, enabled, color]);
    const checked = useMemo(() => board.isCheck(), [board]);
    const stopDrag = useCallback(() => {
        if (frame.current !== null) cancelAnimationFrame(frame.current);
        frame.current = null;
        const previous = drag.current; drag.current = null;
        if (previous?.target.hasPointerCapture(previous.id)) previous.target.releasePointerCapture(previous.id);
        if (ghost.current) ghost.current.style.display = 'none';
        setDragged(null); setHover(null);
    }, []);
    useEffect(() => { stopDrag(); setSelected(null); }, [fen, orientation, online, active, stopDrag]);
    useEffect(() => {
        const invalidate = () => { if (drag.current) drag.current.bounds = null; };
        window.addEventListener('resize', invalidate);
        window.addEventListener('scroll', invalidate, { passive: true, capture: true });
        return () => { window.removeEventListener('resize', invalidate); window.removeEventListener('scroll', invalidate, true); if (frame.current !== null) cancelAnimationFrame(frame.current); };
    }, []);
    useLayoutEffect(() => {
        const previous = previousPosition.current;
        previousPosition.current = { fen, orientation };
        const skip = dropped.current; dropped.current = null;
        if (previous.fen === fen || previous.orientation !== orientation || !lastMove || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const before = new Chess(previous.fen), piece = before.get(lastMove.from), after = board.get(lastMove.to);
        if (!piece || !after || piece.color !== after.color || board.get(lastMove.from)) return;
        const steps = [{ from: lastMove.from, to: lastMove.to }];
        if (piece.type === 'k' && Math.abs(lastMove.from.charCodeAt(0) - lastMove.to.charCodeAt(0)) === 2) {
            const rank = lastMove.from[1], kingSide = lastMove.to[0] === 'g';
            steps.push({ from: ((kingSide ? 'h' : 'a') + rank) as Square, to: ((kingSide ? 'f' : 'd') + rank) as Square });
        }
        const cell = (element.current?.clientWidth || 0) / 8, sign = orientation === 'w' ? 1 : -1;
        let animating = true;
        const animations: Animation[] = [];
        const animatedSquares: HTMLElement[] = [];
        for (const step of steps) {
            if (step.to === skip) continue;
            const target = element.current?.querySelector<HTMLElement>(`[data-square="${step.to}"] .piece`);
            if (!target?.animate) continue;
            const square = target.parentElement!;
            square.classList.add('piece-animating'); animatedSquares.push(square);
            const x = (step.from.charCodeAt(0) - step.to.charCodeAt(0)) * cell * sign;
            const y = (Number(step.to[1]) - Number(step.from[1])) * cell * sign;
            animations.push(target.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }], { duration: 130, easing: 'cubic-bezier(.2,.8,.2,1)' }));
        }
        void Promise.all(animations.map(animation => animation.finished.catch(() => {}))).then(() => { if (animating) animatedSquares.forEach(square => square.classList.remove('piece-animating')); });
        return () => { animating = false; animations.forEach(animation => animation.cancel()); animatedSquares.forEach(square => square.classList.remove('piece-animating')); };
    }, [fen, orientation, lastMove?.from, lastMove?.to, board]);
    useEffect(() => { const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { stopDrag(); setSelected(null); onCancel(); } }; window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape); }, [onCancel, stopDrag]);
    function attempt(from: Square, to: Square, wasDragged = false) {
        if (!enabled || (myTurn && !canMove)) return;
        const move = boardMove(board, from, to, color);
        setSelected(null);
        if (move) { if (wasDragged && myTurn) dropped.current = move.to; onMove(move.from, move.to); }
        else if (isCastleGesture(board, from, to, color)) toast('Cannot castle here. Clear the path; the king and rook must be unmoved, and the king cannot castle out of, through, or into check.');
    }
    function click(square: Square) {
        if (!enabled || (myTurn && !canMove)) return;
        if (selected && (targets.includes(square) || isCastleGesture(board, selected, square, color))) { attempt(selected, square); return; }
        if (board.get(square)?.color === color) setSelected(selected === square ? null : square);
        else { setSelected(null); onCancel(); }
    }
    function down(e: PointerEvent<HTMLButtonElement>, from: Square) {
        if (e.button !== 0 || !e.isPrimary || !enabled || (myTurn && !canMove)) return;
        if (board.get(from)?.color !== color) return;
        drag.current = { id: e.pointerId, from, x: e.clientX, y: e.clientY, latestX: e.clientX, latestY: e.clientY, bounds: element.current?.getBoundingClientRect() || null, moving: false, target: e.currentTarget };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
    }
    function pointerMove(e: PointerEvent<HTMLButtonElement>) {
        const d = drag.current;
        if (!d || e.pointerId !== d.id) return;
        if (!d.moving && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
        if (!d.moving) { d.moving = true; setDragged(d.from); setSelected(d.from); }
        d.latestX = e.clientX; d.latestY = e.clientY;
        if (frame.current !== null) return;
        frame.current = requestAnimationFrame(() => {
            frame.current = null;
            const current = drag.current;
            if (!current) return;
            const bounds = current.bounds ||= element.current?.getBoundingClientRect() || null;
            if (!bounds) return;
            if (ghost.current) {
                ghost.current.style.display = 'grid';
                ghost.current.style.width = `${bounds.width / 8}px`; ghost.current.style.height = `${bounds.width / 8}px`;
                ghost.current.style.transform = `translate3d(${current.latestX - bounds.width / 16}px,${current.latestY - bounds.width / 16}px,0)`;
            }
            setHover(squareAt(current.latestX - bounds.left, current.latestY - bounds.top, bounds.width, orientation));
        });
    }
    function up(e: PointerEvent<HTMLButtonElement>, square: Square) {
        if (e.button !== 0 || !e.isPrimary) return;
        const d = drag.current;
        if (d && e.pointerId === d.id) {
            const bounds = element.current?.getBoundingClientRect();
            const to = bounds ? squareAt(e.clientX - bounds.left, e.clientY - bounds.top, bounds.width, orientation) : null;
            stopDrag();
            if (d.moving) { setSelected(null); if (to && to !== d.from) attempt(d.from, to, true); }
            else click(square);
        } else click(square);
    }
    return <div className="board-frame" onContextMenu={e => { e.preventDefault(); stopDrag(); setSelected(null); onCancel(); }}>
        <div ref={element} className={`chessboard ${dragged ? 'is-dragging' : ''}`} role="group" aria-label="Chess board">
            {Array.from({ length: 64 }, (_, i) => {
                const square = (orientation === 'w' ? 'abcdefgh'[i % 8] + (8 - Math.floor(i / 8)) : 'hgfedcba'[i % 8] + (1 + Math.floor(i / 8))) as Square;
                const file = square.charCodeAt(0) - 97, rank = Number(square[1]), piece = board.get(square);
                const kingChecked = piece?.type === 'k' && piece.color === board.turn() && checked;
                return <button key={square} data-square={square} data-camp={characterForColor(rank <= 4 ? 'w' : 'b', whiteCharacter, blackCharacter)?.key} aria-label={`${square}${piece ? ' ' + (piece.color === 'w' ? 'white' : 'black') + ' ' + pieceName[piece.type] : ''}`} aria-pressed={selected === square} className={`square ${(file + rank) % 2 ? 'light' : 'dark'} ${selected === square ? 'selected' : ''} ${lastMove && [lastMove.from, lastMove.to].includes(square) ? 'last-move' : ''} ${kingChecked ? 'in-check' : ''} ${premove && [premove.from, premove.to].includes(square) ? 'premove-square' : ''} ${hover === square ? 'drop-target' : ''} ${piece?.color === color && enabled ? 'movable' : ''}`}
                    onPointerDown={e => down(e, square)} onPointerMove={pointerMove} onPointerUp={e => up(e, square)} onPointerCancel={stopDrag} onLostPointerCapture={() => { if (drag.current) stopDrag(); }} onClick={e => { if (e.detail === 0) click(square); }} onDragStart={e => e.preventDefault()}>
                    {i % 8 === 0 && <span className="rank">{rank}</span>}
                    {piece && <BoardPiece type={piece.type} color={piece.color} character={piece.color === 'w' ? whiteCharacter : blackCharacter} hidden={dragged === square}/>}
                    {targets.includes(square) && <span className={`legal-dot ${piece ? 'capture' : ''}`}/>}
                    {i >= 56 && <span className="file">{square[0]}</span>}
                </button>;
            })}
        </div>
        <span ref={ghost} className="drag-ghost" aria-hidden="true">{dragged && board.get(dragged) && <BoardPiece type={board.get(dragged)!.type} color={board.get(dragged)!.color} character={board.get(dragged)!.color === 'w' ? whiteCharacter : blackCharacter}/>}</span>
    </div>;
});
