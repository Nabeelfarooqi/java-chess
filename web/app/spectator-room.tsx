'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Color } from 'chess.js';
import { ArrowDownUp, Eye, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { replay } from '@/lib/game';
import { materialSummary } from '@/lib/material';
import type { SpectatorRoom as Snapshot } from '@/lib/spectator';
import { CharacterPortrait } from './character-art';
import { ChessBoard } from './chess-board';
import { CapturedMaterial } from './captured-material';
import { PlayerClock } from './player-clock';

const noop = () => {};
export default function SpectatorRoom({ playerView = false, onClose }: { playerView?: boolean; onClose?: () => void }) {
    const endpoint = playerView ? '/api/room?watch=1' : '/api/spectate';
    const Container = playerView ? 'section' : 'main';
    const [data, setData] = useState<Snapshot | null>(null), [unlocked, setUnlocked] = useState(false), [ready, setReady] = useState(false);
    const [selectedId, setSelectedId] = useState(''), [orientation, setOrientation] = useState<Color>('w');
    const [pin, setPin] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [online, setOnline] = useState(true), [offset, setOffset] = useState(0);
    const [refreshKey, setRefreshKey] = useState(0);
    const epoch = useRef(0);
    useEffect(() => {
        let stopped = false, timer: ReturnType<typeof setTimeout>;
        const controller = new AbortController(), current = ++epoch.current;
        async function poll() {
            if (document.hidden) { timer = setTimeout(poll, 10000); return; }
            const started = Date.now();
            try {
                const response = await fetch(endpoint + (selectedId ? (playerView ? '&game=' : '?game=') + encodeURIComponent(selectedId) : ''), {
                    credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
                });
                const body = await response.json() as Snapshot & { error?: string };
                if (stopped || current !== epoch.current) return;
                if (response.status === 401) { setData(null); setUnlocked(false); setReady(true); return; }
                if (!response.ok) throw new Error(body.error || 'Could not refresh the games.');
                const snapshot = body as Snapshot;
                setData(snapshot); setUnlocked(true); setOnline(true); setError('');
                setOffset(snapshot.serverNow - (Date.now() - Math.min((Date.now() - started) / 2, 500)));
                if (!snapshot.games.some(game => game.id === selectedId) && !snapshot.selectedGame) setSelectedId(snapshot.games[0]?.id || '');
            } catch (failure) {
                if (stopped || current !== epoch.current) return;
                setOnline(false); setError((failure as Error).message);
            } finally { if (!stopped && current === epoch.current) setReady(true); }
            if (!stopped && current === epoch.current) timer = setTimeout(poll, document.hidden ? 10000 : unlocked ? 1000 : 3000);
        }
        void poll();
        return () => { stopped = true; controller.abort(); clearTimeout(timer); };
    }, [unlocked, selectedId, refreshKey, endpoint, playerView]);
    useEffect(() => {
        const resume = () => { if (!document.hidden) setRefreshKey(value => value + 1); };
        window.addEventListener('online', resume); document.addEventListener('visibilitychange', resume);
        return () => { window.removeEventListener('online', resume); document.removeEventListener('visibilitychange', resume); };
    }, []);

    async function access(action: 'login' | 'logout') {
        if (busy) return;
        setBusy(true); setError('');
        const current = ++epoch.current;
        try {
            const response = await fetch('/api/spectate', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...(action === 'login' ? { pin } : {}) }), signal: AbortSignal.timeout(10000) });
            const body = await response.json() as { error?: string };
            if (current !== epoch.current) return;
            if (!response.ok && !(action === 'logout' && response.status === 401)) throw new Error(body.error || 'Could not update spectator access.');
            setPin(''); setData(null); setSelectedId(''); setUnlocked(action === 'login');
        } catch (failure) { if (current === epoch.current) setError((failure as Error).message); }
        finally { setBusy(false); setRefreshKey(value => value + 1); }
    }

    const game = data?.games.find(item => item.id === selectedId) || (data?.selectedGame?.id === selectedId ? data.selectedGame : null) || (!selectedId ? data?.games[0] : null) || null;
    const { chess, lastMove, material } = useMemo(() => {
        const chess = game ? replay(game) : new Chess();
        return { chess, lastMove: chess.history({ verbose: true }).at(-1) || null, material: materialSummary(chess) };
    }, [game?.id, game?.version, game?.fen]);
    const player = (color: Color) => data?.players.find(item => item.id === (color === 'w' ? game?.white : game?.black));
    const who = (id: string) => data?.players.find(item => item.id === id)?.name || 'Player';
    function playerRow(color: Color) {
        const person = player(color);
        return <div className="player-row character-player" data-color={color} data-character={person?.character || 'guest'}>
            <CharacterPortrait character={person?.character} name={person?.name}/>
            <div className="player-info"><strong>{person?.name || 'Player'}</strong><span><i className={`seat-color ${color}`}/>{color === 'w' ? 'White' : 'Black'}</span></div>
            <PlayerClock game={game} color={color} offset={offset} minutes={game?.minutes || 5}/>
            <CapturedMaterial color={color} name={person?.name || 'Player'} material={material}/>
        </div>;
    }
    if (!ready) return <div className="watch-loading" role="status"><Eye/><p>Loading live games…</p>{playerView && <Button onClick={onClose}>Back to playing</Button>}</div>;
    if (!unlocked && playerView) return <section className="spectator-empty"><Eye size={36}/><h2>{error ? 'Could not load games.' : 'Your session has expired.'}</h2><p>{error || 'Return to the room and enter your player PIN again.'}</p><Button onClick={onClose}>Back to playing</Button></section>;
    if (!unlocked) return <main className="spectator-gate"><a className="spectator-back" href="/">← Player sign-in</a><Eye size={34}/><h1>Watch the rivalry.</h1><p>Enter the shared spectator code to watch live games.</p>
        <form className="gate" onSubmit={event => { event.preventDefault(); void access('login'); }}><label htmlFor="spectator-code">Spectator PIN</label><div className="code-row"><Input id="spectator-code" type="password" inputMode="numeric" autoComplete="off" placeholder="6-digit spectator code" maxLength={6} value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, ''))}/><Button disabled={busy || pin.length !== 6} type="submit">{busy ? 'Opening…' : 'Watch games'}</Button></div>{error && <p className="error" role="alert">{error}</p>}<p className="muted">Watch only. Player PINs are used on the player sign-in page.</p></form>
    </main>;
    return <Container className={`club spectator-club ${game?.status === 'active' ? 'game-active' : ''}`}>
        <header className="club-header"><div className="spectator-heading"><Eye size={22}/><div><strong>{playerView ? 'Watching the fellas' : 'Spectator room'}</strong><p>Watch only · updates about every second</p></div></div><Button variant="ghost" aria-label={playerView ? "Back to playing" : "Lock spectator view"} onClick={playerView ? onClose : () => void access('logout')} disabled={busy}>{!playerView && <LockKeyhole size={17}/>}<span>{playerView ? 'Back to playing' : 'Lock'}</span></Button></header>
        {error && <p className="connection-warning" role="alert">{online ? error : 'Connection interrupted. This board may be behind. Reconnecting…'}</p>}
        <section className="spectator-picker"><label htmlFor="watch-game">Choose a live game</label><select id="watch-game" value={game?.id || ''} onChange={event => setSelectedId(event.target.value)} disabled={!data?.games.length}>
            {!game && <option value="">Waiting for a game</option>}
            {data?.games.map(item => <option key={item.id} value={item.id}>{who(item.white)} vs {who(item.black)} · {item.minutes}+{item.increment}</option>)}
            {game && !data?.games.some(item => item.id === game.id) && <option value={game.id}>{who(game.white)} vs {who(game.black)} · Finished</option>}
        </select></section>
        {game ? <section className="board-column">{playerRow(orientation === 'w' ? 'b' : 'w')}
            <ChessBoard whiteCharacter={player('w')?.character} blackCharacter={player('b')?.character} fen={game.fen} orientation={orientation} color={orientation} active={false} canMove={false} online={online} lastMove={lastMove} premove={null} onMove={noop} onCancel={noop}/>
            {playerRow(orientation)}<div className="board-tools"><span className="board-status" role="status">{game.status === 'finished' ? `${game.winner ? who(game.winner) + ' won' : 'Draw'} · ${game.reason}` : `${player(chess.turn())?.name || 'Player'}’s turn${chess.isCheck() ? ' · Check' : ''}`}</span><div className="board-buttons"><Button variant="ghost" size="icon" aria-label="Flip board" onClick={() => setOrientation(orientation === 'w' ? 'b' : 'w')}><ArrowDownUp size={18}/></Button></div></div>
        </section> : <section className="spectator-empty"><Eye size={36}/><h2>{playerView ? 'No rivals playing right now.' : 'No games in progress.'}</h2><p>A game will appear here once both players start playing.</p></section>}
        {!playerView && <footer><a href="/">Back to playing</a><span>RIVAL ROOM · SPECTATOR</span></footer>}
    </Container>;
}
