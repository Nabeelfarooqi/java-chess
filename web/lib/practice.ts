export type PracticePuzzle = {
    id: string; gameId: string; ply: number; fen: string; loss: number;
    depth: number; createdAt: number; solvedAt: number | null; attempts: number;
};
export type PracticePage = { puzzles: PracticePuzzle[]; nextCursor: string | null; total: number };
