'use client';
import { useCallback, useEffect, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ChessBoard } from './chess-board';
type Puzzle={id:string;gameId:string;ply:number;fen:string;loss:number;depth:number;solvedAt:number|null;attempts:number};
const noop=()=>{};
export default function PracticeRoom({onClose}:{onClose:()=>void}) {
    const [puzzles,setPuzzles]=useState<Puzzle[]>([]),[index,setIndex]=useState(0),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[feedback,setFeedback]=useState(''),[done,setDone]=useState(false),[promotion,setPromotion]=useState<{from:Square;to:Square}|null>(null);
    useEffect(()=>{const controller=new AbortController();fetch('/api/room?practice=1',{cache:'no-store',signal:controller.signal}).then(async r=>{if(!r.ok)throw Error('Could not load practice.');return r.json() as Promise<{puzzles:Puzzle[]}>;}).then(d=>{setPuzzles(d.puzzles);setReady(true);}).catch(e=>{if(!controller.signal.aborted){setFeedback(e.message);setReady(true);}});return()=>controller.abort();},[]);
    const puzzle=puzzles[index];
    async function action(kind:string,move?:string){if(!puzzle||busy)return;setBusy(true);try{const r=await fetch('/api/room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:kind,id:puzzle.id,move})});const d=await r.json() as {error?:string;from?:string;san?:string;solution?:string;correct?:boolean};if(!r.ok)throw Error(d.error||'Please try again.');if(kind==='practiceHint')setFeedback(`Try moving the piece on ${d.from}.`);else if(kind==='practiceReveal'){setFeedback(`Engine choice: ${d.san} (${d.solution}).`);setDone(true);}else if(d.correct){setFeedback(`Found it: ${d.san}.`);setDone(true);setPuzzles(items=>items.map(p=>p.id===puzzle.id?{...p,solvedAt:Date.now(),attempts:p.attempts+1}:p));}else setFeedback('That is legal, but differs from the review engine’s choice. Try again; other good moves can exist.');}catch(e){setFeedback((e as Error).message);}finally{setBusy(false);}}
    const move=useCallback((from:Square,to:Square)=>{if(!puzzle)return;const board=new Chess(puzzle.fen);if(board.get(from)?.type==='p'&&['1','8'].includes(to[1]))setPromotion({from,to});else void action('practiceAttempt',from+to);},[puzzle,busy]);
    function next(delta:number){setIndex(i=>Math.max(0,Math.min(puzzles.length-1,i+delta)));setDone(false);setFeedback('');setPromotion(null);}
    const color=puzzle?.fen.split(' ')[1]==='b'?'b':'w';
    return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="practice-dialog"><DialogHeader><DialogTitle>Practice your mistakes</DialogTitle><DialogDescription>Find the review engine’s move. Progress saves to your PIN profile; practice never changes your match record.</DialogDescription></DialogHeader>
        {!ready?<p>Loading positions…</p>:!puzzle?<p>Nothing saved yet. Open a finished game’s review and choose “Save my mistakes.”</p>:<><div className="practice-meta"><strong>{color==='w'?'White':'Black'} to move</strong><span>{index+1} / {puzzles.length} · {puzzles.filter(p=>p.solvedAt).length} solved</span></div><ChessBoard fen={puzzle.fen} orientation={color} color={color} active={!done} canMove={!busy} online lastMove={null} premove={null} onMove={move} onCancel={noop}/><small>Move {Math.floor(puzzle.ply/2)+1} · Review depth {puzzle.depth} · Estimated loss {(puzzle.loss/100).toFixed(1)} pawns</small>
        {promotion&&<div className="practice-actions" aria-label="Choose promotion">{['q','r','b','n'].map(piece=><Button key={piece} onClick={()=>{void action('practiceAttempt',promotion.from+promotion.to+piece);setPromotion(null);}}>{({q:'Queen',r:'Rook',b:'Bishop',n:'Knight'} as Record<string,string>)[piece]}</Button>)}</div>}
        <div className="practice-actions">{done&&<Button variant="outline" onClick={()=>{setDone(false);setFeedback('');}}>Try again</Button>}<Button variant="outline" disabled={busy||done} onClick={()=>void action('practiceHint')}>Hint</Button><Button variant="ghost" disabled={busy||done} onClick={()=>void action('practiceReveal')}>Show move</Button><Button variant="outline" disabled={busy||index===0} onClick={()=>next(-1)}>Previous</Button><Button disabled={busy||index===puzzles.length-1} onClick={()=>next(1)}>Next</Button></div></>}
        <p role="status" className="practice-feedback">{feedback}</p>
    </DialogContent></Dialog>;
}
