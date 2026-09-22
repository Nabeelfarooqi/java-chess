import type { Game, Player } from './game';

export type SpectatorRoom = {
    games: Game[];
    selectedGame: Game | null;
    players: Player[];
    serverNow: number;
};
