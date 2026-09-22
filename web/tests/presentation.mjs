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
    stdin: { contents: "export { Club } from './app/rival-room'; export { SeriesBanner } from './app/series-banner'; export { MatchResult } from './app/match-result'; export { ConnectionMeter } from './app/connection-meter';", resolveDir: root },
    outfile: root + '.test-build/presentation.cjs', bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime'], alias: { '@': root },
});
const { Club, SeriesBanner, MatchResult, ConnectionMeter } = require(root + '.test-build/presentation.cjs');
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

const series={id:'series',playerOne:'one',playerTwo:'two',bestOf:3,minutes:3,increment:2,status:'active',oneWins:1,twoWins:0,draws:1,version:4};
const seriesGame={...game,seriesId:series.id};
const seriesRoom={...room,game:seriesGame,recent:[seriesGame],series,players:room.players.map(p=>({...p,busy:p.id!=='third'}))};
assert.match(result(seriesRoom,seriesGame),/Challenge next round/);
assert.doesNotMatch(result(seriesRoom,seriesGame),/Your rival is in another game/);
const banner=renderToStaticMarkup(createElement(SeriesBanner,{room:seriesRoom,busy:false,online:true,run(){}}));
assert.match(banner,/FIRST TO 2 WINS/);assert.match(banner,/draws replay the round/);assert.match(banner,/End series/);
const fullRoom={...seriesRoom,game:{...seriesGame,fen:'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',moves:[],whiteMs:180000,blackMs:180000},stats:{one:{wins:2,losses:3,draws:1}}};
const club=renderToStaticMarkup(createElement(Club,{room:fullRoom,busy:false,online:true,live:true,latency:42,moveLatency:150,offset:0,act:async()=>fullRoom,run(){}}));
assert.match(club,/Club/);assert.match(club,/Series score/);assert.doesNotMatch(club,/A different challenge/);assert.match(club,/Saif/);assert.match(club,/Walan/);
console.log('PASS Club presentation: busy series rival can accept next round; correct score, replayed draws, and unrelated challenge form hidden');
