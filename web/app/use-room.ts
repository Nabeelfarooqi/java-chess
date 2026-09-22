'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Room } from '@/lib/game';
import { mergeRoom, type RoomUpdate } from '@/lib/room-update';
export function useRoom() {
    const [room, setRoom] = useState<Room | null>(null), [busy, setBusy] = useState(false), [ready, setReady] = useState(false), [error, setError] = useState(''), [online, setOnline] = useState(true), [live, setLive] = useState(false);
    const latest = useRef<Room | null>(null), offset = useRef(0), epoch = useRef(0), acting = useRef(false), socket = useRef<WebSocket | null>(null), lastFull = useRef(0);
    const polling = useRef<Promise<void> | null>(null), refreshAgain = useRef(false);
    const clear = useCallback(() => { epoch.current++; latest.current = null; setRoom(null); socket.current?.close(); }, []);
    const apply = useCallback((data: RoomUpdate, roundTrip = 0) => {
        const merged = mergeRoom(latest.current, data);
        if (!merged) return;
        if (merged !== latest.current) { latest.current = merged; setRoom(merged); offset.current = data.serverNow - (Date.now() - Math.min(roundTrip / 2, 500)); }
        setOnline(true); setError('');
    }, []);
    const request = useCallback(async (body?: Record<string, unknown>, compact = false) => {
        const started = Date.now();
        const response = await fetch('/api/room' + (!body && compact ? '?live=1' : ''), { ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(10000) });
        const data = await response.json() as RoomUpdate & { error?: string };
        if (!response.ok) throw Object.assign(new Error(data.error || 'Enter your code to open the room.'), { status: response.status });
        return { data: data as RoomUpdate, elapsed: Date.now() - started };
    }, []);
    const refresh = useCallback(async (full = false): Promise<void> => {
        if (polling.current) { if (full) refreshAgain.current = true; return polling.current; }
        const run = async () => {
            do {
                const complete = full || refreshAgain.current || !latest.current || Date.now() - lastFull.current > 15000;
                refreshAgain.current = false; full = false;
                const started = epoch.current;
                try {
                    const result = await request(undefined, !complete);
                    if (started !== epoch.current) return;
                    const previous = latest.current?.game;
                    apply(result.data, result.elapsed);
                    if (complete) lastFull.current = Date.now();
                    else if (previous?.status !== result.data.game?.status || previous?.id !== result.data.game?.id) refreshAgain.current = true;
                } catch (e) {
                    if (started !== epoch.current) return;
                    if ((e as { status?: number }).status === 401) clear();
                    else { setOnline(false); setError((e as Error).message); }
                    refreshAgain.current = false;
                } finally { setReady(true); }
            } while (refreshAgain.current);
        };
        polling.current = run();
        try { await polling.current; } finally { polling.current = null; }
    }, [apply, clear, request]);
    useEffect(() => { void refresh(true); }, [refresh]);
    const me = room?.me;
    useEffect(() => {
        if (!me) return;
        const player = me;
        let stopped = false, retry: ReturnType<typeof setTimeout>, heartbeat: ReturnType<typeof setInterval>, attempt = 0;
        function connect() {
            if (stopped) return;
            const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/live`);
            socket.current = ws;
            let lastPong = Date.now();
            ws.onopen = () => { if (stopped) { ws.close(); return; } attempt = 0; setLive(true); void refresh(true); };
            ws.onmessage = event => {
                const current = latest.current;
                if (stopped || !current || current.me !== player) return;
                if (event.data === 'pong') { lastPong = Date.now(); return; }
                try {
                    const message = JSON.parse(event.data);
                    if (message.type === 'locked') { clear(); return; }
                    if (message.type !== 'game' || !message.game || ![message.game.white, message.game.black].includes(player)) return;
                    const previous = current.game;
                    apply({ me: player, game: message.game, serverNow: message.serverNow });
                    if (previous?.status !== message.game.status || previous?.id !== message.game.id) void refresh(true);
                } catch { void refresh(); }
            };
            heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) { if (Date.now() - lastPong > 45000) ws.close(); else ws.send('ping'); } }, 20000);
            ws.onerror = () => ws.close();
            ws.onclose = () => { clearInterval(heartbeat); if (stopped) return; setLive(false); void refresh(); retry = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 10000)); };
        }
        connect();
        return () => { stopped = true; clearTimeout(retry); clearInterval(heartbeat); socket.current?.close(); socket.current = null; setLive(false); };
    }, [me, apply, clear, refresh]);
    useEffect(() => {
        if (!me) return;
        let stop = false, timer: ReturnType<typeof setTimeout>;
        const tick = async () => {
            await refresh(!['pending', 'active'].includes(latest.current?.game?.status || ''));
            if (!stop) timer = setTimeout(tick, document.hidden ? 5000 : socket.current?.readyState === WebSocket.OPEN ? 2000 : latest.current?.game?.status === 'active' ? 350 : 1500);
        };
        timer = setTimeout(tick, 1000);
        const visible = () => { if (!document.hidden) void refresh(true); };
        window.addEventListener('online', visible); document.addEventListener('visibilitychange', visible);
        return () => { stop = true; clearTimeout(timer); window.removeEventListener('online', visible); document.removeEventListener('visibilitychange', visible); };
    }, [me, refresh]);
    const act = useCallback(async (action: string, details: Record<string, unknown> = {}): Promise<Room> => {
        if (acting.current) throw new Error('Please wait for the current action.');
        acting.current = true; setBusy(true);
        if (action === 'login' || action === 'logout') epoch.current++;
        const started = epoch.current;
        try {
            const g = latest.current?.game;
            const result = await request({ action, compact: true, ...(g ? { gameId: g.id, version: g.version } : {}), ...details });
            if (started !== epoch.current) throw new Error('The session changed.');
            if (action === 'logout') { clear(); return result.data as Room; }
            apply(result.data, result.elapsed);
            if (action !== 'move' || result.data.game?.status !== 'active') void refresh(true);
            return latest.current!;
        } catch (e) {
            const err = e as Error & { status?: number };
            setError(err.message);
            if (action !== 'login') toast.error(err.message);
            if (err.status === 401 && action !== 'login') clear();
            else if (action !== 'login') await refresh(true);
            throw e;
        } finally { acting.current = false; setBusy(false); }
    }, [apply, clear, refresh, request]);
    return { room, busy, ready, error, online, live, offset: offset.current, act };
}
