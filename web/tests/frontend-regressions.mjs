import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { build } = createRequire(realpathSync(new URL('../node_modules/wrangler/package.json', import.meta.url)))('esbuild');
const result = await build({
    stdin: { contents: "export * from './lib/game'; export * from './lib/board'; export * from './lib/client-request'; export * from './lib/session-generation'; export { ChessBoard } from './app/chess-board'; export { practiceGET } from './lib/server/practice';", resolveDir: root },
    bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', write: false, alias: { '@': root },
    external: ['react', 'react-dom', 'react/jsx-runtime'],
});
const compiled = { exports: {} };
new Function('module', 'exports', 'require', result.outputFiles[0].text)(compiled, compiled.exports, require);
const { createGame, transition, clockMs } = compiled.exports;

for (const turn of ['w', 'b']) {
    let game = transition(createGame('white', 'black', 5, 2, 0), 'black', 'accept', {}, 1000);
    if (turn === 'b') game = transition(game, 'white', 'move', { from: 'e2', to: 'e4' }, 6000);
    const now = game.turnAt + 30000;
    const expected = { w: clockMs(game, 'w', now), b: clockMs(game, 'b', now) };
    for (const player of ['white', 'black']) {
        const resigned = transition(game, player, 'resign', {}, now);
        assert.equal(resigned.winner, player === 'white' ? 'black' : 'white');
        for (const color of ['w', 'b']) assert.equal(clockMs(resigned, color, now + 60000), expected[color]);
    }
    const offered = transition(game, 'white', 'offerDraw', {}, now - 1000);
    const drawn = transition(offered, 'black', 'acceptDraw', {}, now);
    assert.equal(drawn.winner, null);
    for (const color of ['w', 'b']) assert.equal(clockMs(JSON.parse(JSON.stringify(drawn)), color, now + 60000), expected[color]);
    const expired = transition(game, 'black', 'resign', {}, game.turnAt + (turn === 'w' ? game.whiteMs : game.blackMs));
    assert.equal(expired.reason, 'Time expired');
    assert.equal(clockMs(expired, turn, now), 0);
}
let mate = transition(createGame('white', 'black', 5, 2, 0), 'black', 'accept', {}, 1000);
for (const [i, [from, to]] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']].entries()) {
    mate = transition(mate, i % 2 ? 'black' : 'white', 'move', { from, to }, 2000 + i * 1000);
}
assert.equal(mate.reason, 'Checkmate');
assert.equal(mate.whiteMs, 302000);
assert.equal(mate.blackMs, 302000);
console.log('PASS terminal clocks freeze for either resigner, both running colors, draw, flag precedence and mate increment without double debit');

const { keyboardSquare, boardMove, premoveReady, parseBoardTheme, ChessBoard, requestJson, isCancelled } = compiled.exports;
for(const theme of ['characters','classic','slate'])assert.equal(parseBoardTheme(theme),theme);
assert.equal(parseBoardTheme('unexpected-theme'),'characters');
const { Chess } = require('chess.js');
for (const [orientation, origin, key, expected] of [
    ['w','a8','ArrowLeft','a8'], ['w','e2','ArrowUp','e3'], ['w','e2','ArrowDown','e1'],
    ['w','e2','Home','a2'], ['w','e2','End','h2'], ['b','e2','ArrowUp','e1'],
    ['b','e2','ArrowLeft','f2'], ['b','e2','ArrowRight','d2'], ['b','e2','Home','h2'], ['b','e2','End','a2'],
]) assert.equal(keyboardSquare(origin,key,orientation),expected);
assert.equal(keyboardSquare('e4','Home','w',true),'a8');
assert.equal(keyboardSquare('e4','End','b',true),'a8');
assert.equal(keyboardSquare('e4','Enter','w'),null);
assert.deepEqual(boardMove(new Chess(),'e2',keyboardSquare('e2','ArrowUp','w'),'w'),{from:'e2',to:'e3'});
const castle = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
assert.deepEqual(boardMove(castle,'e1','h1','w'),{from:'e1',to:'g1'});
assert.equal(premoveReady({...mate,status:'active',fen:'7k/P7/8/8/8/8/8/7K w - - 0 1'},'white',{gameId:mate.id,from:'a7',to:'a8',promotion:'n'}),true);

const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
for (const active of [true,false]) {
    const html=renderToStaticMarkup(createElement(ChessBoard,{fen:new Chess().fen(),orientation:'w',color:'w',active,canMove:active,online:true,lastMove:{from:'e2',to:'e4'},premove:{from:'g1',to:'f3'},onMove(){},onCancel(){}}));
    assert.equal((html.match(/role="gridcell"/g)||[]).length,64);
    assert.equal((html.match(/role="row"/g)||[]).length,8);
    assert.equal((html.match(/tabindex="0"/g)||[]).length,1);
    assert.equal((html.match(/tabindex="-1"/g)||[]).length,63);
    assert.match(html,/g1, white knight, queued premove from/);
    assert.match(html,/e4, empty, last move to/);
    assert.match(html,/class="board-frame" data-board-theme="characters"/);
    if(!active){assert.doesNotMatch(html,/<button\b/);assert.match(html,/aria-readonly="true"/);assert.match(html,/data-interactive="false"/);}
}
console.log('PASS board keyboard geometry, one tab stop, read-only grid semantics, narrated move/premove squares, castle and promotion legality');

const originalFetch=globalThis.fetch;
try {
    globalThis.fetch=async()=>new Response('<html>proxy unavailable</html>',{status:503});
    await assert.rejects(requestJson('/room'),error=>error.status===503&&!error.message.includes('JSON'));
    globalThis.fetch=async()=>Response.json({error:'Sign in again.'},{status:401});
    await assert.rejects(requestJson('/room'),error=>error.status===401&&error.message==='Sign in again.');
    globalThis.fetch=async()=>Response.json({ok:true});
    assert.deepEqual(await requestJson('/room'),{ok:true});
    let calls=0;
    globalThis.fetch=(_url,{signal})=>{calls++;return new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});};
    const keepAlive=setTimeout(()=>{},200);
    try{await assert.rejects(requestJson('/room',{method:'POST'},20),/timed out/);}finally{clearTimeout(keepAlive);}
    assert.equal(calls,1,'a timed-out mutation must never be retried by the transport');
    const controller=new AbortController();
    const cancelled=requestJson('/room',{signal:controller.signal});controller.abort();
    await assert.rejects(cancelled,isCancelled);
} finally {globalThis.fetch=originalFetch;}
console.log('PASS bounded request timeout/cancellation, preserved auth status, safe proxy errors and no automatic mutation retry');

const { SessionGeneration } = compiled.exports;
for (const action of ['login', 'logout']) {
    const session = new SessionGeneration();
    const oldRead = session.readToken;
    const delayedOldResult = Promise.resolve({ status: 401, token: oldRead });
    session.beginChange();
    const mutation = session.token;
    assert.equal(session.readToken, null, `${action}: do not begin GETs while the cookie is changing`);
    assert.equal(session.accepts((await delayedOldResult).token), false, `${action}: ignore a stale 401 rather than clearing the current room`);
    assert.equal(session.accepts(mutation), true, `${action}: the session mutation can still apply its result`);
    session.endChange();
    assert.equal(session.accepts(mutation), false, `${action}: mutation-era results cannot overwrite the next read`);
    assert.equal(session.accepts(session.readToken), true);
    const beforeLock = session.readToken;
    session.invalidate();
    assert.equal(session.accepts(beforeLock), false, 'a lock event invalidates in-flight reads');
}
console.log('PASS session transitions reject delayed old-session results and suspend reads across login/logout');

const { practiceGET } = compiled.exports;
const sql=new DatabaseSync(':memory:');
try {
    for(const file of readdirSync(root+'drizzle').filter(file=>file.endsWith('.sql')).sort())sql.exec(readFileSync(root+'drizzle/'+file,'utf8'));
    sql.exec("INSERT INTO players(id,name) VALUES('owner','Owner'),('other','Other')");
    const game={...mate,id:'practice-fixture',white:'owner',black:'other',winner:'other'};
    sql.prepare('INSERT INTO games(id,active_key,state,version,created_at,finished_at) VALUES(?,NULL,?,0,?,?)').run(game.id,JSON.stringify(game),game.createdAt,game.finishedAt);
    const insert=sql.prepare('INSERT INTO practice_puzzles(id,player_id,game_id,ply,fen,solution,loss,depth,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
    for(let i=0;i<151;i++)insert.run('p'+String(i).padStart(3,'0'),'owner',game.id,i,new Chess().fen(),'e2e4',200,12,1000+i%4);
    for(let i=0;i<3;i++)insert.run('other'+i,'other',game.id,i,new Chess().fen(),'d2d4',200,12,5000);
    const db={prepare(query){const statement=sql.prepare(query);return{bind(...parameters){return {async all(){return{results:statement.all(...parameters)};},async first(){return statement.get(...parameters)||null;}};}};}};
    const expected=sql.prepare("SELECT id FROM practice_puzzles WHERE player_id='owner' ORDER BY created_at DESC,id DESC").all().map(row=>row.id);
    let page=await practiceGET(db,'owner'),cursor=page.nextCursor;
    assert.equal(page.total,151);assert.equal(page.puzzles.length,50);assert.ok(cursor);
    const found=page.puzzles.map(puzzle=>puzzle.id);
    for(const puzzle of page.puzzles){assert.equal(puzzle.solution,undefined);assert.equal(puzzle.player_id,undefined);}
    await assert.rejects(practiceGET(db,'other',cursor),error=>error.status===400);
    await assert.rejects(practiceGET(db,'owner','not a cursor'),error=>error.status===400);
    await assert.rejects(practiceGET(db,'owner','x'.repeat(1025)),error=>error.status===400);
    sql.prepare("UPDATE practice_puzzles SET solved_at=5000,attempts=1 WHERE player_id='owner'").run();
    insert.run('newer','owner',game.id,999,new Chess().fen(),'e2e4',200,12,10000);
    while(cursor){page=await practiceGET(db,'owner',cursor);assert.ok(page.puzzles.length<=50);found.push(...page.puzzles.map(puzzle=>puzzle.id));cursor=page.nextCursor;}
    assert.deepEqual(found,expected,'solving loaded/unloaded puzzles and adding a newer one must not reorder or skip the remaining original pages');
    assert.equal(new Set(found).size,151);
    assert.equal((await practiceGET(db,'owner')).puzzles[0].id,'newer');
    const others=await practiceGET(db,'other');assert.equal(others.total,3);assert.equal(others.puzzles.length,3);assert.equal(others.nextCursor,null);
    assert.deepEqual(await practiceGET(db,'nobody'),{puzzles:[],nextCursor:null,total:0});
}finally{sql.close();}
console.log('PASS practice keyset pagination beyond 100, tied timestamps, progress/new-insert stability, cursor validation, private solutions and player ownership');
