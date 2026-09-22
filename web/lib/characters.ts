import type { Color } from 'chess.js';

export type CharacterKey = 'walan' | 'gud' | 'saif';
const characters = {
    walan: { key: 'walan', name: 'Walan', image: '/characters/walan.webp', width: 2732, height: 2048 },
    gud: { key: 'gud', name: 'Gud', image: '/characters/gud.webp', width: 2732, height: 2048 },
    saif: { key: 'saif', name: 'Saif', image: '/characters/saif.webp', width: 1254, height: 1254 },
} as const;
export type Character = typeof characters[keyof typeof characters];
// The server sends the character saved on the PIN's player record.
// Display-name edits and chess-color changes never transfer ownership.
export function getCharacter(key?: CharacterKey | null): Character | null {
    return key === 'walan' ? characters.walan : key === 'gud' ? characters.gud : key === 'saif' ? characters.saif : null;
}
export function characterForColor(color: Color, white?: CharacterKey | null, black?: CharacterKey | null) {
    return getCharacter(color === 'w' ? white : black);
}
