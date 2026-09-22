import { RotateCcw, Trophy, Handshake, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { opponent, type Game, type Player, type Room } from '@/lib/game';
import { CharacterPortrait } from './character-art';

export function Matchup({ players, left, right, winner, middle = 'VS' }: { players: Player[]; left: string; right: string; winner?: string | null; middle?: string }) {
    return <div className="matchup">
        {[left, right].map((id, index) => {
            const player = players.find(p => p.id === id);
            return <div className="matchup-player" data-winner={winner === id || undefined} key={id}>
                {index === 1 && <span className="matchup-divider" aria-hidden="true">{middle}</span>}
                <CharacterPortrait character={player?.character} name={player?.name}/>
                <strong>{player?.name || 'Player'}</strong>
                {winner === id && <Trophy className="winner-crown" size={16} aria-label="Winner"/>}
            </div>;
        })}
    </div>;
}

export function MatchResult({ room, game, busy, online, onRematch, onReview, onDownload }: {
    room: Room; game: Game; busy: boolean; online: boolean;
    onRematch: () => void; onReview: () => void; onDownload: () => void;
}) {
    const rival = opponent(room.me, game);
    const winner = room.players.find(p => p.id === game.winner);
    const outcome = !game.winner ? 'draw' : game.winner === room.me ? 'win' : 'loss';
    const record = room.headToHead[rival];
    const recordReady = room.recent.some(g => g.id === game.id && g.version >= game.version && g.status === 'finished');
    const continuing = room.series?.status === 'active' && room.series.id === game.seriesId;
    const rivalBusy = room.players.find(p => p.id === rival)?.busy;
    return <section className="match-result" data-outcome={outcome} aria-label="Game result">
        <p className="eyebrow">{outcome === 'win' ? 'BRAGGING RIGHTS SECURED' : outcome === 'draw' ? 'NOTHING BETWEEN YOU' : 'THE REMATCH IS CALLING'}</p>
        <Matchup players={room.players} left={room.me} right={rival} winner={game.winner} middle={outcome === 'draw' ? '½–½' : 'VS'}/>
        <h2 aria-live="polite">{winner ? `${winner.name} wins.` : 'Evenly matched.'}</h2>
        <p className="result-reason">{game.reason} · {game.minutes}+{game.increment} · {Math.ceil(game.moves.length / 2)} moves</p>
        <div className="result-record" aria-live="polite">
            {game.winner ? <Trophy size={16}/> : <Handshake size={16}/>}
            {recordReady && record ? <span>Your record against this rival: <strong>{record.wins}W · {record.losses}L · {record.draws}D</strong></span> : <span>Updating your record…</span>}
        </div>
        <Button className="main-action" disabled={busy || !online || (rivalBusy && !continuing)} onClick={onRematch}><RotateCcw size={16}/>{busy ? 'Sending…' : continuing ? 'Challenge next round' : room.series?.id===game.seriesId && game.seriesId ? 'Rematch series' : `Rematch · ${game.minutes}+${game.increment}`}</Button>
        <p className="panel-note">{continuing ? 'Same clock. Swap colors. Your rival accepts the next round.' : rivalBusy ? 'Your rival is in another game.' : 'Same clock. Swap colors. Your rival accepts to start.'}</p>
        <div className="result-actions"><Button variant="outline" onClick={onReview}>Game review</Button><Button variant="ghost" onClick={onDownload}><Download size={14}/>PGN</Button></div>
    </section>;
}
