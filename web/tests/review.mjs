import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { build } = createRequire(realpathSync(new URL('../node_modules/wrangler/package.json', import.meta.url)))('esbuild');
mkdirSync(root + '.test-build/review-engine', { recursive: true });
await build({ stdin: { contents: "export * from './lib/review-workspace'; export * from './lib/review-engine'; export * from './lib/review-assets';", resolveDir: root }, outfile: root + '.test-build/review.cjs', bundle: true, platform: 'node', format: 'cjs' });
const { reviewRows, reviewSummary, keyMoments, variationMoves, evaluationPercent, reviewInsight, ReviewEngine, loadReviewAssets } = require(root + '.test-build/review.cjs');
const evalAt = (cp, best = 'e2e4', mate = null) => ({ cp, best, pv: [best], depth: 15, mate });
const b = new Chess(); const moves = ['f3', 'e5', 'g4', 'Qh4#'].map(san => b.move(san));
let rows = reviewRows(moves, [evalAt(25), evalAt(-250, 'e7e5'), undefined, evalAt(-10000, 'd8h4', -1), evalAt(-10000, '', 0)]);
assert.equal(rows[0].quality, 'Blunder'); assert.equal(rows[1], undefined); assert.equal(rows[2], undefined);
assert.equal(rows[3].quality, 'Best');
assert.equal(reviewSummary(rows, 'w').averageLoss, 275);
assert.equal(reviewSummary(rows, 'b').averageLoss, null);
assert.deepEqual(keyMoments(rows, 'w').map(x => x.index), [0]);
assert.deepEqual(keyMoments(rows, 'b'), []);
assert.match(reviewInsight(rows[3]), /Checkmate/);
assert.equal(evaluationPercent(evalAt(0)), 50); assert.equal(evaluationPercent(evalAt(800)), 100); assert.equal(evaluationPercent(evalAt(-10000, '', -2)), 0);
const castle = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
const line = variationMoves(castle, ['e1g1','e8c8','z9z1']);
assert.equal(line.length, 2); assert.equal(line[0].san, 'O-O'); assert.equal(line[1].san, 'O-O-O');
assert.equal(new Chess(line[0].after).get('f1').type, 'r');
const promotion = variationMoves('7k/P7/8/8/8/8/8/7K w - - 0 1', ['a7a8n']);
assert.equal(new Chess(promotion[0].after).get('a8').type, 'n');
assert.equal(new Chess(castle).get('e1').type, 'k');
console.log('PASS Review summaries preserve sparse move indexes and both player perspectives; mate scores excluded from pawn averages; legal variations handle castling and promotion without mutating the saved game');

// Exercise the real UCI adapter with controlled asynchronous Worker messages.
class ProtocolWorker {
    static last;
    commands = [];
    constructor() { ProtocolWorker.last = this; }
    postMessage(command) {
        this.commands.push(command);
        if (command === 'uci') queueMicrotask(() => this.onmessage({ data: 'uciok' }));
        if (command === 'isready') queueMicrotask(() => this.onmessage({ data: 'readyok' }));
    }
    emit(data) { this.onmessage({ data }); }
    terminate() { this.terminated = true; }
}
globalThis.Worker = ProtocolWorker;
let engine = new ReviewEngine(); await engine.init();
const pending = engine.analyzeLines(['f2f3'], moves[0].after, 500, 3);
const worker = ProtocolWorker.last;
worker.emit('info depth 10 multipv 2 score cp 90 pv d7d5');
worker.emit('info depth 12 multipv 1 score cp 200 pv e7e5');
worker.emit('info depth 11 multipv 1 score cp 500 pv e7e6');
worker.emit('info depth 9 multipv 3 score cp 80 pv g8f6');
worker.emit('bestmove e7e5');
const ranked = await pending;
assert.deepEqual(ranked.map(e => e.cp), [-200, -90, -80]);
assert.equal(ranked[0].best, 'e7e5');
assert.ok(worker.commands.includes('setoption name MultiPV value 3'));
assert.ok(worker.commands.includes('position startpos moves f2f3'));
const stopped = engine.analyze([], new Chess().fen(), 250); engine.close();
await assert.rejects(stopped, /stopped/); await assert.rejects(engine.analyze([], new Chess().fen(), 250), /stopped/);
engine = new ReviewEngine(); ProtocolWorker.last.onerror(); await assert.rejects(engine.init(), /could not load/); engine.close();
engine = new ReviewEngine(); await engine.init();
const ongoing = engine.analyze([], new Chess().fen(), 250), commandCount = ProtocolWorker.last.commands.length;
await assert.rejects(engine.analyze(['f2f3'], moves[0].after, 250), /already running/);
assert.equal(ProtocolWorker.last.commands.length, commandCount);
engine.close(); await assert.rejects(ongoing, /stopped/);
console.log('PASS MultiPV keeps ranked, deepest exact scores, normalizes Black evaluations, and rejects stopped/failed engine requests');

if (process.argv.includes('--engines')) {
    const manifest = JSON.parse(await readFile(root + 'public/engine/full-manifest.json', 'utf8'));
    const pieces = await Promise.all(manifest.chunks.map(async chunk => {
        const bytes = await readFile(root + 'public/engine/' + chunk.file);
        assert.ok(bytes.length < 25 * 1024 * 1024);
        assert.equal(createHash('sha256').update(bytes).digest('base64'), chunk.sha256);
        return bytes;
    }));
    assert.equal(createHash('sha256').update(Buffer.concat(pieces)).digest('base64'), manifest.sha256);
    const originalFetch = globalThis.fetch; let requests = [];
    globalThis.fetch = async (url, options) => {
        options?.signal?.throwIfAborted(); requests.push(url);
        return new Response(await readFile(root + 'public' + url));
    };
    const progress = [];
    const asset = await loadReviewAssets('full', new AbortController().signal, n => progress.push(n));
    assert.ok(asset.url.startsWith('/engine/stockfish-19-single.js#blob%3A'));
    assert.deepEqual(progress, [21, 42, 63, 85, 100]); assert.equal(requests.length, 6);
    const blobUrl = decodeURIComponent(asset.url.split('#')[1]);
    const reassembled = Buffer.from(await (await originalFetch(blobUrl)).arrayBuffer());
    assert.equal(createHash('sha256').update(reassembled).digest('base64'), manifest.sha256);
    asset.dispose();
    await assert.rejects(originalFetch(blobUrl));
    const stopped = new AbortController(); stopped.abort();
    await assert.rejects(loadReviewAssets('full', stopped.signal, () => {}));
    requests = []; await loadReviewAssets('lite', new AbortController().signal, () => {}); assert.equal(requests.length, 0);
    globalThis.fetch = async () => new Response(JSON.stringify({ ...manifest, sha256: 'wrong' }));
    await assert.rejects(loadReviewAssets('full', new AbortController().signal, () => {}), /did not match/);
    globalThis.fetch = originalFetch;
    console.log('PASS Full download validates all five sub-25 MiB chunks and the upstream binary; progress, cancellation, tampering and Blob release work; Lite never fetches Full');

    // Run the same unmodified WASM releases in Node's CLI host. This verifies engine/protocol
    // behavior, not a browser's rendering or its Web Worker security policy.
    for (const mode of ['lite', 'full']) {
        const name = mode === 'lite' ? 'stockfish-19-lite-single' : 'stockfish-19-single';
        const file = root + '.test-build/review-engine/' + name;
        await writeFile(file + '.cjs', await readFile(root + 'public/engine/' + name + '.js'));
        await writeFile(file + '.wasm', mode === 'full' ? reassembled : await readFile(root + 'public/engine/' + name + '.wasm'));
        class ActualWorker {
            constructor() {
                this.proc = spawn(process.execPath, [file + '.cjs'], { stdio: ['pipe', 'pipe', 'pipe'] });
                let buffer = '';
                this.proc.stdout.on('data', chunk => { buffer += chunk; const lines = buffer.split('\n'); buffer = lines.pop(); for (const line of lines) this.onmessage?.({ data: line.trim() }); });
                this.proc.on('error', () => this.onerror?.());
                this.proc.stderr.on('data', data => { this.stderr = String(data); });
            }
            postMessage(command) { this.proc.stdin.write(command + '\n'); }
            terminate() { this.proc.kill(); }
        }
        globalThis.Worker = ActualWorker;
        const live = new ReviewEngine();
        try {
            await live.init();
            const top = await live.analyzeLines([], new Chess().fen(), 500, 3);
            assert.equal(top.length, 3); assert.equal(new Set(top.map(e => e.best)).size, 3);
            for (const candidate of top) assert.ok(new Chess().moves({ verbose: true }).some(m => m.from + m.to === candidate.best));
            const mate = await live.analyze(['f2f3','e7e5','g2g4'], moves[2].after, 600);
            assert.equal(mate.best, 'd8h4'); assert.ok(mate.cp < 0); assert.ok(mate.mate < 0);
            const terminal = await live.analyze(['f2f3','e7e5','g2g4','d8h4'], moves[3].after, 250);
            assert.equal(terminal.mate, 0); assert.equal(terminal.cp, -10000);
            console.log(`PASS Actual Stockfish 19 ${mode}: initialization, three legal alternatives, Black mate in one, terminal checkmate`);
        } finally { live.close(); }
    }
    // Cover the browser-specific entry point and its WASM hash-URL handling using
    // real Web APIs in a VM harness. This is not a visual or Safari compatibility test.
    const source = await readFile(root + 'public/engine/stockfish-19-single.js', 'utf8');
    const wasmUrl = URL.createObjectURL(new Blob([reassembled], { type: 'application/wasm' }));
    class BrowserEntryWorker {
        constructor(url) {
            const context = { onmessage: null, location: new URL(url, 'http://localhost'), fetch: originalFetch, URL, console,
                TextDecoder, TextEncoder, ReadableStream, Response, Headers, performance, setTimeout, clearTimeout,
                postMessage: data => this.onmessage?.({ data }), importScripts() { throw Error('Unexpected multithreaded dependency'); } };
            context.self = context; context.close = () => {};
            this.context = vm.createContext(context); vm.runInContext(source, this.context);
        }
        postMessage(data) { this.context.onmessage({ data }); }
        terminate() { this.onmessage = null; this.context = null; }
    }
    globalThis.Worker = BrowserEntryWorker;
    const browserEngine = new ReviewEngine('/engine/stockfish-19-single.js#' + encodeURIComponent(wasmUrl));
    try {
        await browserEngine.init();
        const evaluation = await browserEngine.analyze([], new Chess().fen(), 250);
        assert.ok(new Chess().moves({ verbose: true }).some(move => move.from + move.to === evaluation.best));
        console.log('PASS Full browser-entry code initializes from reassembled Blob WASM and answers UCI in a Web API harness');
    } finally { browserEngine.close(); URL.revokeObjectURL(wasmUrl); }
}
