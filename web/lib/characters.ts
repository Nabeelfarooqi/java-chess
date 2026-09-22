import type { Color } from 'chess.js';

// Stable player IDs come from the verified PIN session, never from the board color or display name.
const characters = {
    one: { key: 'walan', name: 'Walan', image: '/characters/walan.jpeg' },
    two: { key: 'gud', name: 'Gud', image: '/characters/gud.jpeg' },
} as const;
export type Character = typeof characters[keyof typeof characters];
export function characterFor(player?: string): Character | null {
    return player === 'one' ? characters.one : player === 'two' ? characters.two : null;
}
export function characterForColor(color: Color, white?: string, black?: string) {
    return characterFor(color === 'w' ? white : black);
}
