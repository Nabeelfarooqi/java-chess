import { Chess } from 'chess.js';
import { parseInfo, type Evaluation } from './review';
export class ReviewEngine {
    private worker: Worker;
    private pending: { line: (text: string) => void; reject: (error: Error) => void } | null = null;
    constructor() {
        this.worker = new Worker('/engine/stockfish-19-lite-single.js');
        this.worker.onmessage = e => { for (const line of String(e.data).split('\n')) this.pending?.line(line); };
        this.worker.onerror = () => this.pending?.reject(new Error('The analysis engine could not load. Try again.'));
    }
    private wait(command: string, done: (line: string) => boolean, onLine: (line: string) => void = () => {}): Promise<void> {
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
        const board = new Chess(fen);
        if (board.isCheckmate()) return { cp: board.turn() === 'w' ? -10000 : 10000, mate: 0, best: '', pv: [], depth: 0 };
        if (board.isStalemate() || board.isInsufficientMaterial()) return { cp: 0, mate: null, best: '', pv: [], depth: 0 };
        let result: Evaluation | null = null;
        this.worker.postMessage('position startpos' + (moves.length ? ' moves ' + moves.join(' ') : ''));
        await this.wait(`go movetime ${ms}`, line => line.startsWith('bestmove'), line => {
            const info = parseInfo(line, board.turn());
            if (info && info.pv.length) result = info;
        });
        if (!result) throw new Error('No engine evaluation was returned. Please retry.');
        return result;
    }
    close() { this.pending?.reject(new Error('Review stopped.')); this.worker.terminate(); }
}
