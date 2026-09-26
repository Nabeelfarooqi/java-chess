'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ChessBoard } from './chess-board';
import { isCancelled } from '@/lib/client-request';
import { useRequest } from '@/lib/use-request';
import type { PracticePage, PracticePuzzle } from '@/lib/practice';
const noop=()=>{};
export default function PracticeRoom({onClose}:{onClose:()=>void}) {
    const [puzzles,setPuzzles]=useState<PracticePuzzle[]>([]),[index,setIndex]=useState(0),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[feedback,setFeedback]=useState(''),[done,setDone]=useState(false),[promotion,setPromotion]=useState<{from:Square;to:Square}|null>(null);
    const [cursor,setCursor]=useState<string|null>(null),[total,setTotal]=useState(0),[loadingMore,setLoadingMore]=useState(false);
    const [pageError,setPageError]=useState('');
    const paging=useRef(false);
    const request = useRequest(), acting = useRef(false);
    const [retry,setRetry]=useState(0);
    useEffect(()=>{
        const controller=new AbortController();
        request<PracticePage>('/api/room?practice=1',{signal:controller.signal})
            .then(d=>{setPuzzles(d.puzzles);setCursor(d.nextCursor);setTotal(d.total);setReady(true);setFeedback('');})
            .catch(e=>{if(!isCancelled(e)){setFeedback(e.message);setReady(true);}});
        return()=>controller.abort();
    },[request,retry]);
    async function loadMore() {
        if (!cursor || paging.current) return;
        paging.current=true;setLoadingMore(true);setPageError('');let cancelled=false;
        try {
            const page=await request<PracticePage>('/api/room?practice=1&cursor='+encodeURIComponent(cursor));
            setPuzzles(items=>{const ids=new Set(items.map(item=>item.id));return [...items,...page.puzzles.filter(item=>!ids.has(item.id))];});
            setCursor(page.nextCursor);setTotal(page.total);
        } catch(error) {cancelled=isCancelled(error);if(!cancelled)setPageError((error as Error).message);}
        finally {paging.current=false;if(!cancelled)setLoadingMore(false);}
    }
    const puzzle=puzzles[index];
    const action=useCallback(async(kind:string,move?:string)=>{
        if(!puzzle||acting.current)return;
        acting.current=true;setBusy(true);let cancelled=false;
        try{
            const d=await request<{from?:string;san?:string;solution?:string;correct?:boolean}>('/api/room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:kind,id:puzzle.id,move})});
            if(kind==='practiceHint')setFeedback(`Try moving the piece on ${d.from}.`);
            else if(kind==='practiceReveal'){setFeedback(`Engine choice: ${d.san} (${d.solution}).`);setDone(true);}
            else if(d.correct){setFeedback(`Found it: ${d.san}.`);setDone(true);setPuzzles(items=>items.map(p=>p.id===puzzle.id?{...p,solvedAt:Date.now(),attempts:p.attempts+1}:p));}
            else setFeedback('That is legal, but differs from the review engine’s choice. Try again; other good moves can exist.');
        }catch(e){cancelled=isCancelled(e);if(!cancelled)setFeedback((e as Error).message);}
        finally{acting.current=false;if(!cancelled)setBusy(false);}
    },[puzzle,request]);
    const move=useCallback((from:Square,to:Square)=>{if(!puzzle)return;const board=new Chess(puzzle.fen);if(board.get(from)?.type==='p'&&['1','8'].includes(to[1]))setPromotion({from,to});else void action('practiceAttempt',from+to);},[puzzle,action]);
    function next(delta:number){setIndex(i=>Math.max(0,Math.min(puzzles.length-1,i+delta)));setDone(false);setFeedback('');setPromotion(null);}
    const color=puzzle?.fen.split(' ')[1]==='b'?'b':'w';
    return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="practice-dialog"><DialogHeader><DialogTitle>Practice your mistakes</DialogTitle><DialogDescription>Find the review engine’s move. Progress saves to your PIN profile; practice never changes your match record.</DialogDescription></DialogHeader>
        {!ready?<p>Loading positions…</p>:!puzzle?<p>Nothing saved yet. Open a finished game’s review and choose “Save my mistakes.”</p>:<><div className="practice-meta"><strong>{color==='w'?'White':'Black'} to move</strong><span>{index+1} / {puzzles.length} · {puzzles.filter(p=>p.solvedAt).length} solved</span></div><ChessBoard fen={puzzle.fen} orientation={color} color={color} active={!done} canMove={!busy} online lastMove={null} premove={null} onMove={move} onCancel={noop}/><small>Move {Math.floor(puzzle.ply/2)+1} · Review depth {puzzle.depth} · Estimated loss {(puzzle.loss/100).toFixed(1)} pawns</small>
        {promotion&&<div className="practice-actions" aria-label="Choose promotion">{['q','r','b','n'].map(piece=><Button key={piece} onClick={()=>{void action('practiceAttempt',promotion.from+promotion.to+piece);setPromotion(null);}}>{({q:'Queen',r:'Rook',b:'Bishop',n:'Knight'} as Record<string,string>)[piece]}</Button>)}</div>}
        <div className="practice-actions">{done&&<Button variant="outline" onClick={()=>{setDone(false);setFeedback('');}}>Try again</Button>}<Button variant="outline" disabled={busy||done} onClick={()=>void action('practiceHint')}>Hint</Button><Button variant="ghost" disabled={busy||done} onClick={()=>void action('practiceReveal')}>Show move</Button><Button variant="outline" disabled={busy||index===0} onClick={()=>next(-1)}>Previous</Button><Button disabled={busy||index===puzzles.length-1} onClick={()=>next(1)}>Next</Button></div></>}
        {ready&&puzzles.length>0&&<div className="practice-pagination"><p>{puzzles.length} of {total} positions loaded · newest saved first</p>{cursor&&<Button variant="outline" disabled={loadingMore||busy} onClick={()=>void loadMore()}>{loadingMore?'Loading more positions…':'Load more positions'}</Button>}{pageError&&<p role="alert">{pageError}</p>}</div>}
        <p role="status" className="practice-feedback">{feedback}</p>{ready&&!puzzle&&feedback&&<Button onClick={()=>{setReady(false);setRetry(value=>value+1);}}>Reload practice</Button>}
    </DialogContent></Dialog>;
}
