'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CharacterPortrait } from './character-art';
import { playerStatus, type Leader } from '@/lib/club';
import type { Player } from '@/lib/game';
import { InstallApp } from './install-app';
import { isCancelled, requestJson } from '@/lib/client-request';
export default function ClubHub({me,playing,onChallenge,onPractice}:{me:string;playing:boolean;onChallenge:(id:string)=>void;onPractice:()=>void}) {
    const [data,setData]=useState<{players:Player[];leaders:Leader[]}|null>(null),[error,setError]=useState('');
    const [retry, setRetry] = useState(0);
    useEffect(()=>{
        let stopped=false, pending=false; const controller=new AbortController();
        async function load(){
            if(document.hidden || pending)return;
            pending=true;
            try{
                const next=await requestJson<{players:Player[];leaders:Leader[]}>('/api/room?club=1',{signal:controller.signal});
                if(!stopped){setData(next);setError('');}
            }catch(e){if(!stopped && !isCancelled(e))setError((e as Error).message);}
            finally{pending=false;}
        }
        void load();const timer=setInterval(load,30000);document.addEventListener('visibilitychange',load);
        return()=>{stopped=true;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',load);};
    },[retry]);
    const names=(id:string|null)=>data?.players.find(p=>p.id===id)?.name||'—';
    return <div className="panel-section club-hub"><p className="eyebrow">THE CLUBHOUSE</p><h2>The usual suspects.</h2><p className="panel-copy">Who’s around for the next one?</p>{error&&<p role="alert">{error}</p>}{!data&&!error&&<p role="status">Loading the club…</p>}
        {error && <Button variant="outline" onClick={()=>setRetry(value=>value+1)}>Retry club</Button>}
        <div className="friend-list">{data?.players.map(p=><div className="friend" key={p.id}><CharacterPortrait character={p.character} name={p.name}/><div><strong>{p.name}{p.id===me?' · You':''}</strong><small><i className={`presence-dot ${p.presence}`}/>{playerStatus(p)}</small></div>{p.id!==me&&<Button size="sm" variant="outline" disabled={playing||p.busy} onClick={()=>onChallenge(p.id)}>Challenge</Button>}</div>)}</div>
        <h3>Leaderboard</h3><p className="panel-note">All-time wins. Ties use win rate, then games played. No rating points.</p>
        <ol className="leader-list">{data?.leaders.map(p=><li key={p.id}><div className="leader-heading"><strong>{p.name}</strong><b>{p.wins} wins</b></div><span>{p.wins}W · {p.losses}L · {p.draws}D · {p.winRate}% wins</span><small>{p.streak} win streak · Best {p.bestStreak}</small><small>Main rivalry: {names(p.mainRival)}{p.rivalry?` · ${p.rivalry.wins}W / ${p.rivalry.losses}L / ${p.rivalry.draws}D`:''}</small></li>)}</ol>
        <div className="practice-invite"><h3>Run it back, smarter.</h3><p>Save your mistakes from a finished game’s review, then find the engine’s move here.</p><Button disabled={playing} onClick={onPractice}>Practice my mistakes</Button>{playing&&<small>Available after your game or challenge.</small>}</div><InstallApp/>
    </div>;
}
