import type { Game, Room } from './game';
export type RoomUpdate = { me: string; game: Game | null; serverNow: number } & Partial<Omit<Room, 'me' | 'game' | 'serverNow'>>;
export function mergeRoom(old: Room | null, update: RoomUpdate): Room | null {
    if (!update.me) return old;
    const full = !!update.players && !!update.stats && !!update.headToHead && !!update.recent;
    if (!old || old.me !== update.me) return full ? update as Room : old;
    const a = old.game, b = update.game;
    if (a && b && a.id === b.id && b.version < a.version) return old;
    if (a && b && a.id !== b.id && (b.createdAt < a.createdAt || update.serverNow < old.serverNow)) return old;
    if (update.serverNow < old.serverNow && (!b || !a || (a.id === b.id && b.version <= a.version))) return old;
    return { ...old, ...update } as Room;
}
