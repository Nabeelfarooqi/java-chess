'use client';
import { memo, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
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
    const drag = useRef<{ id: number; from: Square; x: number; y: number; moving: boolean; target: HTMLButtonElement } | null>(null);
    const enabled = active && online;
    const myTurn = board.turn() === color;
    const targets = useMemo(() => !selected || !enabled ? [] : boardTargets(board, selected, color), [board, selected, enabled, color]);
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
        const move = boardMove(board, from, to, color);
        setSelected(null);
        if (move) onMove(move.from, move.to);
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
            ghost.current.className = 'drag-ghost';
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
                return <button key={square} data-camp={characterForColor(rank <= 4 ? 'w' : 'b', whiteCharacter, blackCharacter)?.key} aria-label={`${square}${piece ? ' ' + (piece.color === 'w' ? 'white' : 'black') + ' ' + pieceName[piece.type] : ''}`} aria-pressed={selected === square} className={`square ${(file + rank) % 2 ? 'light' : 'dark'} ${selected === square ? 'selected' : ''} ${lastMove && [lastMove.from, lastMove.to].includes(square) ? 'last-move' : ''} ${checked ? 'in-check' : ''} ${premove && [premove.from, premove.to].includes(square) ? 'premove-square' : ''} ${hover === square ? 'drop-target' : ''} ${piece?.color === color && enabled ? 'movable' : ''}`}
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
