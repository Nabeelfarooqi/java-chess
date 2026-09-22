import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { build } = createRequire(realpathSync(new URL('../node_modules/wrangler/package.json', import.meta.url)))('esbuild');
mkdirSync(root + '.test-build', { recursive: true });
await build({
    stdin: { contents: "export { MatchResult } from './app/match-result'; export { ConnectionMeter } from './app/connection-meter';", resolveDir: root },
    outfile: root + '.test-build/presentation.cjs', bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime'], alias: { '@': root },
});
const { MatchResult, ConnectionMeter } = require(root + '.test-build/presentation.cjs');
const game = { id: 'finished-game', version: 9, status: 'finished', white: 'one', black: 'two', winner: 'two', minutes: 3, increment: 2, reason: 'Checkmate', moves: ['f3', 'e5', 'g4', 'Qh4#'] };
const room = { me: 'one', players: [{ id: 'one', name: 'Walan', character: 'walan' }, { id: 'two', name: 'Saif', character: 'saif' }, { id: 'third', name: 'Gud', character: 'gud' }], recent: [game], headToHead: { two: { wins: 2, losses: 3, draws: 1 }, third: { wins: 90, losses: 0, draws: 0 } } };
const result = (r = room, g = game, extra = {}) => renderToStaticMarkup(createElement(MatchResult, { room: r, game: g, online: true, busy: false, onRematch() {}, onReview() {}, onDownload() {}, ...extra }));
let html = result();
assert.match(html, /Saif wins\./); assert.match(html, /data-outcome="loss"/);
assert.match(html, /2W · 3L · 1D/); assert.doesNotMatch(html, /90W|Gud/);
assert.match(html, /Rematch · 3\+2/);
assert.match(result({ ...room, me: 'two', headToHead: { one: { wins: 3, losses: 2, draws: 1 } } }), /data-outcome="win"/);
assert.match(result(room, { ...game, winner: null, reason: 'Draw by agreement' }), /Evenly matched\./);
for (const recent of [[], [{ ...game, version: 8 }]]) {
    html = result({ ...room, recent }); assert.match(html, /Updating your record/); assert.doesNotMatch(html, /2W · 3L · 1D/);
}
for (const extra of [{ busy: true }, { online: false }]) assert.match(result(room, game, extra), /<button[^>]*disabled/);
assert.match(result({ ...room, players: room.players.map(p => ({ ...p, busy: p.id === 'two' })) }), /Your rival is in another game/);
console.log('PASS Result presentation: both player perspectives, correct pairing, draw, stale records, rematch clock and disabled controls');

const meter = props => renderToStaticMarkup(createElement(ConnectionMeter, { online: true, live: true, latency: 42, moveLatency: 160, ...props }));
assert.match(meter({}), /Last socket round trip: 42 milliseconds/);
assert.match(meter({}), /Last move confirmation: 160 milliseconds/);
assert.match(meter({ live: false }), /Backup sync/);
assert.match(meter({ latency: 300 }), /degraded/);
assert.match(meter({ online: false }), /Reconnecting/);
assert.doesNotMatch(meter({ online: false }), />42</);
console.log('PASS Connection presentation: socket ping is separate from move confirmation; fallback and offline states are distinct');
