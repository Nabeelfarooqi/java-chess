import { Chess } from 'chess.js';
import { parseInfo, type Evaluation } from './review';
export class ReviewEngine {
    private worker: Worker;
    private pending: { line: (text: string) => void; reject: (error: Error) => void } | null = null;
    private failure: Error | null = null;
    private closed = false;
    constructor(url = '/engine/stockfish-19-lite-single.js') {
        this.worker = new Worker(url);
        this.worker.onmessage = e => { for (const line of String(e.data).split('\n')) this.pending?.line(line); };
        this.worker.onerror = () => { this.failure = new Error('The analysis engine could not load. Try again.'); this.pending?.reject(this.failure); };
    }
    private wait(command: string, done: (line: string) => boolean, onLine: (line: string) => void = () => {}): Promise<void> {
        if (this.closed || this.failure) return Promise.reject(this.failure || new Error('Review stopped.'));
        if (this.pending) return Promise.reject(new Error('An engine search is already running.'));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => finish(new Error('Analysis timed out. Try the quick review.')), 30000);
            const finish = (error?: Error) => { clearTimeout(timer); this.pending = null; if (error) reject(error); else resolve(); };
            this.pending = { line: line => { onLine(line); if (done(line)) finish(); }, reject: finish };
            this.worker.postMessage(command);
        });
    }
    async init() {
        await this.wait('uci', line => line === 'uciok');
        this.worker.postMessage('setoption name Hash value 32');
        this.worker.postMessage('ucinewgame');
        await this.wait('isready', line => line === 'readyok');
    }
    async analyze(moves: string[], fen: string, ms: number): Promise<Evaluation> {
        return (await this.analyzeLines(moves, fen, ms, 1))[0];
    }
    async analyzeLines(moves: string[], fen: string, ms: number, count = 3): Promise<Evaluation[]> {
        if (this.closed || this.failure) throw this.failure || new Error('Review stopped.');
        if (this.pending) throw new Error('An engine search is already running.');
        const board = new Chess(fen);
        if (board.isCheckmate()) return [{ cp: board.turn() === 'w' ? -10000 : 10000, mate: 0, best: '', pv: [], depth: 0 }];
        if (board.isStalemate() || board.isInsufficientMaterial()) return [{ cp: 0, mate: null, best: '', pv: [], depth: 0 }];
        const limit = Math.min(3, Math.max(1, Math.floor(count)));
        const expected = Math.min(limit, board.moves().length);
        const candidates = new Map<number, Evaluation>();
        const byMove = new Map<string, Evaluation>();
        const iterations = new Map<number, Map<number, Evaluation>>();
        let complete: Evaluation[] = [], completeDepth = -1, bestMove = '';
        this.worker.postMessage(`setoption name MultiPV value ${limit}`);
        this.worker.postMessage('position startpos' + (moves.length ? ' moves ' + moves.join(' ') : ''));
        await this.wait(`go movetime ${Math.min(10000, Math.max(100, Math.round(ms)))}`, line => line.startsWith('bestmove'), line => {
            const final = /^bestmove (\S+)/.exec(line);
            if (final) bestMove = final[1];
            const info = parseInfo(line, board.turn());
            const rank = Number(/\bmultipv (\d+)/.exec(line)?.[1] || 1);
            if (!info?.pv.length || rank < 1 || rank > expected) return;
            if (!candidates.has(rank) || info.depth >= candidates.get(rank)!.depth) candidates.set(rank, info);
            if (!byMove.has(info.best) || info.depth >= byMove.get(info.best)!.depth) byMove.set(info.best, info);
            const iteration = iterations.get(info.depth) || new Map<number, Evaluation>();
            iteration.set(rank, info); iterations.set(info.depth, iteration);
            const ordered = [...iteration].sort(([a], [b]) => a - b).map(([, value]) => value);
            if (info.depth >= completeDepth && ordered.length === expected && new Set(ordered.map(value => value.best)).size === expected) {
                complete = ordered; completeDepth = info.depth;
            }
        });
        const best = byMove.get(bestMove);
        if (!best) throw new Error('No exact evaluation for the engine\'s chosen move was returned. Please retry.');
        // A timed stop can interrupt a MultiPV iteration after a move changes rank.
        // Keep alternatives from a complete exact iteration, rather than mixing
        // stale ranks into duplicates. The final bestmove is authoritative and
        // uses its deepest exact score; each result retains its own search depth.
        const alternatives = complete.length ? complete : [...candidates].sort(([a], [b]) => a - b).map(([, value]) => value);
        const result = [best], seen = new Set([best.best]);
        for (const candidate of alternatives) {
            if (!seen.has(candidate.best) && result.length < expected) { result.push(candidate); seen.add(candidate.best); }
        }
        return result;
    }
    close() { this.closed = true; this.pending?.reject(new Error('Review stopped.')); this.worker.terminate(); }
}
