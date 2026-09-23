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
        const candidates = new Map<number, Evaluation>();
        const limit = Math.min(3, Math.max(1, Math.floor(count)));
        this.worker.postMessage(`setoption name MultiPV value ${limit}`);
        this.worker.postMessage('position startpos' + (moves.length ? ' moves ' + moves.join(' ') : ''));
        await this.wait(`go movetime ${Math.min(10000, Math.max(100, Math.round(ms)))}`, line => line.startsWith('bestmove'), line => {
            const info = parseInfo(line, board.turn());
            const rank = Number(/\bmultipv (\d+)/.exec(line)?.[1] || 1);
            if (info && info.pv.length && rank <= limit && (!candidates.has(rank) || info.depth >= candidates.get(rank)!.depth)) candidates.set(rank, info);
        });
        if (!candidates.has(1)) throw new Error('No engine evaluation was returned. Please retry.');
        return [...candidates].sort(([a], [b]) => a - b).map(([, value]) => value);
    }
    close() { this.closed = true; this.pending?.reject(new Error('Review stopped.')); this.worker.terminate(); }
}
