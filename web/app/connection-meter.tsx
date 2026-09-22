'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Activity, Wifi, WifiOff } from 'lucide-react';

export function ConnectionMeter({ online, live, latency, moveLatency, deliverySamples = [] }: { online: boolean; live: boolean; latency: number | null; moveLatency: number | null; deliverySamples?: number[] }) {
    const [open,setOpen]=useState(false);
    const sorted=[...deliverySamples].sort((a,b)=>a-b);
    const percentile=(n:number)=>sorted.length?`${sorted[Math.max(0,Math.ceil(sorted.length*n)-1)]} ms`:'No sample yet';
    const slow = latency !== null && latency > 250;
    const label = !online ? 'Reconnecting' : live ? 'Live' : 'Backup sync';
    const explanation = !online ? 'The server could not be reached. Clocks keep running.' : live
        ? `Live updates connected. ${latency === null ? 'Measuring ping.' : `Last socket round trip: ${latency} milliseconds.`} ${moveLatency === null ? '' : `Last move confirmation: ${moveLatency} milliseconds.`}`
        : 'Live connection is reconnecting. Moves are still checked through the game API.';
    return <><button type="button" onClick={()=>setOpen(true)} className={`connection-meter ${!online ? 'disconnected' : !live || slow ? 'degraded' : 'healthy'}`} title={explanation} aria-label={`${label}. ${explanation}`}>
        {!online ? <WifiOff size={13}/> : live ? <Wifi size={13}/> : <Activity size={13}/>}
        <span>{label}</span>{online && latency !== null && <small>{latency}<span> ms</span></small>}
    </button><Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Connection details</DialogTitle><DialogDescription>{explanation}</DialogDescription></DialogHeader><dl className="connection-details"><dt>Socket round trip</dt><dd>{latency===null?'Measuring':`${latency} ms`}</dd><dt>Last server move confirmation</dt><dd>{moveLatency===null?'Play a move':`${moveLatency} ms`}</dd><dt>Rival display + reply · latest</dt><dd>{deliverySamples.length?`${deliverySamples.at(-1)} ms`:'Waiting for a live rival'}</dd><dt>Median / 95th percentile</dt><dd>{percentile(.5)} / {percentile(.95)}</dd></dl><p>Display samples include the trip to your rival, two browser animation frames, and the acknowledgement back to you. They are not one-way latency. Both players must be visible and connected live.</p><small>Last {deliverySamples.length} samples, up to 20, in this session. No lag compensation is applied to clocks.</small></DialogContent></Dialog></>;
}
