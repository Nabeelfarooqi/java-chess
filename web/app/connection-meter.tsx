import { Activity, Wifi, WifiOff } from 'lucide-react';

export function ConnectionMeter({ online, live, latency, moveLatency }: { online: boolean; live: boolean; latency: number | null; moveLatency: number | null }) {
    const slow = latency !== null && latency > 250;
    const label = !online ? 'Reconnecting' : live ? 'Live' : 'Backup sync';
    const explanation = !online ? 'The server could not be reached. Clocks keep running.' : live
        ? `Live updates connected. ${latency === null ? 'Measuring ping.' : `Last socket round trip: ${latency} milliseconds.`} ${moveLatency === null ? '' : `Last move confirmation: ${moveLatency} milliseconds.`}`
        : 'Live connection is reconnecting. Moves are still checked through the game API.';
    return <span className={`connection-meter ${!online ? 'disconnected' : !live || slow ? 'degraded' : 'healthy'}`} title={explanation} aria-label={`${label}. ${explanation}`}>
        {!online ? <WifiOff size={13}/> : live ? <Wifi size={13}/> : <Activity size={13}/>}
        <span>{label}</span>{online && latency !== null && <small>{latency}<span> ms</span></small>}
    </span>;
}
