'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Square, type PieceSymbol } from 'chess.js';
import { ArrowRight, ArrowDownUp, Link2, LockKeyhole, LogOut, Settings2, Flag, Handshake, Download, Clock3, Zap, Trophy, History, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Toaster, toast } from 'sonner';
import { Entry } from './entry';
import { clockMs, opponent, pgn, replay, type Game, type PlayerId, type Room } from '@/lib/game';
const glyph: Record<PieceSymbol, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const pieceName: Record<PieceSymbol, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
function time(ms: number) { const sec = Math.ceil(ms / 1000); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }
function download(name: string, data: string, type = 'text/plain') { const url = URL.createObjectURL(new Blob([data], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
async function api(body?: Record<string, unknown>) { const response = await fetch('/api/room', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' } : { cache: 'no-store', credentials: 'same-origin' }); const data = await response.json() as Room & {
    error?: string;
}; if (!response.ok)
    throw Object.assign(new Error(data.error || 'Enter your code to open the room.'), { status: response.status }); return data as Room; }
export default function RivalRoom() {
    const [room, setRoom] = useState<Room | null>(null), [busy, setBusy] = useState(false), [ready, setReady] = useState(false), [error, setError] = useState(''), [online, setOnline] = useState(true);
    const latest = useRef<Room | null>(null), offset = useRef(0), polling = useRef(false), epoch = useRef(0);
    const apply = useCallback((r: Room) => { if (!r.me)
        return; const old = latest.current; if (old && old.me === r.me && ((old.game && r.game && old.game.id === r.game.id && old.game.version > r.game.version) || old.serverNow > r.serverNow))
        return; latest.current = r; offset.current = r.serverNow - Date.now(); setRoom(r); setOnline(true); setError(''); }, []);
    const refresh = useCallback(async () => { if (polling.current)
        return; polling.current = true; const started = epoch.current; try {
        const result = await api(); if(started === epoch.current) apply(result);
    }
    catch (e) {
        if(started !== epoch.current) return;
        if ((e as {
            status: number;
        }).status === 401) {
            latest.current = null;
            setRoom(null);
        }
        else {
            setOnline(false);
            setError((e as Error).message);
        }
    }
    finally {
        setReady(true);
        polling.current = false;
    } }, [apply]);
    useEffect(() => { void refresh(); }, [refresh]);
    useEffect(() => { if (!room)
        return; let stop = false; let timer: ReturnType<typeof setTimeout>; async function tick() { await refresh(); if (!stop)
        timer = setTimeout(tick, document.hidden ? 3000 : latest.current?.game?.status === 'active' ? 700 : 2500); } timer = setTimeout(tick, 700); const onVisible = () => { if (!document.hidden)
        void refresh(); }; document.addEventListener('visibilitychange', onVisible); return () => { stop = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); }; }, [!!room, refresh]);
    const act = useCallback(async (action: string, details: Record<string, unknown> = {}) => { if (busy)
        throw new Error('Please wait for the current action.'); setBusy(true); if(action === 'login' || action === 'logout') epoch.current++; try {
        const g = latest.current?.game;
        const r = await api({ action, ...(g ? { gameId: g.id, version: g.version } : {}), ...details });
        if (action === 'logout') {
            latest.current = null;
            setRoom(null);
        }
        else
            apply(r);
        return r;
    }
    catch (e) {
        const err = e as Error & {
            status: number;
        };
        setError(err.message);
        if (action !== 'login')
            toast.error(err.message);
        if (err.status === 409)
            await refresh();
        if (err.status === 401 && action !== 'login') {
            latest.current = null;
            setRoom(null);
        }
        throw e;
    }
    finally {
        setBusy(false);
    } }, [busy, apply, refresh]);
    const run = (action: string, details: Record<string, unknown> = {}) => { void act(action, details).catch(() => { }); };
    if (!ready)
        return <main className="loading-room"><span className="brand-mark">♞</span><p>Opening the room…</p></main>;
    return <>{room ? <Club room={room} busy={busy} online={online} offset={offset.current} act={act} run={run}/> : <Entry onEnter={pin => run('login', { pin })} busy={busy} error={error}/>}<Toaster theme="dark" richColors position="bottom-center"/></>;
}
export function Club({ room, busy, online, offset, act, run }: {
    room: Room;
    busy: boolean;
    online: boolean;
    offset: number;
    act: (action: string, details?: Record<string, unknown>) => Promise<Room>;
    run: (action: string, details?: Record<string, unknown>) => void;
}) {
    const [minutes, setMinutes] = useState('5'), [increment, setIncrement] = useState(false), [selected, setSelected] = useState<Square | null>(null), [flip, setFlip] = useState(false), [now, setNow] = useState(Date.now()), [promotion, setPromotion] = useState<{
        from: Square;
        to: Square;
    } | null>(null), [confirm, setConfirm] = useState(false), [settings, setSettings] = useState(false), [name, setName] = useState(''), [historyGame, setHistoryGame] = useState<Game | null>(null), [copied, setCopied] = useState(false);
    const { me, game: g } = room;
    const rival = opponent(me);
    const who = (p: PlayerId) => room.players.find(x => x.id === p)?.name || (p === 'one' ? 'Nabeel' : 'Your rival');
    const board = useMemo(() => new Chess(g?.fen), [g?.fen]);
    const myColor = g ? (g.white === me ? 'w' : 'b') : 'w';
    const orientation = (myColor === 'b') !== flip ? 'b' : 'w';
    const myTurn = g?.status === 'active' && board.turn() === myColor;
    const active = g?.status === 'active';
    const legal = useMemo(() => selected && myTurn ? board.moves({ square: selected, verbose: true }) : [], [board, selected, myTurn]);
    const lastMove = useMemo(() => { if (!g?.moves.length)
        return null; return replay(g).history({ verbose: true }).at(-1) || null; }, [g?.moves.length, g?.id]);
    useEffect(() => { const id = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(id); }, []);
    useEffect(() => { setSelected(null); setPromotion(null); }, [g?.version, g?.id]);
    useEffect(() => {
        const context = (document as unknown as {
            modelContext?: {
                registerTool: (tool: unknown, options: unknown) => Promise<void>;
            };
        }).modelContext;
        if (!context?.registerTool)
            return;
        const lifecycle = new AbortController();
        const register = (tool: unknown) => { try {
            void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => { });
        }
        catch { } };
        register({ name: 'read_chess_room', title: 'Read chess room', description: 'Read the current game, clocks, and head-to-head record for the unlocked room.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: async () => ({ game: g, me, stats: room.stats }) });
        register({ name: 'create_chess_challenge', title: 'Challenge your rival', description: 'Create a timed challenge. Your opponent must accept before the clocks start.', inputSchema: { type: 'object', properties: { minutes: { type: 'integer', enum: [1, 3, 5, 10] }, increment: { type: 'integer', enum: [0, 2] } }, required: ['minutes', 'increment'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: async (input: {
                minutes: number;
                increment: number;
            }) => { if (![1, 3, 5, 10].includes(input.minutes) || ![0, 2].includes(input.increment))
                throw new Error('Invalid time control.'); const result = await act('create', input); return { gameId: result.game?.id, status: result.game?.status }; } });
        register({ name: 'play_chess_move', title: 'Play a chess move', description: 'Submit a legal move in the active game as the current player.', inputSchema: { type: 'object', properties: { from: { type: 'string', pattern: '^[a-h][1-8]$' }, to: { type: 'string', pattern: '^[a-h][1-8]$' }, promotion: { type: 'string', enum: ['q', 'r', 'b', 'n'] } }, required: ['from', 'to'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: async (input: {
                from: string;
                to: string;
                promotion?: string;
            }) => { if (!/^[a-h][1-8]$/.test(input.from) || !/^[a-h][1-8]$/.test(input.to))
                throw new Error('Invalid square.'); const result = await act('move', input); return { fen: result.game?.fen, status: result.game?.status }; } });
        return () => lifecycle.abort();
    }, [act, g, me, room.stats]);
    const move = (from: Square, to: Square, p?: string) => { setSelected(null); run('move', { from, to, ...(p ? { promotion: p } : {}) }); };
    function clickSquare(square: Square) { if (!myTurn || busy || !online)
        return; const piece = board.get(square); if (piece?.color === myColor) {
        setSelected(selected === square ? null : square);
        return;
    } const possible = legal.filter(m => m.to === square); if (selected && possible.length) {
        if (possible.some(m => m.promotion)) {
            setPromotion({ from: selected, to: square });
            return;
        }
        move(selected, square);
    }
    else
        setSelected(null); }
    async function share() { try {
        await navigator.clipboard.writeText(location.origin);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        toast.success('Link copied. Send it with your friend’s own code.');
    }
    catch {
        toast.error('Copy the link from your browser’s address bar.');
    } }
    async function exportAll() { try {
        const r = await fetch('/api/room?export=all', { cache: 'no-store' });
        if (!r.ok)
            throw new Error();
        download('rival-room-backup.json', JSON.stringify(await r.json(), null, 2), 'application/json');
        toast.success('Your record has been exported.');
    }
    catch {
        toast.error('Could not export right now. Please try again.');
    } }
    const lower = orientation === 'w' ? (g?.white || me) : (g?.black || rival);
    const upper = opponent(lower);
    function playerRow(id: PlayerId) { const color = g ? (g.white === id ? 'w' : 'b') : (id === me ? 'w' : 'b'); const playing = active && board.turn() === color; const ms = g ? clockMs(g, color, now + offset) : Number(minutes) * 60000; return <div className={`player-row ${playing ? 'playing' : ''}`}><div className={`avatar ${id === me ? 'self' : ''}`}>{who(id).slice(0, 1).toUpperCase()}</div><div className="player-info"><strong>{who(id)} {id === me && <small>YOU</small>}</strong><span>{color === 'w' ? 'White pieces' : 'Black pieces'}{playing ? ' · On the clock' : ''}</span></div><div className={`clock ${playing ? 'ticking' : ''} ${ms < 10000 && active ? 'urgent' : ''}`}><Clock3 size={17}/>{time(ms)}</div></div>; }
    let status = !g ? 'The board is yours.' : g.status === 'pending' ? (g.challenger === me ? 'Challenge sent.' : 'You’ve been challenged.') : g.status === 'active' ? (myTurn ? (board.isCheck() ? 'You’re in check.' : 'Your move.') : `${who(rival)}’s move.`) : g.status === 'finished' ? (g.winner === me ? 'Bragging rights: yours.' : g.winner ? 'They got this one.' : 'Evenly matched.') : 'Ready for the next one?';
    return <main className="club"><header className="club-header"><div className="brand"><span className="brand-mark">♞</span> RIVAL ROOM <span className="private-badge"><LockKeyhole size={11}/> JUST YOU TWO</span></div><div className="header-actions"><span className={`connection ${online ? '' : 'offline'}`}><i />{online ? 'Connected' : 'Reconnecting…'}</span><Button aria-label="Invite your rival" variant="outline" onClick={share}><Link2 size={15}/><span>{copied ? 'Copied' : 'Invite your rival'}</span></Button><Button aria-label="Room settings" size="icon" variant="ghost" onClick={() => { setName(who(me)); setSettings(true); }}><Settings2 /></Button></div></header>
 <section className="club-title"><div><p className="eyebrow">THE RIVALRY CONTINUES</p><h1>{status}</h1></div><div className="score-chip"><Trophy size={17}/><b>{room.stats.one.wins}</b><span>—</span><b>{room.stats.two.wins}</b><small>ALL-TIME WINS</small></div></section>
 {!online && <p role="alert" className="connection-warning">Connection interrupted. Clocks keep running. Your board will reconnect automatically.</p>}
 <div className="club-grid"><section className="board-column">{playerRow(upper)}<div className="board-frame"><div className="chessboard" role="group" aria-label="Chess board">{Array.from({ length: 64 }, (_, i) => { const rank = orientation === 'w' ? 8 - Math.floor(i / 8) : 1 + Math.floor(i / 8); const file = orientation === 'w' ? i % 8 : 7 - i % 8; const sq = ('abcdefgh'[file] + rank) as Square; const piece = board.get(sq); const target = legal.some(m => m.to === sq); const checked = piece?.type === 'k' && piece.color === board.turn() && board.isCheck(); return <button key={sq} aria-label={`${sq}${piece ? ' ' + (piece.color === 'w' ? 'white' : 'black') + ' ' + pieceName[piece.type] : ''}`} aria-pressed={selected === sq} className={`square ${(file + rank) % 2 ? 'light' : 'dark'} ${selected === sq ? 'selected' : ''} ${lastMove && (lastMove.from === sq || lastMove.to === sq) ? 'last-move' : ''} ${checked ? 'in-check' : ''}`} onClick={() => clickSquare(sq)}>{i % 8 === 0 && <span className="rank">{rank}</span>}{piece && <span className={`piece ${piece.color === 'w' ? 'white-piece' : 'black-piece'}`} aria-hidden="true">{glyph[piece.type]}</span>}{target && <span className={`legal-dot ${piece ? 'capture' : ''}`}/>}{i >= 56 && <span className="file">{'abcdefgh'[file]}</span>}</button>; })}</div></div>{playerRow(lower)}<div className="board-tools"><span>{active ? 'Tap a piece, then a highlighted square.' : g?.status === 'finished' ? g.reason : 'Clocks start when your rival accepts.'}</span><Button variant="ghost" size="sm" onClick={() => setFlip(!flip)}><ArrowDownUp size={14}/>Flip board</Button></div></section>
 <aside className="room-panel"><Tabs defaultValue="game"><TabsList className="panel-tabs"><TabsTrigger value="game"><Zap size={14}/>Play</TabsTrigger><TabsTrigger value="record"><History size={14}/>The record</TabsTrigger></TabsList><TabsContent value="game">
 {!g || ['finished', 'cancelled'].includes(g.status) ? <><div className="panel-section"><p className="eyebrow">{g?.status === 'finished' ? 'RUN IT BACK' : 'SET THE PACE'}</p><h2>{g?.status === 'finished' ? 'One more game?' : 'Make your move.'}</h2><p className="panel-copy">Pick a clock. Challenge your rival.</p><RadioGroup value={minutes} onValueChange={setMinutes} className="time-options" aria-label="Minutes per player">{['1', '3', '5', '10'].map((v, i) => <Label className={`time-option ${minutes === v ? 'chosen' : ''}`} key={v} htmlFor={'time-' + v}><RadioGroupItem id={'time-' + v} value={v}/><strong>{v}<small> min</small></strong><span>{['Bullet', 'Blitz', 'Blitz', 'Rapid'][i]}</span></Label>)}</RadioGroup><div className="increment-option"><div><Label htmlFor="increment">A little breathing room</Label><p>+2 seconds after every move</p></div><Switch id="increment" checked={increment} onCheckedChange={setIncrement}/></div><Button className="main-action" disabled={busy || !online} onClick={() => run('create', { minutes: Number(minutes), increment: increment ? 2 : 0 })}>{busy ? 'Sending…' : g?.status === 'finished' ? 'Challenge to a rematch' : 'Challenge your rival'}<ArrowRight size={17}/></Button><p className="panel-note">You both play on this link. Colors alternate each game.</p></div></> :
            g.status === 'pending' ? <div className="panel-section challenge"><div className="challenge-icon"><Clock3 size={25}/></div><p className="eyebrow">{g.challenger === me ? 'WAITING FOR YOUR RIVAL' : 'GAME ON?'}</p><h2>{g.minutes} + {g.increment}</h2><p className="panel-copy">{g.minutes} minutes each{g.increment ? `, plus ${g.increment} seconds per move` : '. No increment.'}</p><p className="challenge-seat">You have the {myColor === 'w' ? 'white' : 'black'} pieces.</p>{g.challenger !== me ? <Button className="main-action" disabled={busy || !online} onClick={() => run('accept')}>Accept & start clocks<ArrowRight /></Button> : <p className="waiting"><span />Waiting for {who(rival)} to accept</p>}<Button variant="ghost" className="full-width" disabled={busy || !online} onClick={() => run('cancel')}>{g.challenger === me ? 'Cancel challenge' : 'Decline challenge'}</Button><p className="panel-note">A challenge expires after 15 minutes.</p></div> :
                <div className="panel-section"><div className="live-heading"><span className="live-label"><i /> IN PLAY</span><span>{g.minutes} + {g.increment}</span></div><h2>{myTurn ? 'Your turn.' : 'Their turn.'}</h2><p className="panel-copy">{board.isCheck() ? 'The king is in check.' : 'Keep your eye on the clock.'}</p><MoveList moves={g.moves}/>{g.drawOffer && <div className="draw-notice">{g.drawOffer === me ? <p>Draw offered. Waiting for your rival.</p> : <><p>Your rival offered a draw.</p><Button disabled={busy || !online} onClick={() => run('acceptDraw')}>Accept draw</Button><Button variant="ghost" disabled={busy || !online} onClick={() => run('declineDraw')}>Decline</Button></>}</div>}<div className="game-actions"><Button variant="outline" disabled={busy || !online || !!g.drawOffer} onClick={() => run('offerDraw')}><Handshake size={15}/>Draw</Button><Button variant="outline" disabled={busy || !online} onClick={() => setConfirm(true)}><Flag size={15}/>Resign</Button></div></div>}
 {g?.status === 'finished' && <div className="result-card"><span className="eyebrow">RESULT SAVED</span><h3>{g.winner ? `${who(g.winner)} won` : 'A draw'}</h3><p>{g.reason} · {Math.ceil(g.moves.length / 2)} moves</p><Button variant="ghost" size="sm" onClick={() => download('rival-room-game.pgn', pgn(g, room.players))}><Download size={13}/>Save PGN</Button></div>}
 <div className="rivalry-strip"><span className="eyebrow">THE HEAD-TO-HEAD</span><div><b>{who(me)}</b><strong>{room.stats[me].wins}<span> : </span>{room.stats[rival].wins}</strong><b>{who(rival)}</b></div><p>{room.stats[me].draws} drawn · {room.stats[me].wins + room.stats[me].losses + room.stats[me].draws} games played</p></div>
 </TabsContent><TabsContent value="record"><div className="panel-section"><p className="eyebrow">BRAGGING RIGHTS, IN WRITING</p><h2>The record.</h2><div className="stat-grid">{(['wins', 'losses', 'draws'] as const).map(k => <div key={k}><strong>{room.stats[me][k]}</strong><span>{k}</span></div>)}</div><div className="history-heading"><span>RECENT GAMES</span><Button variant="ghost" size="sm" onClick={exportAll}><Download size={13}/>Export all</Button></div>{room.recent.length === 0 ? <div className="empty-history"><Trophy size={28}/><h3>A clean scorecard.</h3><p>Your first finished game starts the story.</p></div> : <div className="history-list">{room.recent.map(h => <button className="history-row" key={h.id} onClick={() => setHistoryGame(h)}><span className={`result-letter ${h.winner === me ? 'win' : !h.winner ? 'draw' : 'loss'}`}>{h.winner === me ? 'W' : !h.winner ? 'D' : 'L'}</span><div><strong>{h.winner === me ? 'You won' : !h.winner ? 'Draw' : `${who(rival)} won`}</strong><span>{h.minutes}+{h.increment} · {h.reason}</span></div><ChevronRight size={15}/></button>)}</div>}<p className="panel-note">All-time totals include every finished game. Showing the latest 20. Cancelled challenges don’t count.</p></div></TabsContent></Tabs></aside></div>
 <footer><span>RIVAL ROOM · JUST THE TWO OF YOU</span><span>One board. A lasting rivalry.</span></footer>
 <Dialog open={!!promotion} onOpenChange={open => { if (!open)
        setPromotion(null); }}><DialogContent><DialogHeader><DialogTitle>Promote your pawn</DialogTitle><DialogDescription>Choose the piece to complete your move. Your clock is still running.</DialogDescription></DialogHeader><div className="promotion-choices">{(['q', 'r', 'b', 'n'] as const).map(p => <Button variant="outline" key={p} onClick={() => { if (promotion)
        move(promotion.from, promotion.to, p); setPromotion(null); }}><span>{glyph[p]}</span>{pieceName[p]}</Button>)}</div></DialogContent></Dialog>
 <Dialog open={confirm} onOpenChange={setConfirm}><DialogContent><DialogHeader><DialogTitle>Concede this game?</DialogTitle><DialogDescription>Your rival will get a win, and this game will be saved as a loss for you.</DialogDescription></DialogHeader><div className="dialog-actions"><Button variant="outline" onClick={() => setConfirm(false)}>Keep playing</Button><Button disabled={busy || !online} onClick={() => { run('resign'); setConfirm(false); }}>Resign game</Button></div></DialogContent></Dialog>
 <Dialog open={settings} onOpenChange={setSettings}><DialogContent><DialogHeader><DialogTitle>Your seat at the table</DialogTitle><DialogDescription>Your personal PIN identifies your player. Keep it to yourself.</DialogDescription></DialogHeader><Label htmlFor="display-name">Your display name</Label><Input id="display-name" value={name} onChange={e => setName(e.target.value)} maxLength={24}/><Button disabled={busy || !name.trim()} onClick={() => { void act('rename', { name }).then(() => { setSettings(false); toast.success('Name updated.'); }).catch(() => { }); }}>Save name</Button><div className="room-rules"><h3>Room rules</h3><p>Threefold repetition and the 50-move rule end games automatically. Clocks keep running if you close the page. A timeout is drawn when the other side has only a king, a single bishop or knight, or bishops on one color.</p><p>Records are saved online. Export a backup whenever you like.</p></div><div className="dialog-actions"><Button variant="outline" onClick={exportAll}><Download size={14}/>Export backup</Button><Button variant="ghost" disabled={busy} onClick={() => { setSettings(false); run('logout'); }}><LogOut size={14}/>Lock room</Button></div></DialogContent></Dialog>
 <Dialog open={!!historyGame} onOpenChange={open => { if (!open)
        setHistoryGame(null); }}><DialogContent><DialogHeader><DialogTitle>{historyGame?.winner ? `${who(historyGame.winner)} won` : 'Draw'}</DialogTitle><DialogDescription>{historyGame?.reason} · {historyGame?.minutes}+{historyGame?.increment} · {historyGame && new Date(historyGame.createdAt).toLocaleDateString()}</DialogDescription></DialogHeader>{historyGame && <><MoveList moves={historyGame.moves}/><Button onClick={() => download('rival-room-game.pgn', pgn(historyGame, room.players))}><Download size={15}/>Download game (PGN)</Button></>}</DialogContent></Dialog>
 </main>;
}
function MoveList({ moves }: {
    moves: string[];
}) { const box = useRef<HTMLDivElement>(null); useEffect(() => { if (box.current)
    box.current.scrollTop = box.current.scrollHeight; }, [moves.length]); return <div className="move-list" ref={box} aria-label="Move history">{!moves.length ? <p className="moves-empty">The first move is yours to make.</p> : Array.from({ length: Math.ceil(moves.length / 2) }, (_, i) => <div className="move-pair" key={i}><span>{i + 1}.</span><b>{moves[i * 2]}</b><b>{moves[i * 2 + 1] || '—'}</b></div>)}</div>; }
