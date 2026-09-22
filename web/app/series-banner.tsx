'use client';
import { useState } from 'react';
import type { Room } from '@/lib/game';
import { seriesTarget } from '@/lib/series';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
export function SeriesBanner({room,busy,online,run}:{room:Room;busy:boolean;online:boolean;run:(action:string,body:Record<string,unknown>)=>void}){
    const [confirm,setConfirm]=useState(false);const s=room.series;if(!s)return null;
    const name=(id:string)=>room.players.find(p=>p.id===id)?.name||'Player';
    const playing=room.game&&['active','pending'].includes(room.game.status);
    const body={seriesId:s.id,seriesVersion:s.version};
    return <section className="series-banner" aria-label="Series score"><p className="eyebrow">BEST OF {s.bestOf} · FIRST TO {seriesTarget(s)} WINS</p><strong>{name(s.playerOne)} {s.oneWins} — {s.twoWins} {name(s.playerTwo)}</strong><p>{s.status==='finished'?`${name(s.winner!)} wins the series.`:s.status==='cancelled'?'Series ended. Completed games stay in your record.':`Round ${s.oneWins+s.twoWins+1} · ${s.minutes}+${s.increment}`} {s.draws>0&&`${s.draws} drawn; draws replay the round.`}</p>{s.status==='active'&&<div className="series-actions">{!playing&&<Button disabled={busy||!online} onClick={()=>run('nextRound',body)}>Challenge next round</Button>}<Button variant="ghost" disabled={busy||!online||room.game?.status==='active'} onClick={()=>setConfirm(true)}>End series</Button></div>}<Dialog open={confirm} onOpenChange={setConfirm}><DialogContent><DialogHeader><DialogTitle>End this series?</DialogTitle><DialogDescription>Completed games keep their wins, losses, and draws. No series winner is declared. A waiting round will be cancelled.</DialogDescription></DialogHeader><Button variant="outline" onClick={()=>setConfirm(false)}>Keep series</Button><Button onClick={()=>{run('endSeries',body);setConfirm(false);}}>End series</Button></DialogContent></Dialog></section>;
}
