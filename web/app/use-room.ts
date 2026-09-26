'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { clockMs, type Room } from '@/lib/game';
import { mergeRoom, type RoomUpdate } from '@/lib/room-update';
import { roomPollDelay } from '@/lib/connection';
import { isCancelled } from '@/lib/client-request';
import { useRequest } from '@/lib/use-request';
import { SessionGeneration } from '@/lib/session-generation';
export function useRoom() {
    const jsonRequest = useRequest();
    const [room, setRoom] = useState<Room | null>(null), [busy, setBusy] = useState(false), [ready, setReady] = useState(false), [error, setError] = useState(''), [online, setOnline] = useState(true), [live, setLive] = useState(false);
    const [latency, setLatency] = useState<number | null>(null), [moveLatency, setMoveLatency] = useState<number | null>(null);
    const [deliverySamples, setDeliverySamples] = useState<number[]>([]);
    const [unavailable, setUnavailable] = useState(false), [clockOffset, setClockOffset] = useState(0);
    const pendingReceipts = useRef(new Map<string,number>());
    const latest = useRef<Room | null>(null), offset = useRef(0), session = useRef(new SessionGeneration()), acting = useRef(false), socket = useRef<WebSocket | null>(null), lastFull = useRef(0);
    const polling = useRef<Promise<void> | null>(null), refreshAgain = useRef(false);
    const clear = useCallback(() => { session.current.invalidate(); latest.current = null; setRoom(null); setReady(true); setUnavailable(false); setLatency(null); setMoveLatency(null); setDeliverySamples([]); pendingReceipts.current.clear(); socket.current?.close(); }, []);
    const apply = useCallback((data: RoomUpdate, roundTrip?: number) => {
        const merged = mergeRoom(latest.current, data);
        if (!merged || merged === latest.current) return;
        // An unsolicited socket event has no round-trip sample: using it to
        // reset the clock offset would count network delay as clock correction.
        if (roundTrip !== undefined) {
            offset.current = data.serverNow - (Date.now() - Math.min(roundTrip / 2, 500));
            setClockOffset(offset.current);
            if (socket.current?.readyState !== WebSocket.OPEN) setLatency(Math.round(roundTrip));
        }
        if (merged !== latest.current) { latest.current = merged; setRoom(merged); }
        setOnline(true); setUnavailable(false); setError('');
    }, []);
    const request = useCallback(async (body?: Record<string, unknown>, compact = false) => {
        const started = performance.now();
        const data = await jsonRequest<RoomUpdate>('/api/room' + (!body && compact ? '?live=1' : ''), body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
        return { data, elapsed: performance.now() - started };
    }, [jsonRequest]);
    const refresh = useCallback(async (full = false): Promise<void> => {
        if (session.current.readToken === null) { if (full) refreshAgain.current = true; return; }
        if (polling.current) { if (full) refreshAgain.current = true; return polling.current; }
        const run = async () => {
            do {
                const started = session.current.readToken;
                if (started === null) return;
                const complete = full || refreshAgain.current || !latest.current || Date.now() - lastFull.current > 15000;
                refreshAgain.current = false; full = false;
                let cancelled = false;
                try {
                    const result = await request(undefined, !complete);
                    if (!session.current.accepts(started)) continue;
                    const previous = latest.current?.game;
                    apply(result.data, result.elapsed);
                    if (complete) lastFull.current = Date.now();
                    else if (previous?.status !== result.data.game?.status || previous?.id !== result.data.game?.id) refreshAgain.current = true;
                } catch (e) {
                    cancelled = isCancelled(e);
                    // StrictMode re-subscribes while an aborted request settles;
                    // keep its queued refresh instead of dropping the new mount.
                    if (cancelled || !session.current.accepts(started)) continue;
                    if ((e as { status?: number }).status === 401) clear();
                    else { setOnline(false); setUnavailable(!latest.current); setError((e as Error).message); }
                    refreshAgain.current = false;
                } finally { if (!cancelled && session.current.accepts(started)) setReady(true); }
            } while (refreshAgain.current);
        };
        polling.current = run();
        try { await polling.current; } finally { polling.current = null; }
    }, [apply, clear, request]);
    useEffect(() => { void refresh(true); }, [refresh]);
    useEffect(() => {
        const resume = () => { if (!document.hidden) void refresh(true); };
        window.addEventListener('online', resume); document.addEventListener('visibilitychange', resume);
        return () => { window.removeEventListener('online', resume); document.removeEventListener('visibilitychange', resume); };
    }, [refresh]);
    useEffect(() => {
        if (!unavailable) return;
        const timer = setInterval(() => { if (!document.hidden) void refresh(true); }, 5000);
        return () => clearInterval(timer);
    }, [unavailable, refresh]);
    const me = room?.me;
    useEffect(() => {
        if (!me) return;
        const player = me;
        let stopped = false, retry: ReturnType<typeof setTimeout>, heartbeat: ReturnType<typeof setInterval>, attempt = 0;
        function connect() {
            if (stopped) return;
            const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/live`);
            socket.current = ws;
            let lastPong = Date.now(), pingAt = 0;
            const ping = () => { if (!pingAt && ws.readyState === WebSocket.OPEN) { pingAt = performance.now(); ws.send('ping'); } };
            ws.onopen = () => { if (stopped) { ws.close(); return; } attempt = 0; setLive(true); setLatency(null); ping(); void refresh(true); };
            ws.onmessage = event => {
                const current = latest.current;
                if (stopped || session.current.readToken === null || !current || current.me !== player) return;
                if (event.data === 'pong') { lastPong = Date.now(); if (pingAt) setLatency(Math.round(performance.now() - pingAt)); pingAt = 0; return; }
                try {
                    const message = JSON.parse(event.data);
                    if (message.type === 'locked') { clear(); return; }
                    if (message.type === 'receipt') {
                        const start = pendingReceipts.current.get(message.moveId);
                        pendingReceipts.current.delete(message.moveId);
                        if (start!==undefined && performance.now()-start<30000) setDeliverySamples(samples=>[...samples,Math.round(performance.now()-start)].slice(-20));
                        return;
                    }
                    if (message.type !== 'game' || !message.game || ![message.game.white, message.game.black].includes(player)) return;
                    const previous = current.game;
                    apply({ me: player, game: message.game, serverNow: message.serverNow });
                    if (previous?.status !== message.game.status || previous?.id !== message.game.id) void refresh(true);
                } catch { void refresh(); }
            };
            heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) { if (Date.now() - lastPong > 25000) ws.close(); else ping(); } }, 10000);
            ws.onerror = () => ws.close();
            ws.onclose = () => { clearInterval(heartbeat); if (stopped) return; setLive(false); setLatency(null); void refresh(); retry = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 10000)); };
        }
        connect();
        return () => { stopped = true; clearTimeout(retry); clearInterval(heartbeat); socket.current?.close(); socket.current = null; setLive(false); };
    }, [me, apply, clear, refresh]);
    useEffect(() => {
        if (!me) return;
        let stop = false, timer: ReturnType<typeof setTimeout>;
        const tick = async () => {
            await refresh(!['pending', 'active'].includes(latest.current?.game?.status || ''));
            if (!stop) timer = setTimeout(tick, roomPollDelay(latest.current?.game || null, socket.current?.readyState === WebSocket.OPEN, document.hidden, Date.now() + offset.current));
        };
        timer = setTimeout(tick, 1000);
        return () => { stop = true; clearTimeout(timer); };
    }, [me, refresh]);
    useEffect(() => {
        if (!me) return;
        const controller = new AbortController();
        const beat = () => { if (!document.hidden) void fetch('/api/room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'presence'}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)])}).catch(()=>{}); };
        beat(); const timer=setInterval(beat,25000); document.addEventListener('visibilitychange',beat);
        return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',beat);};
    },[me]);
    const game = room?.game;
    useEffect(() => {
        if (!game?.delivery || game.delivery.player===me || document.hidden) return;
        let second=0;
        const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>{
            if (!document.hidden && socket.current?.readyState===WebSocket.OPEN) socket.current.send(JSON.stringify({type:'seen',gameId:game.id,version:game.version,moveId:game.delivery!.id}));
        });});
        return()=>{cancelAnimationFrame(first);cancelAnimationFrame(second);};
    },[game,me]);
    useEffect(() => {
        if (game?.status !== 'active') return;
        const remaining = clockMs(game, game.fen.split(' ')[1] === 'w' ? 'w' : 'b', Date.now() + offset.current);
        const timer = setTimeout(() => void refresh(), Math.max(80, remaining + 80));
        return () => clearTimeout(timer);
    }, [game, refresh, clockOffset]);
    const act = useCallback(async (action: string, details: Record<string, unknown> = {}): Promise<Room> => {
        if (acting.current) throw new Error('Please wait for the current action.');
        acting.current = true; setBusy(true);
        const changesSession = action === 'login' || action === 'logout';
        if (changesSession) session.current.beginChange();
        const started = session.current.token;
        let cancelled = false;
        try {
            const g = latest.current?.game;
            const moveId=action==='move'?crypto.randomUUID():undefined;
            if (moveId) { for (const [id,time] of pendingReceipts.current) if (performance.now()-time>30000) pendingReceipts.current.delete(id); pendingReceipts.current.set(moveId,performance.now()); if(pendingReceipts.current.size>8)pendingReceipts.current.delete(pendingReceipts.current.keys().next().value!); }
            const result = await request({ action, compact: true, ...(g ? { gameId: g.id, version: g.version } : {}), ...details, ...(moveId?{moveId}:{}) });
            if (!session.current.accepts(started)) throw new Error('The session changed.');
            if (action === 'logout') { clear(); return result.data as Room; }
            apply(result.data, result.elapsed);
            if (action === 'move') setMoveLatency(Math.round(result.elapsed));
            if (action !== 'move' || result.data.game?.status !== 'active') void refresh(true);
            return latest.current!;
        } catch (e) {
            cancelled = isCancelled(e);
            if (cancelled) throw e;
            const err = e as Error & { status?: number };
            setError(err.message);
            if (action !== 'login') toast.error(err.message);
            if (err.status === 401 && action !== 'login') clear();
            else if (action !== 'login') await refresh(true);
            throw e;
        } finally {
            acting.current = false;
            if (changesSession) session.current.endChange();
            if (!cancelled) { setBusy(false); if (changesSession) void refresh(true); }
        }
    }, [apply, clear, refresh, request]);
    return { room, busy, ready, unavailable, error, online, live, latency, moveLatency, deliverySamples, offset: clockOffset, act, retry: () => void refresh(true) };
}
