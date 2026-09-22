export type Series = {
    id: string; playerOne: string; playerTwo: string; bestOf: 3 | 5;
    minutes: number; increment: number; status: 'active' | 'finished' | 'cancelled';
    oneWins: number; twoWins: number; draws: number; winner: string | null;
    version: number; createdAt: number; finishedAt: number | null;
};
export const seriesTarget = (series: Pick<Series, 'bestOf'>) => Math.floor(series.bestOf / 2) + 1;
export const seriesRival = (series: Series, me: string) => series.playerOne === me ? series.playerTwo : series.playerOne;
export const seriesRound = (series: Series) => series.oneWins + series.twoWins + 1;
