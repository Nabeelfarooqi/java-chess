import { Chess } from 'chess.js';
import type { Game } from './game';
export type GameSound='move'|'capture'|'check'|'end'|'low';
export function gameSound(previous:Game|null, next:Game|null):GameSound|null {
    if(!previous||!next||previous.id!==next.id||next.version<=previous.version)return null;
    if(previous.status==='active'&&next.status==='finished')return 'end';
    if(next.moves.length!==previous.moves.length+1)return null;
    const san=next.moves.at(-1)||'';
    if(new Chess(next.fen).isCheck())return 'check';
    return san.includes('x')?'capture':'move';
}
export const soundNotes:Record<GameSound,number[]>={move:[440],capture:[260,170],check:[660,880],end:[440,554,660],low:[880,660,880]};
