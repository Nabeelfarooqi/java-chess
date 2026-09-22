'use client';
import { memo, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Chess, type Color, type Square } from 'chess.js';
import { glyph, pieceName, premoveTargets, squareAt, type BoardMove } from '@/lib/board';
type Props = {
    fen: string; orientation: Color; color: Color; active: boolean; canMove: boolean; online: boolean;
    lastMove: { from: Square; to: Square } | null; premove: BoardMove | null;
    onMove: (from: Square, to: Square) => void; onCancel: () => void;
};
export const ChessBoard = memo(function ChessBoard({ fen, orientation, color, active, canMove, online, lastMove, premove, onMove, onCancel }: Props) {
    const board = useMemo(() => new Chess(fen), [fen]);
    const [selected, setSelected] = useState<Square | null>(null), [dragged, setDragged] = useState<Square | null>(null), [hover, setHover] = useState<Square | null>(null);
    const element = useRef<HTMLDivElement>(null), ghost = useRef<HTMLSpanElement>(null);
    const drag = useRef<{ id: number; from: Square; x: number; y: number; moving: boolean; target: HTMLButtonElement } | null>(null);
    const enabled = active && online;
    const myTurn = board.turn() === color;
    const targets = useMemo(() => !selected || !enabled ? [] : myTurn ? board.moves({ square: selected, verbose: true }).map(m => m.to) : premoveTargets(board, selected, color), [board, selected, enabled, myTurn, color]);
    const stopDrag = () => {
        const previous = drag.current; drag.current = null;
        if (previous?.target.hasPointerCapture(previous.id)) previous.target.releasePointerCapture(previous.id);
        if (ghost.current) ghost.current.style.display = 'none';
        setDragged(null); setHover(null);
    };
    useEffect(() => { stopDrag(); setSelected(null); }, [fen, orientation, online, active]);
    useEffect(() => { const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { stopDrag(); setSelected(null); onCancel(); } }; window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape); }, [onCancel]);
    function attempt(from: Square, to: Square) {
        if (!enabled || (myTurn && !canMove)) return;
        const valid = myTurn ? board.moves({ square: from, verbose: true }).some(m => m.to === to) : premoveTargets(board, from, color).includes(to);
        setSelected(null);
        if (valid) onMove(from, to);
    }
    function click(square: Square) {
        if (!enabled || (myTurn && !canMove)) return;
        if (selected && targets.includes(square)) { attempt(selected, square); return; }
        if (board.get(square)?.color === color) setSelected(selected === square ? null : square);
        else { setSelected(null); onCancel(); }
    }
    function down(e: PointerEvent<HTMLButtonElement>, from: Square) {
        if (e.button !== 0 || !e.isPrimary || !enabled || (myTurn && !canMove)) return;
        if (board.get(from)?.color !== color) return;
        drag.current = { id: e.pointerId, from, x: e.clientX, y: e.clientY, moving: false, target: e.currentTarget };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
    }
    function pointerMove(e: PointerEvent<HTMLButtonElement>) {
        const d = drag.current, bounds = element.current?.getBoundingClientRect();
        if (!d || e.pointerId !== d.id || !bounds) return;
        if (!d.moving && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
        if (!d.moving) { d.moving = true; setDragged(d.from); setSelected(d.from); }
        if (ghost.current) {
            const piece = board.get(d.from)!;
            ghost.current.textContent = glyph[piece.type];
            ghost.current.className = `piece drag-ghost ${color === 'w' ? 'white-piece' : 'black-piece'}`;
            ghost.current.style.display = 'grid';
            ghost.current.style.width = `${bounds.width / 8}px`; ghost.current.style.height = `${bounds.width / 8}px`;
            ghost.current.style.transform = `translate3d(${e.clientX - bounds.width / 16}px,${e.clientY - bounds.width / 16}px,0)`;
        }
        setHover(squareAt(e.clientX - bounds.left, e.clientY - bounds.top, bounds.width, orientation));
    }
    function up(e: PointerEvent<HTMLButtonElement>, square: Square) {
        if (e.button !== 0 || !e.isPrimary) return;
        const d = drag.current;
        if (d && e.pointerId === d.id) {
            const bounds = element.current?.getBoundingClientRect();
            const to = bounds ? squareAt(e.clientX - bounds.left, e.clientY - bounds.top, bounds.width, orientation) : null;
            stopDrag();
            if (d.moving) { setSelected(null); if (to && to !== d.from) attempt(d.from, to); }
            else click(square);
        } else click(square);
    }
    return <div className="board-frame" onContextMenu={e => { e.preventDefault(); stopDrag(); setSelected(null); onCancel(); }}>
        <div ref={element} className={`chessboard ${dragged ? 'is-dragging' : ''}`} role="group" aria-label="Chess board">
            {Array.from({ length: 64 }, (_, i) => {
                const square = (orientation === 'w' ? 'abcdefgh'[i % 8] + (8 - Math.floor(i / 8)) : 'hgfedcba'[i % 8] + (1 + Math.floor(i / 8))) as Square;
                const file = square.charCodeAt(0) - 97, rank = Number(square[1]), piece = board.get(square);
                const checked = piece?.type === 'k' && piece.color === board.turn() && board.isCheck();
                return <button key={square} aria-label={`${square}${piece ? ' ' + (piece.color === 'w' ? 'white' : 'black') + ' ' + pieceName[piece.type] : ''}`} aria-pressed={selected === square} className={`square ${(file + rank) % 2 ? 'light' : 'dark'} ${selected === square ? 'selected' : ''} ${lastMove && [lastMove.from, lastMove.to].includes(square) ? 'last-move' : ''} ${checked ? 'in-check' : ''} ${premove && [premove.from, premove.to].includes(square) ? 'premove-square' : ''} ${hover === square ? 'drop-target' : ''} ${piece?.color === color && enabled ? 'movable' : ''}`}
                    onPointerDown={e => down(e, square)} onPointerMove={pointerMove} onPointerUp={e => up(e, square)} onPointerCancel={stopDrag} onLostPointerCapture={() => { if (drag.current) stopDrag(); }} onClick={e => { if (e.detail === 0) click(square); }} onDragStart={e => e.preventDefault()}>
                    {i % 8 === 0 && <span className="rank">{rank}</span>}
                    {piece && <span className={`piece ${piece.color === 'w' ? 'white-piece' : 'black-piece'} ${dragged === square ? 'drag-source' : ''}`} aria-hidden="true">{glyph[piece.type]}</span>}
                    {targets.includes(square) && <span className={`legal-dot ${piece ? 'capture' : ''}`}/>}
                    {i >= 56 && <span className="file">{square[0]}</span>}
                </button>;
            })}
        </div>
        <span ref={ghost} className="piece drag-ghost" aria-hidden="true"/>
    </div>;
});
