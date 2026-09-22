'use client';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Square } from 'chess.js';
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
import { opponent, pgn, replay, type Game, type PlayerId, type Room } from '@/lib/game';
import { ChessBoard } from './chess-board';
import { PlayerClock } from './player-clock';
import { useRoom } from './use-room';
import { getCharacter } from '@/lib/characters';
import { CharacterPortrait } from './character-art';
const GameReview = lazy(() => import('./game-review'));
import { glyph, pieceName, previewMove, premoveReady, type BoardMove } from '@/lib/board';
function download(name: string, data: string, type = 'text/plain') { const url = URL.createObjectURL(new Blob([data], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export default function RivalRoom() {
    const { room, busy, ready, error, online, offset, act } = useRoom();
    const run = useCallback((action: string, details: Record<string, unknown> = {}) => { void act(action, details).catch(() => {}); }, [act]);
    if (!ready) return <main className="loading-room"><span className="brand-mark">♞</span><p>Opening the room…</p></main>;
    return <>{room ? <Club key={room.me} room={room} busy={busy} online={online} offset={offset} act={act} run={run}/> : <Entry onEnter={pin => run('login', { pin })} busy={busy} error={error}/>}<Toaster theme="dark" richColors position="bottom-center"/></>;
}
export function Club({ room, busy, online, offset, act, run }: {
    room: Room;
    busy: boolean;
    online: boolean;
    offset: number;
    act: (action: string, details?: Record<string, unknown>) => Promise<Room>;
    run: (action: string, details?: Record<string, unknown>) => void;
}) {
    const [minutes, setMinutes] = useState('5'), [increment, setIncrement] = useState(false), [flip, setFlip] = useState(false), [promotion, setPromotion] = useState<{
        from: Square;
        to: Square;
    } | null>(null), [confirm, setConfirm] = useState(false), [settings, setSettings] = useState(false), [name, setName] = useState(''), [historyGame, setHistoryGame] = useState<Game | null>(null), [copied, setCopied] = useState(false);
    const [reviewGame, setReviewGame] = useState<Game | null>(null);
    const { me } = room;
    const characterOf = (id: PlayerId) => room.players.find(p => p.id === id)?.character;
    const character = getCharacter(characterOf(me));
    useEffect(() => {
        if (character) document.documentElement.dataset.character = character.key;
        else delete document.documentElement.dataset.character;
        return () => { delete document.documentElement.dataset.character; };
    }, [character]);
    const [selectedRival, setSelectedRival] = useState('');
    const playing = room.game && ['pending', 'active'].includes(room.game.status);
    const lastRival = room.game ? opponent(me, room.game) : '';
    const rival = playing ? lastRival : room.players.some(p => p.id === selectedRival && p.id !== me) ? selectedRival : lastRival || room.players.find(p => p.id !== me)?.id || '';
    const serverGame = room.game && lastRival === rival ? room.game : null;
    const [optimistic, setOptimistic] = useState<{ base: number; game: Game } | null>(null);
    const [premove, setPremove] = useState<(BoardMove & { gameId: string }) | null>(null);
    const queued = useRef<typeof premove>(null);
    const g = optimistic && serverGame?.id === optimistic.game.id && serverGame.version === optimistic.base ? optimistic.game : serverGame;
    const cancelPremove = useCallback(() => { queued.current = null; setPremove(null); }, []);
    const who = (p: PlayerId) => room.players.find(x => x.id === p)?.name || 'Player';
    const pair = room.headToHead[rival] || { wins: 0, losses: 0, draws: 0 };
    const board = useMemo(() => new Chess(g?.fen), [g?.fen]);
    const myColor = g ? (g.white === me ? 'w' : 'b') : 'w';
    const orientation = (myColor === 'b') !== flip ? 'b' : 'w';
    const myTurn = g?.status === 'active' && board.turn() === myColor;
    const active = g?.status === 'active';
    const lastMove = useMemo(() => { if (!g?.moves.length)
        return null; return replay(g).history({ verbose: true }).at(-1) || null; }, [g?.moves.length, g?.id]);
    useEffect(() => { cancelPremove(); setPromotion(null); setOptimistic(null); }, [serverGame?.id, me, cancelPremove]);
    useEffect(() => { if (!online || serverGame?.status !== 'active') { cancelPremove(); setPromotion(null); } }, [online, serverGame?.status, cancelPremove]);
    const submit = useCallback((move: BoardMove) => {
        if (!serverGame || busy || !online) return;
        try { setOptimistic({ base: serverGame.version, game: previewMove(serverGame, me, move, Date.now() + offset) }); }
        catch { toast.error('That move is no longer legal.'); return; }
        void act('move', move).catch(() => {}).finally(() => setOptimistic(null));
    }, [serverGame, me, busy, online, offset, act]);
    useEffect(() => {
        const next = queued.current;
        if (!next || !serverGame || busy || !online || serverGame.status !== 'active') return;
        if ((serverGame.fen.split(' ')[1] === 'w' ? serverGame.white : serverGame.black) !== me) return;
        cancelPremove();
        if (premoveReady(serverGame, me, next)) submit(next);
        else toast('Premove cancelled: it is no longer legal.');
    }, [serverGame, me, busy, online, submit, cancelPremove]);
    const move = useCallback((from: Square, to: Square, promotion?: BoardMove['promotion']) => {
        if (!g || !online || !active) return;
        const intent: BoardMove = { from, to, ...(promotion ? { promotion } : {}) };
        if (!myTurn) { const next = { ...intent, gameId: g.id }; queued.current = next; setPremove(next); }
        else { cancelPremove(); submit(intent); }
    }, [g, online, active, myTurn, cancelPremove, submit]);
    const chooseMove = useCallback((from: Square, to: Square) => {
        if (board.get(from)?.type === 'p' && ['1', '8'].includes(to[1])) setPromotion({ from, to });
        else move(from, to);
    }, [board, move]);
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
        register({ name: 'read_chess_room', title: 'Read chess room', description: 'Read the current game, clocks, and head-to-head record for the unlocked room.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: async () => ({ game: g, me, players: room.players, stats: room.stats, headToHead: room.headToHead }) });
        register({ name: 'create_chess_challenge', title: 'Challenge your rival', description: 'Create a timed challenge. Your opponent must accept before the clocks start.', inputSchema: { type: 'object', properties: { rival: { type: 'string', description: 'Player ID from the room roster' }, minutes: { type: 'integer', enum: [1, 3, 5, 10] }, increment: { type: 'integer', enum: [0, 2] } }, required: ['rival', 'minutes', 'increment'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: async (input: {
                rival: string;
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
    }, [act, g, me, room.stats, room.players, room.headToHead]);
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
    const upper = lower === me ? rival : me;
    function playerRow(id: PlayerId) {
        const color = g ? (g.white === id ? 'w' : 'b') : (id === me ? 'w' : 'b');
        return <div className="player-row character-player" data-character={characterOf(id) || 'guest'}>
            <CharacterPortrait character={characterOf(id)} name={who(id)}/><div className="player-info"><strong>{who(id)} {id === me && <small>YOU</small>}</strong><span>{color === 'w' ? 'White pieces' : 'Black pieces'}</span></div>
            <PlayerClock game={g} color={color} offset={offset} minutes={Number(minutes)}/>
        </div>;
    }
    let status = !g ? 'The board is yours.' : g.status === 'pending' ? (g.challenger === me ? 'Challenge sent.' : 'You’ve been challenged.') : g.status === 'active' ? (myTurn ? (board.isCheck() ? 'You’re in check.' : 'Your move.') : `${who(rival)}’s move.`) : g.status === 'finished' ? (g.winner === me ? 'Bragging rights: yours.' : g.winner ? 'They got this one.' : 'Evenly matched.') : 'Ready for the next one?';
    return <main className="club"><header className="club-header"><div className="club-identity"><CharacterPortrait character={characterOf(me)} name={who(me)} className="identity-portrait"/><div><div className="brand"><span className="brand-mark">♞</span> RIVAL ROOM <span className="private-badge"><LockKeyhole size={11}/> INVITE ONLY</span></div><p className="signed-in-player">You are <strong>{who(me)}</strong></p></div></div><div className="header-actions"><span className={`connection ${online ? '' : 'offline'}`}><i />{online ? 'Connected' : 'Reconnecting…'}</span><Button aria-label="Invite your rival" variant="outline" onClick={share}><Link2 size={15}/><span>{copied ? 'Copied' : 'Invite your rival'}</span></Button><Button aria-label="Room settings" size="icon" variant="ghost" onClick={() => { setName(who(me)); setSettings(true); }}><Settings2 /></Button></div></header>
 <section className="club-title"><div><p className="eyebrow">THE RIVALRY CONTINUES</p><h1>{status}</h1></div><div className="score-chip" aria-label={`${who(me)} ${pair.wins} wins, ${who(rival)} ${pair.losses} wins, ${pair.draws} draws`}><Trophy size={17}/><div className="score-player"><span>{who(me)}</span><b>{pair.wins}</b></div><span>—</span><div className="score-player"><span>{who(rival)}</span><b>{pair.losses}</b></div><small>HEAD-TO-HEAD</small></div></section>
 {!online && <p role="alert" className="connection-warning">Connection interrupted. Clocks keep running. Your board will reconnect automatically.</p>}
 <div className="club-grid"><section className="board-column">{playerRow(upper)}<ChessBoard whiteCharacter={characterOf(g?.white || me)} blackCharacter={characterOf(g?.black || rival)} fen={g?.fen || board.fen()} orientation={orientation} color={myColor} active={active} canMove={!busy && !optimistic} online={online} lastMove={lastMove} premove={premove} onMove={chooseMove} onCancel={cancelPremove}/>{playerRow(lower)}<div className="board-tools"><span>{active ? 'Drag a piece or tap two squares. Castle by moving the king two squares.' : g?.status === 'finished' ? g.reason : 'Clocks start when your rival accepts.'}</span><Button variant="ghost" size="sm" onClick={() => setFlip(!flip)}><ArrowDownUp size={14}/>Flip board</Button></div>{active && <div className={`premove-note ${premove ? 'queued' : ''}`} role="status">{premove ? <><span>Premove: {premove.from} → {premove.to}{premove.promotion ? ` = ${premove.promotion.toUpperCase()}` : ''}</span><Button size="sm" variant="ghost" onClick={cancelPremove}>Cancel</Button></> : <span>On their turn, drag or tap to queue a premove. Esc or right-click cancels.</span>}</div>}</section>
 <aside className="room-panel"><Tabs defaultValue="game"><TabsList className="panel-tabs"><TabsTrigger value="game"><Zap size={14}/>Play</TabsTrigger><TabsTrigger value="record"><History size={14}/>The record</TabsTrigger></TabsList><TabsContent value="game">
 {!g || ['finished', 'cancelled'].includes(g.status) ? <><div className="panel-section"><p className="eyebrow">{g?.status === 'finished' ? 'RUN IT BACK' : 'SET THE PACE'}</p><h2>{g?.status === 'finished' ? 'One more game?' : 'Make your move.'}</h2><p className="panel-copy">Choose a rival and a clock.</p><div className="rival-picker"><p id="rival-heading">Play against</p><RadioGroup value={rival} onValueChange={setSelectedRival} className="rival-options" aria-labelledby="rival-heading">{room.players.filter(p => p.id !== me).map(p => { const record = room.headToHead[p.id] || { wins: 0, losses: 0, draws: 0 }; return <Label key={p.id} htmlFor={'rival-' + p.id} className={`rival-option ${p.id === rival ? 'chosen' : ''}`}><RadioGroupItem id={'rival-' + p.id} value={p.id}/><CharacterPortrait character={p.character} name={p.name} className="rival-portrait"/><span><strong>{p.name}</strong><small>Your record: {record.wins}W · {record.losses}L · {record.draws}D{p.busy ? ' · Busy' : ''}</small></span></Label>; })}</RadioGroup></div><RadioGroup value={minutes} onValueChange={setMinutes} className="time-options" aria-label="Minutes per player">{['1', '3', '5', '10'].map((v, i) => <Label className={`time-option ${minutes === v ? 'chosen' : ''}`} key={v} htmlFor={'time-' + v}><RadioGroupItem id={'time-' + v} value={v}/><strong>{v}<small> min</small></strong><span>{['Bullet', 'Blitz', 'Blitz', 'Rapid'][i]}</span></Label>)}</RadioGroup><div className="increment-option"><div><Label htmlFor="increment">A little breathing room</Label><p>+2 seconds after every move</p></div><Switch id="increment" checked={increment} onCheckedChange={setIncrement}/></div><Button className="main-action" disabled={busy || !online} onClick={() => run('create', { rival, minutes: Number(minutes), increment: increment ? 2 : 0 })}>{busy ? 'Sending…' : `Challenge ${who(rival)}`}<ArrowRight size={17}/></Button><p className="panel-note">Colors alternate against each rival. One game or challenge per person at a time.</p></div></> :
            g.status === 'pending' ? <div className="panel-section challenge"><div className="challenge-icon"><Clock3 size={25}/></div><p className="eyebrow">{g.challenger === me ? 'WAITING FOR YOUR RIVAL' : 'GAME ON?'}</p><h2>{g.minutes} + {g.increment}</h2><p className="panel-copy">{g.minutes} minutes each{g.increment ? `, plus ${g.increment} seconds per move` : '. No increment.'}</p><p className="challenge-seat">You have the {myColor === 'w' ? 'white' : 'black'} pieces.</p>{g.challenger !== me ? <Button className="main-action" disabled={busy || !online} onClick={() => run('accept')}>Accept & start clocks<ArrowRight /></Button> : <p className="waiting"><span />Waiting for {who(rival)} to accept</p>}<Button variant="ghost" className="full-width" disabled={busy || !online} onClick={() => run('cancel')}>{g.challenger === me ? 'Cancel challenge' : 'Decline challenge'}</Button><p className="panel-note">A challenge expires after 15 minutes.</p></div> :
                <div className="panel-section"><div className="live-heading"><span className="live-label"><i /> IN PLAY</span><span>{g.minutes} + {g.increment}</span></div><h2>{myTurn ? 'Your turn.' : 'Their turn.'}</h2><p className="panel-copy">{board.isCheck() ? 'The king is in check.' : 'Keep your eye on the clock.'}</p><MoveList moves={g.moves}/>{g.drawOffer && <div className="draw-notice">{g.drawOffer === me ? <p>Draw offered. Waiting for your rival.</p> : <><p>Your rival offered a draw.</p><Button disabled={busy || !online} onClick={() => run('acceptDraw')}>Accept draw</Button><Button variant="ghost" disabled={busy || !online} onClick={() => run('declineDraw')}>Decline</Button></>}</div>}<div className="game-actions"><Button variant="outline" disabled={busy || !online || !!g.drawOffer} onClick={() => run('offerDraw')}><Handshake size={15}/>Draw</Button><Button variant="outline" disabled={busy || !online} onClick={() => setConfirm(true)}><Flag size={15}/>Resign</Button></div></div>}
 {g?.status === 'finished' && <div className="result-card"><span className="eyebrow">RESULT SAVED</span><Button variant="outline" size="sm" onClick={() => setReviewGame(g)}>Game review</Button><h3>{g.winner ? `${who(g.winner)} won` : 'A draw'}</h3><p>{g.reason} · {Math.ceil(g.moves.length / 2)} moves</p><Button variant="ghost" size="sm" onClick={() => download('rival-room-game.pgn', pgn(g, room.players))}><Download size={13}/>Save PGN</Button></div>}
 <div className="rivalry-strip"><span className="eyebrow">THE HEAD-TO-HEAD</span><div><b>{who(me)}</b><strong>{pair.wins}<span> : </span>{pair.losses}</strong><b>{who(rival)}</b></div><p>{pair.draws} drawn · {pair.wins + pair.losses + pair.draws} games against each other</p></div>
 </TabsContent><TabsContent value="record"><div className="panel-section"><p className="eyebrow">BRAGGING RIGHTS, IN WRITING</p><h2>Your record.</h2><p className="panel-copy">All your games, across every rival.</p><div className="stat-grid">{(['wins', 'losses', 'draws'] as const).map(k => <div key={k}><strong>{room.stats[me][k]}</strong><span>{k}</span></div>)}</div><div className="history-heading"><span>RECENT GAMES</span><Button variant="ghost" size="sm" onClick={exportAll}><Download size={13}/>Export all</Button></div>{room.recent.length === 0 ? <div className="empty-history"><Trophy size={28}/><h3>A clean scorecard.</h3><p>Your first finished game starts the story.</p></div> : <div className="history-list">{room.recent.map(h => <button className="history-row" key={h.id} onClick={() => setHistoryGame(h)}><span className={`result-letter ${h.winner === me ? 'win' : !h.winner ? 'draw' : 'loss'}`}>{h.winner === me ? 'W' : !h.winner ? 'D' : 'L'}</span><div><strong>{h.winner === me ? 'You won' : !h.winner ? 'Draw' : `${who(opponent(me, h))} won`}</strong><span>vs. {who(opponent(me, h))} · {h.minutes}+{h.increment} · {h.reason}</span></div><ChevronRight size={15}/></button>)}</div>}<p className="panel-note">Your totals include every game you finished. Showing your latest 20. Cancelled challenges don’t count.</p></div></TabsContent></Tabs></aside></div>
 <footer><span>RIVAL ROOM · YOUR PRIVATE CLUB</span><span>{character ? 'Your character. Your record.' : 'One board. A lasting rivalry.'}</span></footer>
 <Dialog open={!!promotion} onOpenChange={open => { if (!open)
        setPromotion(null); }}><DialogContent><DialogHeader><DialogTitle>Promote your pawn</DialogTitle><DialogDescription>Choose the piece to complete your move. Your clock is still running.</DialogDescription></DialogHeader><div className="promotion-choices">{(['q', 'r', 'b', 'n'] as const).map(p => <Button variant="outline" key={p} onClick={() => { if (promotion)
        move(promotion.from, promotion.to, p); setPromotion(null); }}><span>{glyph[p]}</span>{pieceName[p]}</Button>)}</div></DialogContent></Dialog>
 <Dialog open={confirm} onOpenChange={setConfirm}><DialogContent><DialogHeader><DialogTitle>Concede this game?</DialogTitle><DialogDescription>Your rival will get a win, and this game will be saved as a loss for you.</DialogDescription></DialogHeader><div className="dialog-actions"><Button variant="outline" onClick={() => setConfirm(false)}>Keep playing</Button><Button disabled={busy || !online} onClick={() => { run('resign'); setConfirm(false); }}>Resign game</Button></div></DialogContent></Dialog>
 <Dialog open={settings} onOpenChange={setSettings}><DialogContent><DialogHeader><DialogTitle>Your seat at the table</DialogTitle><DialogDescription>Your personal PIN identifies your player, whichever color you play. Keep it to yourself.</DialogDescription></DialogHeader><Label htmlFor="display-name">Your display name</Label><Input id="display-name" value={name} onChange={e => setName(e.target.value)} maxLength={24}/><Button disabled={busy || !name.trim()} onClick={() => { void act('rename', { name }).then(() => { setSettings(false); toast.success('Name updated.'); }).catch(() => { }); }}>Save name</Button><div className="room-rules"><h3>Room rules</h3><p>Threefold repetition and the 50-move rule end games automatically. Clocks keep running if you close the page. A timeout is drawn when the other side has only a king, a single bishop or knight, or bishops on one color.</p><p>Records are saved online. Export a backup whenever you like.</p></div><div className="dialog-actions"><Button variant="outline" onClick={exportAll}><Download size={14}/>Export backup</Button><Button variant="ghost" disabled={busy} onClick={() => { setSettings(false); run('logout'); }}><LogOut size={14}/>Lock room</Button></div></DialogContent></Dialog>
 <Dialog open={!!historyGame} onOpenChange={open => { if (!open)
        setHistoryGame(null); }}><DialogContent><DialogHeader><DialogTitle>{historyGame?.winner ? `${who(historyGame.winner)} won` : 'Draw'}</DialogTitle><DialogDescription>{historyGame?.reason} · {historyGame?.minutes}+{historyGame?.increment} · {historyGame && new Date(historyGame.createdAt).toLocaleDateString()}</DialogDescription></DialogHeader>{historyGame && <><MoveList moves={historyGame.moves}/><Button onClick={() => { setReviewGame(historyGame); setHistoryGame(null); }}>Game review</Button><Button onClick={() => download('rival-room-game.pgn', pgn(historyGame, room.players))}><Download size={15}/>Download game (PGN)</Button></>}</DialogContent></Dialog>
 {reviewGame && <Suspense fallback={<p role="status">Opening game review…</p>}><GameReview game={reviewGame} players={room.players} me={me} onClose={() => setReviewGame(null)}/></Suspense>}
 </main>;
}
function MoveList({ moves }: {
    moves: string[];
}) { const box = useRef<HTMLDivElement>(null); useEffect(() => { if (box.current)
    box.current.scrollTop = box.current.scrollHeight; }, [moves.length]); return <div className="move-list" ref={box} aria-label="Move history">{!moves.length ? <p className="moves-empty">The first move is yours to make.</p> : Array.from({ length: Math.ceil(moves.length / 2) }, (_, i) => <div className="move-pair" key={i}><span>{i + 1}.</span><b>{moves[i * 2]}</b><b>{moves[i * 2 + 1] || '—'}</b></div>)}</div>; }
