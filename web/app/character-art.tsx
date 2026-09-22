import type { Color, PieceSymbol } from 'chess.js';
import { characterFor } from '@/lib/characters';
import { glyph } from '@/lib/board';

export function CharacterPortrait({ player, name = '', className = '' }: { player?: string; name?: string; className?: string }) {
    const character = characterFor(player);
    return <span className={`character-portrait ${className}`} data-character={character?.key || 'guest'} aria-hidden="true">
        {character ? <img src={character.image} alt="" draggable={false} width={1824} height={1367}/> : <span>{name.slice(0, 1).toUpperCase() || '♞'}</span>}
    </span>;
}

export function BoardPiece({ type, color, player, hidden = false }: { type: PieceSymbol; color: Color; player?: string; hidden?: boolean }) {
    const character = characterFor(player), king = type === 'k' && !!character;
    return <span className={`piece ${color === 'w' ? 'white-piece' : 'black-piece'} ${king ? 'character-king' : ''} ${hidden ? 'drag-source' : ''}`} data-character={character?.key} aria-hidden="true">
        {king ? <><CharacterPortrait player={player} className="king-face"/><span className="king-symbol">{glyph.k}</span></> : glyph[type]}
    </span>;
}
