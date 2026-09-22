import type { Color, PieceSymbol } from 'chess.js';
import { getCharacter, type CharacterKey } from '@/lib/characters';
import { glyph } from '@/lib/board';

export function CharacterPortrait({ character: key, name = '', className = '' }: { character?: CharacterKey | null; name?: string; className?: string }) {
    const character = getCharacter(key);
    return <span className={`character-portrait ${className}`} data-character={character?.key || 'guest'} aria-hidden="true">
        {character ? <img src={character.image} alt="" draggable={false} width={1824} height={1367}/> : <span>{name.slice(0, 1).toUpperCase() || '♞'}</span>}
    </span>;
}

export function BoardPiece({ type, color, character: key, hidden = false }: { type: PieceSymbol; color: Color; character?: CharacterKey | null; hidden?: boolean }) {
    const character = getCharacter(key), king = type === 'k' && !!character;
    return <span className={`piece ${color === 'w' ? 'white-piece' : 'black-piece'} ${king ? 'character-king' : ''} ${hidden ? 'drag-source' : ''}`} data-character={character?.key} aria-hidden="true">
        {king ? <><CharacterPortrait character={key} className="king-face"/><span className="king-symbol">{glyph.k}</span></> : glyph[type]}
    </span>;
}
