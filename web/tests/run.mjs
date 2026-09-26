import {fileURLToPath} from 'node:url';
import { readFileSync,mkdirSync,writeFileSync,rmSync,readdirSync } from 'node:fs';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {newPlayer} from '../scripts/player-pin.mjs';
import {pinUpdate} from '../scripts/set-pin.mjs';
import {spectatorPinUpdate} from '../scripts/spectator-pin.mjs';
const build=new URL('../.test-build/',import.meta.url);mkdirSync(build,{recursive:true});
const files=['lib/sounds.ts','lib/connection.ts','lib/server/request.ts','lib/server/spectator.ts','lib/spectator.ts','lib/material.ts','lib/server/imessage.ts','lib/characters.ts','lib/board.ts','lib/room-update.ts','lib/review.ts','lib/club.ts','lib/series.ts','lib/server/practice.ts','lib/game.ts','lib/server/auth.ts','lib/server/store.ts','lib/server/live.ts','lib/server/api.ts','app/api/room/route.ts'];
for(const file of files){let source=readFileSync(new URL('../'+file,import.meta.url),'utf8');
 if(file==='app/api/room/route.ts')source=source.replace("'cloudflare:workers'","'../../../env.cjs'").replaceAll("'@/lib/","'../../../lib/");
 source=source.replace(/from '(\.{1,2}\/[^']+)'/g,(_,path)=>`from '${path.endsWith('.cjs')?path:path+'.cjs'}'`);
 const path=new URL(file.replace(/\.ts$/,'.cjs'),build);mkdirSync(new URL('.',path),{recursive:true});writeFileSync(path,ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText);
}
writeFileSync(new URL('env.cjs',build),'exports.env = {};');
const require=createRequire(import.meta.url);const {env}=require(fileURLToPath(new URL('env.cjs',build)));const {createGame,transition,expireGame,clockMs,replay,pgn}=require(fileURLToPath(new URL('lib/game.cjs',build)));const {Store}=require(fileURLToPath(new URL('lib/server/store.cjs',build)));const {pinHash,verifyPin,sessionPlayer,digest}=require(fileURLToPath(new URL('lib/server/auth.cjs',build)));const {GET,POST}=require(fileURLToPath(new URL('app/api/room/route.cjs',build)));
const path=fileURLToPath(new URL('test.sqlite',build));try{rmSync(path)}catch{};let sql;
function connect(){sql=new DatabaseSync(path);return {prepare(text){const values=[];const statement={bind(...args){values.push(...args);return statement},async first(){return sql.prepare(text).get(...values)||null},async all(){return {results:sql.prepare(text).all(...values)}},async run(){const prepared=sql.prepare(text);if(prepared.columns().length)return {results:prepared.all(...values),meta:{changes:0},success:true};const r=prepared.run(...values);return {results:[],meta:{changes:Number(r.changes)},success:true}}};return statement;},async batch(statements){sql.exec('BEGIN');try{const values=[];for(const statement of statements)values.push(await statement.run());sql.exec('COMMIT');return values}catch(e){sql.exec('ROLLBACK');throw e}}}}
env.DB=connect();for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));
const testPins=['19462850','60392714'];env.PIN_ONE_HASH='local-one:'+await pinHash(testPins[0],'local-one');env.PIN_TWO_HASH='local-two:'+await pinHash(testPins[1],'local-two');
let passed=0;async function check(name,fn){await fn();console.log('PASS '+name);passed++;}
const request=(body,cookie='',origin='https://rival.test')=>new Request('https://rival.test/api/room',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie,'cf-connecting-ip':'test-player'},body:JSON.stringify(body)});
const get=(cookie='',suffix='')=>GET(new Request('https://rival.test/api/room'+suffix,{headers:{Cookie:cookie}}));
let cookieOne,cookieTwo;
await check('Anonymous game data and exports are blocked',async()=>{assert.equal((await get()).status,401);assert.equal((await get('','?export=all')).status,401);assert.equal((await POST(request({action:'create',minutes:5,increment:0}))).status,401)});
await check('Cross-origin writes and malformed JSON are rejected',async()=>{assert.equal((await POST(request({action:'login',pin:testPins[0]},'','https://other.test'))).status,403);assert.equal((await POST(new Request('https://rival.test/api/room',{method:'POST',headers:{Origin:'https://rival.test','Content-Type':'application/json'},body:'['}))).status,400)});
await check('Original PINs still resolve to the original player identities',async()=>{const a=await POST(request({action:'login',pin:testPins[0]}));assert.equal(a.status,200);cookieOne=a.headers.get('set-cookie').split(';')[0];assert.match(a.headers.get('set-cookie'),/HttpOnly.*SameSite=Strict.*Secure/);const walan=await a.json();assert.equal(walan.me,'one');assert.equal(walan.players.find(p=>p.id==='one').name,'Walan');const b=await POST(request({action:'login',pin:testPins[1]}));assert.equal(b.status,200);cookieTwo=b.headers.get('set-cookie').split(';')[0];const saif=await b.json();assert.equal(saif.me,'two');assert.equal(saif.players.find(p=>p.id==='two').name,'Saif');assert.equal(saif.players.find(p=>p.id==='two').character,'saif');assert.equal(saif.players.find(p=>p.id==='one').character,'walan');assert.notEqual(cookieOne,cookieTwo)});
await check('Invalid PIN and forged session are rejected',async()=>{assert.equal((await POST(request({action:'login',pin:'00000000'}))).status,401);assert.equal((await get('rr_session='+'a'.repeat(64))).status,401);assert.equal(await verifyPin('00000000',env.PIN_ONE_HASH),false)});
const store=new Store(env.DB);let g;
await check('A player cannot join two simultaneous challenges',async()=>{const r=await Promise.allSettled([store.create('one','two',1,0),store.create('two','one',10,2)]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);g=(await store.room('one')).game;assert.equal(g.status,'pending');assert.equal(g.whiteMs,60000)});
await check('Challenger cannot start clocks; opponent must accept',async()=>{assert.throws(()=>transition(g,g.challenger,'accept',{}));g=await store.act('two','accept',{gameId:g.id,version:g.version});assert.equal(g.status,'active');assert.ok(g.turnAt>0)});
await check('Out-of-turn and illegal moves leave the game unchanged',async()=>{await assert.rejects(store.act('two','move',{gameId:g.id,version:g.version,from:'e7',to:'e5'}));await assert.rejects(store.act('one','move',{gameId:g.id,version:g.version,from:'e2',to:'e5'}));assert.equal((await store.get(g.id)).moves.length,0)});
await check('Concurrent duplicate moves are saved once',async()=>{const r=await Promise.allSettled([store.act('one','move',{gameId:g.id,version:g.version,from:'f2',to:'f3'}),store.act('one','move',{gameId:g.id,version:g.version,from:'f2',to:'f3'})]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);g=await store.get(g.id);assert.deepEqual(g.moves,['f3'])});
await check('A checkmate finishes the game and records one result',async()=>{for(const [p,from,to] of [['two','e7','e5'],['one','g2','g4'],['two','d8','h4']])g=await store.act(p,'move',{gameId:g.id,version:g.version,from,to});assert.equal(g.status,'finished');assert.equal(g.winner,'two');assert.equal(g.reason,'Checkmate');const r=await store.room('one');assert.deepEqual(r.stats.one,{wins:0,losses:1,draws:0});await assert.rejects(store.act('two','move',{gameId:g.id,version:g.version,from:'h4',to:'e1'}));assert.equal((await store.room('one')).stats.two.wins,1);assert.match(pgn(g,r.players),/0-1/) });
await check('Database reopen preserves history, sessions and W/L/D',async()=>{sql.close();env.DB=connect();const room=await (await get(cookieOne)).json();assert.equal(room.stats.one.losses,1);assert.equal(room.recent.length,1);assert.equal(room.me,'one')});
const reopened=new Store(env.DB);
await check('Draw agreement requires the other player and persists a draw',async()=>{g=await reopened.create('one','two',10,2);assert.equal(g.white,'two');g=await reopened.act('two','accept',{gameId:g.id,version:g.version});g=await reopened.act('one','offerDraw',{gameId:g.id,version:g.version});await assert.rejects(reopened.act('one','acceptDraw',{gameId:g.id,version:g.version}));g=await reopened.act('two','acceptDraw',{gameId:g.id,version:g.version});assert.equal(g.winner,null);assert.equal((await reopened.room('two')).stats.two.draws,1)});
await check('Cancelled challenges never change the score',async()=>{g=await reopened.create('one','two',3,0);g=await reopened.act('one','cancel',{gameId:g.id,version:g.version});assert.equal((await reopened.room('one')).recent.length,2)});
await check('Server clocks and increment do not reset on reload',()=>{let t=createGame('one','two',1,2,1000);t=transition(t,'two','accept',{},2000);t=transition(t,'one','move',{from:'e2',to:'e4'},7000);assert.equal(t.whiteMs,57000);assert.equal(t.blackMs,60000);assert.equal(clockMs(t,'b',17000),50000);const exp=expireGame(t,68000);assert.equal(exp.status,'finished');assert.equal(exp.winner,'one');assert.equal(exp.blackMs,0)});
await check('A late move cannot beat a server-side timeout',()=>{let t=createGame('one','two',1,0,1000);t=transition(t,'two','accept',{},2000);t=transition(t,'one','move',{from:'e2',to:'e4'},62001);assert.equal(t.status,'finished');assert.equal(t.reason,'Time expired');assert.equal(t.moves.length,0)});
await check('Pending challenges expire without a result',()=>{const t=createGame('one','two',5,0,1000);assert.equal(expireGame(t,901000).status,'cancelled')});
await check('Castling and en passant remain legal',()=>{let t=transition(createGame('one','two',10,0,0),'two','accept',{},1);let now=2;for(const [from,to] of [['e2','e4'],['a7','a6'],['e4','e5'],['d7','d5'],['e5','d6']])t=transition(t,t.fen.split(' ')[1]==='w'?'one':'two','move',{from,to},now++);assert.equal(replay(t).get('d5'),undefined);assert.equal(replay(t).get('d6').type,'p');let c=transition(createGame('one','two',10,0,0),'two','accept',{},1);for(const [from,to] of [['e2','e4'],['e7','e5'],['g1','f3'],['b8','c6'],['f1','c4'],['g8','f6'],['e1','g1']])c=transition(c,c.fen.split(' ')[1]==='w'?'one':'two','move',{from,to},now++);assert.equal(replay(c).get('g1').type,'k');assert.equal(replay(c).get('f1').type,'r')});
await check('Pawn promotion preserves the selected knight',()=>{let t=transition(createGame('one','two',10,0,0),'two','accept',{},1);let now=2;for(const [from,to] of [['a2','a4'],['h7','h5'],['a4','a5'],['h5','h4'],['a5','a6'],['h4','h3'],['a6','b7'],['h3','g2']])t=transition(t,t.fen.split(' ')[1]==='w'?'one':'two','move',{from,to},now++);t=transition(t,'one','move',{from:'b7',to:'a8',promotion:'n'},now);assert.equal(replay(t).get('a8').type,'n');assert.match(t.moves.at(-1),/=N/)});
await check('Threefold repetition automatically saves a draw',()=>{let t=transition(createGame('one','two',10,0,0),'two','accept',{},1);let now=2;for(let i=0;i<2;i++)for(const [from,to] of [['g1','f3'],['g8','f6'],['f3','g1'],['f6','g8']])t=transition(t,t.fen.split(' ')[1]==='w'?'one':'two','move',{from,to},now++);assert.equal(t.status,'finished');assert.equal(t.reason,'Threefold repetition')});
await check('A profile change only changes the current player',async()=>{const r=await POST(request({action:'rename',name:'Rival'},cookieTwo));assert.equal(r.status,200);const data=await r.json();assert.equal(data.players.find(p=>p.id==='two').name,'Rival');assert.equal(data.players.find(p=>p.id==='one').name,'Walan')});
await check('PIN guessing hits a persistent rate limit',async()=>{for(let i=0;i<8;i++)await POST(request({action:'login',pin:'00000000'}));assert.equal((await POST(request({action:'login',pin:testPins[0]}))).status,429)});
await check('Locking revokes only the current session',async()=>{assert.equal((await POST(request({action:'logout'},cookieOne))).status,200);assert.equal((await get(cookieOne)).status,401);assert.equal((await get(cookieTwo)).status,200)});
await check('Export contains saved games but no PIN or session hashes',async()=>{const data=await (await get(cookieTwo,'?export=all')).json();assert.equal(data.games.length,3);assert.equal(data.stats.two.wins,1);assert.ok(!JSON.stringify(data).includes('token_hash'));assert.ok(!JSON.stringify(data).includes('PIN_'))});

await check('Upgrade preserves old identities, games, sessions and an occupied board',()=>{
 const legacy=new DatabaseSync(':memory:');
 legacy.exec(readFileSync(new URL('../drizzle/0000_overjoyed_the_anarchist.sql',import.meta.url),'utf8'));
 legacy.exec("INSERT INTO players VALUES ('one','Existing Nabeel'),('two','Existing Saif'); INSERT INTO sessions VALUES ('old-token','one',9999999999999)");
 const active=transition(createGame('one','two',10,0),'two','accept',{});
 const finished={...active,id:'old-finished',status:'finished',winner:'two',finishedAt:Date.now()};
 legacy.prepare('INSERT INTO games VALUES (?,1,?,0,?,NULL)').run(active.id,JSON.stringify(active),active.createdAt);
 legacy.prepare('INSERT INTO games VALUES (?,NULL,?,0,?,?)').run(finished.id,JSON.stringify(finished),finished.createdAt,finished.finishedAt);
 legacy.exec(readFileSync(new URL('../drizzle/0001_multiple_rivals.sql',import.meta.url),'utf8'));
 assert.equal(legacy.prepare('SELECT COUNT(*) AS n FROM games').get().n,2);
 assert.equal(legacy.prepare("SELECT name FROM players WHERE id='two'").get().name,'Existing Saif');
 assert.equal(legacy.prepare("SELECT player_id FROM sessions WHERE token_hash='old-token'").get().player_id,'one');
 assert.deepEqual(legacy.prepare('SELECT player_id FROM game_seats ORDER BY player_id').all().map(r=>r.player_id),['one','two']);
 assert.equal(legacy.prepare("SELECT state FROM games WHERE id='old-finished'").get().state,JSON.stringify(finished));
 legacy.exec("UPDATE players SET pin_hash='retained-hash' WHERE id='two'; INSERT INTO players(id,name,pin_hash) VALUES ('usman','Usman','usman-hash')");
 legacy.exec("INSERT INTO sessions VALUES ('usman-token','usman',9999999999999)");
 const usmanGame={...finished,id:'usman-history',white:'usman',black:'one',winner:'usman'};
 legacy.prepare('INSERT INTO games VALUES (?,NULL,?,0,?,?)').run(usmanGame.id,JSON.stringify(usmanGame),usmanGame.createdAt,usmanGame.finishedAt);
 const retained = Object.fromEntries(['games','sessions','game_seats','pin_settings'].map(table=>[table,legacy.prepare('SELECT * FROM '+table).all()]));
 legacy.exec(readFileSync(new URL('../drizzle/0002_character_names.sql',import.meta.url),'utf8'));
 assert.deepEqual(legacy.prepare('SELECT id,name,pin_hash FROM players ORDER BY id').all().map(r=>({...r})),[
  {id:'one',name:'Walan',pin_hash:null},{id:'two',name:'Gud',pin_hash:'retained-hash'},{id:'usman',name:'Usman',pin_hash:'usman-hash'}
 ]);
 legacy.exec(readFileSync(new URL('../drizzle/0003_gud_usman.sql',import.meta.url),'utf8'));
 assert.deepEqual(legacy.prepare('SELECT id,name,pin_hash,character FROM players ORDER BY id').all().map(r=>({...r})),[
  {id:'one',name:'Walan',pin_hash:null,character:'walan'},
  {id:'two',name:'Saif',pin_hash:'retained-hash',character:null},
  {id:'usman',name:'Gud',pin_hash:'usman-hash',character:'gud'}
 ]);
 for(const [table,rows] of Object.entries(retained))assert.deepEqual(legacy.prepare('SELECT * FROM '+table).all(),rows,table+' must not change during character rename');
 legacy.exec("UPDATE players SET name='Custom Saif' WHERE id='two'; INSERT INTO players(id,name,pin_hash) VALUES ('different-id','Saif','another-hash')");
 const beforeSaif=legacy.prepare('SELECT * FROM players ORDER BY id').all().map(r=>({...r}));
 const saifMigration=readFileSync(new URL('../drizzle/0005_saif_character.sql',import.meta.url),'utf8');
 legacy.exec(saifMigration);legacy.exec(saifMigration);
 assert.deepEqual(legacy.prepare('SELECT * FROM players ORDER BY id').all().map(r=>({...r})),beforeSaif.map(p=>p.id==='two'?{...p,character:'saif'}:p));
 for(const [table,rows] of Object.entries(retained))assert.deepEqual(legacy.prepare('SELECT * FROM '+table).all(),rows,table+' must not change when assigning Saif artwork');
 legacy.close();
});
let usman,cookieUsman;
await check('Add-player command creates a distinct code without resetting existing identities',async()=>{
 const salt=sql.prepare('SELECT salt FROM pin_settings WHERE id=1').get().salt;
 usman=newPlayer('Usman',salt);
 assert.match(usman.pin,/^\d{12}$/);
 assert.equal(sql.prepare(usman.sql).get().id,usman.id);
 assert.equal(sql.prepare('SELECT pin_hash FROM players WHERE id=?').get(usman.id).pin_hash,await pinHash(usman.pin,salt));
 assert.equal(sql.prepare(newPlayer('usman',salt).sql).get(),undefined);
 const quoted=newPlayer("O'Neil",salt);assert.equal(sql.prepare(quoted.sql).get().id,quoted.id);sql.prepare('DELETE FROM players WHERE id=?').run(quoted.id);
 assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM players WHERE id IN ('one','two')").get().n,2);
 sql.exec('DELETE FROM attempts');
 const login=await POST(request({action:'login',pin:usman.pin}));assert.equal(login.status,200);
 cookieUsman=login.headers.get('set-cookie').split(';')[0];const data=await login.json();
 assert.equal(data.me,usman.id);assert.equal(data.players.find(p=>p.id===usman.id).name,'Gud');assert.equal(data.players.find(p=>p.id===usman.id).character,'gud');assert.equal(data.players.find(p=>p.id==='two').character,'saif');
 assert.deepEqual(data.stats[usman.id],{wins:0,losses:0,draws:0});assert.equal(data.game,null);assert.deepEqual(data.recent,[]);
 assert.ok(!JSON.stringify(data).includes('pin_hash'));assert.ok(!JSON.stringify(data).includes(usman.pin));
});
await check('Unrelated players cannot accept, move, cancel, resign or draw in another game',async()=>{
 g=await reopened.create('one','two',5,0);
 for(const action of ['accept','move','cancel','resign','offerDraw','acceptDraw','declineDraw']){
  const r=await POST(request({action,gameId:g.id,version:g.version,from:'e2',to:'e4'},cookieUsman));assert.equal(r.status,403,action);
 }
 assert.equal((await reopened.get(g.id)).version,0);
 assert.equal((await (await get(cookieUsman)).json()).game,null);
 await assert.rejects(reopened.create(usman.id,'one',5,0),/already has a game/);
 await assert.rejects(reopened.create(usman.id,usman.id,5,0));
 await assert.rejects(reopened.create(usman.id,'missing-person',5,0));
 await reopened.act('one','cancel',{gameId:g.id,version:g.version});
});
await check('Overlapping challenges have one winner; disjoint pairs can play simultaneously',async()=>{
 sql.prepare('INSERT INTO players(id,name) VALUES (?,?)').run('four','Fourth test player');
 const attempts=await Promise.allSettled([reopened.create('one',usman.id,5,0),reopened.create('two',usman.id,5,0)]);
 assert.equal(attempts.filter(a=>a.status==='fulfilled').length,1);
 const first=attempts.find(a=>a.status==='fulfilled').value;
 const other=first.challenger==='one'?'two':'one';
 const second=await reopened.create(other,'four',5,0);
 assert.equal((await reopened.room(usman.id)).game.id,first.id);
 assert.equal((await reopened.room(other)).game.id,second.id);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM game_seats').get().n,4);
 await reopened.act(first.challenger,'cancel',{gameId:first.id,version:0});
 await reopened.act(other,'cancel',{gameId:second.id,version:0});
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM game_seats').get().n,0);
});
await check('Wins, losses and draws count only for the two actual participants and their pairing',async()=>{
 const before=(await reopened.room('one')).stats;
 let match=await reopened.create('one',usman.id,1,0);
 match=await reopened.act(usman.id,'accept',{gameId:match.id,version:match.version});
 match=await reopened.act('one','resign',{gameId:match.id,version:match.version});
 assert.equal(match.winner,usman.id);
 let room=await reopened.room(usman.id);
 assert.deepEqual(room.stats[usman.id],{wins:1,losses:0,draws:0});
 assert.deepEqual(room.stats.two,before.two);
 assert.equal(room.stats.one.losses,before.one.losses+1);
 match=await reopened.create(usman.id,'two',5,2);
 match=await reopened.act('two','accept',{gameId:match.id,version:match.version});
 match=await reopened.act(usman.id,'offerDraw',{gameId:match.id,version:match.version});
 match=await reopened.act('two','acceptDraw',{gameId:match.id,version:match.version});
 room=await reopened.room('one');
 assert.equal(room.stats.one.draws,before.one.draws);
 assert.deepEqual(room.headToHead.two,{wins:0,losses:1,draws:1});
 assert.deepEqual(room.headToHead[usman.id],{wins:0,losses:1,draws:0});
 const u=await reopened.room(usman.id);
 assert.deepEqual(u.stats[usman.id],{wins:1,losses:0,draws:1});
 assert.deepEqual(u.headToHead.one,{wins:1,losses:0,draws:0});
 assert.deepEqual(u.headToHead.two,{wins:0,losses:0,draws:1});
 assert.equal(u.stats.four.draws,0);
 await assert.rejects(reopened.act('two','acceptDraw',{gameId:match.id,version:match.version}));
 assert.equal((await reopened.room(usman.id)).stats[usman.id].draws,1);
});
await check('Rematch colors alternate separately for each pairing',async()=>{
 const match=await reopened.create('one',usman.id,5,0);assert.equal(match.white,usman.id);
 await reopened.act('one','cancel',{gameId:match.id,version:0});
 const saif=await reopened.create('two',usman.id,5,0);assert.equal(saif.white,'two');
 await reopened.act('two','cancel',{gameId:saif.id,version:0});
});
await check('History and exports include only your games; renaming keeps your scores and PIN identity',async()=>{
 await reopened.rename(usman.id,'Usman Updated');
 const data=await (await get(cookieUsman,'?export=all')).json();
 assert.equal(data.me,usman.id);assert.equal(data.players.find(p=>p.id===usman.id).name,'Usman Updated');assert.equal(data.players.find(p=>p.id===usman.id).character,'gud');assert.equal(sql.prepare(newPlayer('Usman',sql.prepare('SELECT salt FROM pin_settings WHERE id=1').get().salt).sql).get(),undefined);
 assert.ok(data.games.length>0);assert.ok(data.games.every(g=>g.white===usman.id||g.black===usman.id));
 assert.equal(data.recent.length,2);assert.ok(data.recent.every(g=>g.white===usman.id||g.black===usman.id));
 assert.deepEqual(data.stats[usman.id],{wins:1,losses:0,draws:1});
 const text=JSON.stringify(data);assert.ok(!text.includes('pin_hash'));assert.ok(!text.includes(usman.pin));assert.ok(!text.includes('token_hash'));
 const again=await POST(request({action:'login',pin:usman.pin}));assert.equal((await again.json()).me,usman.id);
 sql.close();env.DB=connect();assert.equal((await (await get(cookieUsman)).json()).stats[usman.id].wins,1);
});

const {getCharacter,characterForColor}=require(fileURLToPath(new URL('lib/characters.cjs',build)));
await check('PIN-linked characters stay with Walan, Gud, and Saif across renames and color swaps',async()=>{
 const room=await reopened.room(usman.id);
 const walan=room.players.find(p=>p.id==='one'),gud=room.players.find(p=>p.id===usman.id),saif=room.players.find(p=>p.id==='two');
 assert.equal(getCharacter(walan.character).name,'Walan');assert.equal(getCharacter(gud.character).name,'Gud');
 assert.equal(getCharacter(saif.character).name,'Saif');assert.equal(getCharacter(saif.character).image,'/characters/saif.webp');
 assert.equal(characterForColor('w',walan.character,gud.character).key,'walan');assert.equal(characterForColor('b',walan.character,gud.character).key,'gud');
 assert.equal(characterForColor('w',gud.character,walan.character).key,'gud');assert.equal(characterForColor('b',gud.character,walan.character).key,'walan');
 for(const white of [walan,gud,saif])for(const black of [walan,gud,saif]){
  assert.equal(characterForColor('w',white.character,black.character).key,white.character);
  assert.equal(characterForColor('b',white.character,black.character).key,black.character);
 }
 assert.equal(newPlayer('Saif',sql.prepare('SELECT salt FROM pin_settings WHERE id=1').get().salt).character,null); // A matching display name does not grant his artwork.
 await reopened.rename('two','Gud');
 assert.equal(getCharacter((await reopened.room('two')).players.find(p=>p.id==='two').character).key,'saif');
 assert.equal(getCharacter(usman.id),null);assert.equal(getCharacter('two'),null);assert.equal(getCharacter(undefined),null);
});
const {Chess}=require('chess.js');
const {materialSummary}=require(fileURLToPath(new URL('lib/material.cjs',build)));
await check('Capture rows belong to the capturer and net material handles trades, en passant, and promotions',()=>{
 const start=materialSummary(new Chess());assert.deepEqual(start.lead,{w:0,b:0});assert.equal(Object.values(start.captures.w).reduce((a,b)=>a+b,0),0);
 const queen=new Chess('r3k3/8/8/8/8/8/q7/R2QK3 w - - 0 1');queen.move('Rxa2');
 assert.equal(materialSummary(queen).captures.w.q,1);assert.deepEqual(materialSummary(queen).lead,{w:9,b:0});
 queen.move('Rxa2');assert.equal(materialSummary(queen).captures.b.r,1);assert.deepEqual(materialSummary(queen).lead,{w:4,b:0});
 const trade=new Chess();for(const m of ['e4','d5','exd5','Qxd5'])trade.move(m);
 assert.equal(materialSummary(trade).captures.w.p,1);assert.equal(materialSummary(trade).captures.b.p,1);assert.deepEqual(materialSummary(trade).lead,{w:0,b:0});
 const ep=new Chess();for(const m of ['e4','a6','e5','d5','exd6'])ep.move(m);
 assert.equal(materialSummary(ep).captures.w.p,1);assert.deepEqual(materialSummary(ep).lead,{w:1,b:0});
 for(const promotion of ['q','n']){
  const chess=new Chess('7k/P7/8/8/8/8/8/7K w - - 0 1');chess.move({from:'a7',to:'a8',promotion});
  const result=materialSummary(chess);assert.equal(result.lead.w,promotion==='q'?9:3);assert.equal(result.captures.w.p,0);
 }
 const promotedCapture=new Chess('r6k/1P6/8/8/8/8/8/7K w - - 0 1');promotedCapture.move('bxa8=Q+');
 assert.equal(materialSummary(promotedCapture).captures.w.r,1);assert.equal(materialSummary(promotedCapture).lead.w,9);
 promotedCapture.undo();assert.deepEqual(materialSummary(promotedCapture).lead,{w:0,b:4});assert.equal(materialSummary(promotedCapture).captures.w.r,0);
});
const {squareAt,legalMove,previewMove,premoveReady,premoveTargets,boardTargets,boardMove}=require(fileURLToPath(new URL('lib/board.cjs',build)));
const {mergeRoom}=require(fileURLToPath(new URL('lib/room-update.cjs',build)));
const {parseInfo,classify}=require(fileURLToPath(new URL('lib/review.cjs',build)));
await check('Drag coordinates match both orientations and reject off-board drops',()=>{
 assert.equal(squareAt(1,1,800,'w'),'a8');assert.equal(squareAt(799,799,800,'w'),'h1');
 assert.equal(squareAt(1,1,800,'b'),'h1');assert.equal(squareAt(799,799,800,'b'),'a8');
 assert.equal(squareAt(-1,20,800,'w'),null);assert.equal(squareAt(800,20,800,'w'),null);
});
await check('Castling works on both wings and cannot go through check or ignore lost rights',()=>{
 for(const color of ['w','b'])for(const wing of ['c','g']){
  const fen=`r3k2r/8/8/8/8/8/8/R3K2R ${color} KQkq - 0 1`,rank=color==='w'?'1':'8';
  assert.equal(legalMove(fen,{from:'e'+rank,to:wing+rank}),true);
 }
 assert.equal(legalMove('4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1',{from:'e1',to:'g1'}),false);
 assert.equal(legalMove('r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1',{from:'e1',to:'c1'}),false);
 let t=transition(createGame('one','two',10,0,0),'two','accept',{},1);let now=2;
 const c=new Chess();for(const san of ['d4','d5','Nc3','Nc6','Bf4','Bf5','Qd2','Qd7','O-O-O','O-O-O']){const m=c.move(san);t=transition(t,m.color==='w'?'one':'two','move',{from:m.from,to:m.to},now++);}
 assert.equal(replay(t).get('c1').type,'k');assert.equal(replay(t).get('d8').type,'r');
});
await check('Immediate move preview keeps server state immutable and moves the rook when castling',()=>{
 const game={...createGame('one','two',5,0),status:'active',turnAt:1000};const shown=previewMove(game,'one',{from:'e2',to:'e4'},1500);
 assert.equal(game.moves.length,0);assert.equal(shown.moves[0],'e4');assert.equal(shown.version,game.version);assert.equal(shown.whiteMs,299500);
 const castle={...game,fen:'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'};const castled=previewMove(castle,'one',{from:'e1',to:'g1'},1500);
 assert.equal(new Chess(castled.fen).get('f1').type,'r');assert.equal(castled.status,'active');
});
await check('King-to-rook taps and drops castle on both wings for either color without bypassing the rules',()=>{
 for(const color of ['w','b'])for(const [rookFile,kingFile] of [['h','g'],['a','c']]){
  const rank=color==='w'?'1':'8',chess=new Chess(`r3k2r/8/8/8/8/8/8/R3K2R ${color} KQkq - 0 1`);
  const from='e'+rank,to=kingFile+rank,rook=rookFile+rank;
  assert.ok(boardTargets(chess,from,color).includes(rook));
  assert.deepEqual(boardMove(chess,from,rook,color),{from,to});
  assert.deepEqual(boardMove(chess,from,to,color),{from,to});
  chess.move(boardMove(chess,from,rook,color));
  assert.equal(chess.get(to).type,'k');assert.equal(chess.get((rookFile==='h'?'f':'d')+rank).type,'r');
 }
 for(const fen of ['r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1','4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1','4k3/8/8/8/8/8/8/R3KB1R w KQ - 0 1','k3r3/8/8/8/8/8/8/R3K2R w KQ - 0 1']){
  assert.equal(boardMove(new Chess(fen),'e1','h1','w'),null);
 }
 assert.equal(boardMove(new Chess(),'e1','h1','w'),null);
 assert.equal(boardMove(new Chess(),'e2','d2','w'),null);
 const before=new Chess('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1');
 const intent=boardMove(before,'e1','h1','w');assert.deepEqual(intent,{from:'e1',to:'g1'});
 const game={...createGame('one','two',5,0),status:'active',fen:'k4r2/8/8/8/8/8/8/R3K2R w KQ - 0 1'};
 assert.equal(premoveReady(game,'one',{...intent,gameId:game.id}),false);
});
await check('Premoves wait for the opponent, revalidate legality, and cannot cross games',()=>{
 let game=transition(createGame('one','two',5,0,0),'two','accept',{},1);
 const queued={from:'e7',to:'e5',gameId:game.id};assert.equal(premoveReady(game,'two',queued),false);
 game=transition(game,'one','move',{from:'e2',to:'e4'},2);assert.equal(premoveReady(game,'two',queued),true);
 assert.equal(premoveReady(game,'two',{...queued,gameId:'old-game'}),false);
 assert.equal(premoveReady(game,'two',{...queued,from:'e8',to:'e6'}),false);
 assert.ok(premoveTargets(new Chess(),'g8','b').includes('f6'));
 const promotion={...game,fen:'7k/8/8/8/8/8/p7/7K b - - 0 1'};
 assert.equal(premoveReady(promotion,'two',{from:'a2',to:'a1',promotion:'n',gameId:game.id}),true);
});
await check('Capture premoves include friendly recapture squares for both colors and require a legal reply',()=>{
 for(const [color,fen,from,to,reply] of [
  ['w','4k3/8/8/8/1b6/2N5/3P4/4K3 b - - 0 1','d2','c3','Bxc3'],
  ['b','4k3/3p4/2n5/1B6/8/8/8/4K3 w - - 0 1','d7','c6','Bxc6']
 ]){
  const chess=new Chess(fen),me=color==='w'?'one':'two';
  const game={...createGame('one','two',5,0),status:'active',fen};
  assert.ok(boardTargets(chess,from,color).includes(to));
  const queued={...boardMove(chess,from,to,color),gameId:game.id};
  assert.equal(premoveReady(game,me,queued),false);
  const noCapture=new Chess(fen);noCapture.move(color==='w'?'Kf8':'Kf1');
  assert.equal(premoveReady({...game,fen:noCapture.fen()},me,queued),false);
  assert.equal(boardMove(noCapture,from,to,color),null,'friendly captures on your turn stay illegal');
  chess.move(reply);assert.equal(premoveReady({...game,fen:chess.fen()},me,queued),true);
  assert.equal(chess.move(queued).captured,'b');
 }
 const capture=new Chess('4k3/8/8/8/q7/8/8/R3K3 b - - 0 1');
 const intent=boardMove(capture,'a1','a4','w');assert.deepEqual(intent,{from:'a1',to:'a4'});
 capture.move('Kf8');assert.equal(capture.move(intent).captured,'q');
});
await check('Pawn capture premoves support en passant and promotion without bypassing checks',()=>{
 const base={...createGame('one','two',5,0),status:'active'};
 const chess=new Chess('4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1');
 const intent=boardMove(chess,'e5','d6','w');assert.deepEqual(intent,{from:'e5',to:'d6'});
 const queued={...intent,gameId:base.id};
 const noCapture=new Chess(chess.fen());noCapture.move('Kf8');assert.equal(premoveReady({...base,fen:noCapture.fen()},'one',queued),false);
 chess.move('d5');assert.equal(premoveReady({...base,fen:chess.fen()},'one',queued),true);assert.ok(chess.move(intent).isEnPassant());
 const promote=new Chess('1r5k/P7/8/8/8/8/8/7K b - - 0 1');
 const promotion={...boardMove(promote,'a7','b8','w'),promotion:'n',gameId:base.id};promote.move('Kg8');
 assert.equal(premoveReady({...base,fen:promote.fen()},'one',promotion),true);promote.move(promotion);assert.equal(promote.get('b8').type,'n');
 assert.equal(premoveReady({...base,fen:'4r2k/8/8/8/8/8/4Rb2/4K3 w - - 0 1'},'one',{from:'e2',to:'f2',gameId:base.id}),false,'recapture cannot expose the king');
 assert.equal(premoveReady({...base,fen:chess.fen()},'one',{from:'d2',to:'c3',gameId:base.id}),false,'captured origin cancels');
});
await check('Late polling responses cannot rewind a live board',()=>{
 const game=createGame('one','two',5,0);const old={me:'one',game:{...game,version:3},serverNow:100,players:[],stats:{},headToHead:{},recent:[]};
 assert.equal(mergeRoom(old,{me:'one',game:{...game,version:2},serverNow:200}),old);
 assert.equal(mergeRoom(old,{me:'one',game:{...game,version:4},serverNow:101}).game.version,4);
 assert.equal(mergeRoom(old,{me:'two',game,serverNow:200}),old);
});
await check('Duplicate game versions preserve board identity while fresh records and clock samples update',()=>{
 const game=createGame('one','two',5,0),old={me:'one',game,serverNow:100,players:[],stats:{},headToHead:{},recent:[]};
 const update=mergeRoom(old,{...old,game:structuredClone(game),serverNow:200,headToHead:{two:{wins:2,losses:1,draws:0}}});
 assert.equal(update.game,game);assert.equal(update.serverNow,200);assert.equal(update.headToHead.two.wins,2);
 const newer={...game,version:1,status:'active',turnAt:201};
 assert.equal(mergeRoom(update,{me:'one',game:newer,serverNow:201}).game,newer);
 const next=createGame('one','two',5,0,game.createdAt+1);
 assert.equal(mergeRoom(update,{me:'one',game:next,serverNow:202}).game,next);
 assert.equal(mergeRoom(update,{me:'one',game:structuredClone(game),serverNow:99}),update);
});
const {roomPollDelay}=require(fileURLToPath(new URL('lib/connection.cjs',build)));
await check('Healthy sockets reduce polling without delaying flag checks or fast fallback',()=>{
 let match=transition(createGame('one','two',1,2,1000),'two','accept',{},2000);
 assert.equal(roomPollDelay(match,true,false,2000),5000);
 assert.equal(roomPollDelay(match,false,false,2000),350);
 assert.equal(roomPollDelay(match,true,false,61000),1080);
 assert.equal(roomPollDelay(match,true,false,62000),250);
 assert.equal(roomPollDelay(match,true,true,61000),5000);
 match=transition(match,'one','move',{from:'e2',to:'e4'},61000);
 assert.equal(roomPollDelay(match,true,false,61000),5000);
 assert.equal(roomPollDelay(match,true,false,120000),1080);
 assert.equal(roomPollDelay({...match,status:'finished'},true,false,200000),5000);
 assert.equal(roomPollDelay(null,false,false,2000),1500);
});
await check('Review normalizes engine scores to White and classifies errors for either side',()=>{
 assert.equal(parseInfo('info depth 15 score cp 120 pv e7e5','b').cp,-120);
 assert.equal(parseInfo('info depth 12 score mate -3 pv e7e5','b').mate,3);
 assert.equal(parseInfo('info depth 12 score cp 50 lowerbound pv e2e4','w'),null);
 const board=new Chess();const w=board.move('f3'),b=board.move('e5');const score=(cp,best)=>({cp,best,mate:null,pv:[best],depth:15});
 assert.equal(classify(w,score(20,'e2e4'),score(-250,'e7e5')).quality,'Blunder');
 assert.equal(classify(b,score(-20,'d7d5'),score(150,'e2e4')).quality,'Mistake');
 assert.equal(classify(w,score(20,'f2f3'),score(10,'e7e5')).quality,'Best');
});

await check('Chosen six-digit PIN replaces only its owner code and sessions, retaining leading zeros',async()=>{
 sql.exec('DELETE FROM attempts');
 const oldLogin=await POST(request({action:'login',pin:testPins[0]}));const oldSession=oldLogin.headers.get('set-cookie').split(';')[0];
 const salt=sql.prepare('SELECT salt FROM pin_settings WHERE id=1').get().salt;
 const savedGames=sql.prepare('SELECT * FROM games ORDER BY id').all();
 assert.equal(sql.prepare(pinUpdate('one','004281',salt)).get().id,'one');
 assert.equal((await get(oldSession)).status,401);
 assert.equal((await POST(request({action:'login',pin:testPins[0]}))).status,401);
 const changed=await POST(request({action:'login',pin:'004281'}));assert.equal(changed.status,200);assert.equal((await changed.json()).me,'one');
 assert.equal((await get(cookieTwo)).status,200);assert.equal((await get(cookieUsman)).status,200);
 assert.equal(sql.prepare(pinUpdate('two','004281',salt)).get(),undefined);
 assert.equal((await POST(request({action:'login',pin:testPins[1]}))).status,200);
 assert.deepEqual(sql.prepare('SELECT * FROM games ORDER BY id').all(),savedGames);
 assert.throws(()=>pinUpdate('one','1234',salt),/6 digits/);
});
await check('Gud can replace his long code without changing his identity or character',async()=>{
 sql.exec('DELETE FROM attempts');const salt=sql.prepare('SELECT salt FROM pin_settings WHERE id=1').get().salt;
 sql.prepare(pinUpdate(usman.id,'583920',salt)).get();
 assert.equal((await get(cookieUsman)).status,401);
 assert.equal((await POST(request({action:'login',pin:usman.pin}))).status,401);
 const logged=await POST(request({action:'login',pin:'583920'}));assert.equal(logged.status,200);cookieUsman=logged.headers.get('set-cookie').split(';')[0];const room=await logged.json();
 assert.equal(room.me,usman.id);assert.equal(room.players.find(p=>p.id===usman.id).character,'gud');assert.equal(room.stats[usman.id].wins,1);
});
const {handleBridge,resultOpening}=require(fileURLToPath(new URL('lib/server/imessage.cjs',build)));
await check('Group phrases alternate approved win wording, preserve winner order, and use a separate draw pool',()=>{
 const wins=Array.from({length:8},(_,i)=>resultOpening('Usman','Nabeel',false,i+1));
 assert.equal(new Set(wins.slice(0,4)).size,4);
 for(let i=0;i<wins.length;i++){
  assert.ok(wins[i].startsWith(i%2===0?'Usman gooned on Nabeel':'Usman beat Nabeel’s ass'));
  assert.equal(wins[i],resultOpening('Usman','Nabeel',false,i+1));
 }
 assert.equal(wins[0],wins[4]);
 const draws=Array.from({length:3},(_,i)=>resultOpening('Saif','Nabeel',true,i+1));
 assert.equal(new Set(draws).size,3);
 for(const line of draws){assert.match(line,/^Saif and Nabeel drew\./);assert.doesNotMatch(line,/gooned|beat .*ass/);}
});
const bridgeToken='c'.repeat(64);env.IMESSAGE_BRIDGE_HASH=await digest(bridgeToken);
const bridge=(body,token=bridgeToken)=>handleBridge(new Request('https://rival.test/api/imessage',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)}),env);
await check('Notification queue is off by default and cannot be read with a PIN or forged bridge token',async()=>{
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n,0);
 assert.equal((await bridge({action:'status'},'')).status,401);assert.equal((await bridge({action:'claim'},'d'.repeat(64))).status,401);
 assert.equal((await (await bridge({action:'claim'})).json()).enabled,false);
 sql.exec('UPDATE notification_settings SET enabled=1');assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n,0);
});
let notificationGame,firstJob;
await check('A committed challenge queues once and concurrent bridge claims cannot both take it',async()=>{
 notificationGame=await reopened.create('one','two',5,0);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n,1);
 const claims=await Promise.all([bridge({action:'claim'}),bridge({action:'claim'})]);const bodies=await Promise.all(claims.map(r=>r.json()));
 const jobs=bodies.map(b=>b.job).filter(Boolean);assert.equal(jobs.length,1);firstJob=jobs[0];
 assert.equal(firstJob.recipientId,'two');assert.equal(firstJob.kind,'challenge');assert.match(firstJob.text,/5\+0 chess/);assert.match(firstJob.text,/Play: https:\/\/rival.test\//);assert.ok(!JSON.stringify(firstJob).includes('pin_hash'));
 assert.match(firstJob.text,/^Nabeel challenged you/);
 assert.equal((await bridge({action:'ack',id:firstJob.id,leaseToken:'wrong',status:'sent'})).status,409);
 assert.equal((await bridge({action:'ack',id:firstJob.id,leaseToken:firstJob.leaseToken,status:'sent'})).status,200);
 assert.equal((await (await bridge({action:'claim'})).json()).job,null);
});
await check('A finished game queues one result with both identities, characters, and pair scores',async()=>{
 notificationGame=await reopened.act('two','accept',{gameId:notificationGame.id,version:notificationGame.version});
 notificationGame=await reopened.act('one','resign',{gameId:notificationGame.id,version:notificationGame.version});
 await assert.rejects(reopened.act('one','resign',{gameId:notificationGame.id,version:notificationGame.version}));
 assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE kind='result'").get().n,1);
 const job=(await (await bridge({action:'claim'})).json()).job;
 assert.equal(job.kind,'result');assert.equal(job.result.winnerId,'two');assert.equal(job.result.white.character,'walan');assert.equal(job.result.black.character,'saif');
 assert.ok(job.result.score.blackWins>=1);assert.equal(job.result.reason,'Resignation');
 assert.match(job.text,/^Saif (?:gooned on Nabeel|beat Nabeel’s ass)/);assert.doesNotMatch(job.text,/https?:\/\/|Walan|Gud/);assert.equal(job.recipientId,null);
 const record=(await reopened.room('one')).headToHead.two;
 assert.deepEqual(job.result.score,{whiteWins:record.wins,blackWins:record.losses,draws:record.draws});
 assert.match(job.text,new RegExp('Saif '+record.losses+' wins? · Nabeel '+record.wins+' wins? · '+record.draws+' draws?'));
 await bridge({action:'ack',id:job.id,leaseToken:job.leaseToken,status:'needs_review',detail:'test uncertain'});
 assert.equal((await (await bridge({action:'claim'})).json()).job,null);
 assert.equal((await (await bridge({action:'retry',id:job.id})).json()).updated,true);
 const again=(await (await bridge({action:'claim'})).json()).job;assert.equal(again.attempts,1);assert.equal(again.text,job.text);
 await bridge({action:'ack',id:again.id,leaseToken:again.leaseToken,status:'sent'});
});
await check('Cancelled challenges are skipped and never create winner announcements',async()=>{
 let game=await reopened.create('one','two',5,0);game=await reopened.act('one','cancel',{gameId:game.id,version:game.version});
 assert.equal((await (await bridge({action:'claim'})).json()).job,null);
 assert.equal(sql.prepare('SELECT status FROM notification_outbox WHERE id=?').get(game.id+':challenge').status,'skipped');
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM notification_outbox WHERE id=?').get(game.id+':result').n,0);
});
await check('The bridge settles expired clocks without an open browser and persists lease recovery',async()=>{
 let game=await reopened.create('one',usman.id,1,0);game=await reopened.act(usman.id,'accept',{gameId:game.id,version:game.version});
 await reopened.save(game,{...game,whiteMs:1,blackMs:1,turnAt:Date.now()-100});
 const job=(await (await bridge({action:'claim'})).json()).job;assert.equal(job.kind,'result');assert.equal(job.result.reason,'Time expired');
 assert.match(job.text,/Usman/);assert.match(job.text,/Nabeel/);assert.doesNotMatch(job.text,/Walan|Gud|Saif/);
 const record=(await reopened.room(job.result.white.id)).headToHead[job.result.black.id];
 assert.deepEqual(job.result.score,{whiteWins:record.wins,blackWins:record.losses,draws:record.draws});
 sql.prepare('UPDATE notification_outbox SET lease_until=0 WHERE id=?').run(job.id);
 const recovered=(await (await bridge({action:'claim'})).json()).job;assert.equal(recovered.id,job.id);assert.equal(recovered.attempts,2);assert.notEqual(recovered.leaseToken,job.leaseToken);
 assert.equal((await bridge({action:'ack',id:job.id,leaseToken:job.leaseToken,status:'sent'})).status,409);
 await bridge({action:'ack',id:recovered.id,leaseToken:recovered.leaseToken,status:'sent'});
});
await check('Draw announcements name the players and update only their pair record',async()=>{
 let game=await reopened.create('one','two',5,0);
 game=await reopened.act('two','accept',{gameId:game.id,version:game.version});
 game=await reopened.act('one','offerDraw',{gameId:game.id,version:game.version});
 await reopened.act('two','acceptDraw',{gameId:game.id,version:game.version});
 const job=(await (await bridge({action:'claim'})).json()).job;
 assert.equal(job.kind,'result');assert.equal(job.result.winnerId,null);assert.match(job.text,/ drew\./);
 assert.match(job.text,/Nabeel/);assert.match(job.text,/Saif/);assert.doesNotMatch(job.text,/ beat |https?:\/\/|Walan|Gud|Usman/);
 const record=(await reopened.room(job.result.white.id)).headToHead[job.result.black.id];
 assert.deepEqual(job.result.score,{whiteWins:record.wins,blackWins:record.losses,draws:record.draws});
 await bridge({action:'ack',id:job.id,leaseToken:job.leaseToken,status:'sent'});
});
await check('Usman versus Saif announces the real winner without including their games against Nabeel',async()=>{
 let game=await reopened.create(usman.id,'two',5,0);
 game=await reopened.act('two','accept',{gameId:game.id,version:game.version});
 await reopened.act('two','resign',{gameId:game.id,version:game.version});
 const job=(await (await bridge({action:'claim'})).json()).job;
 assert.equal(job.kind,'result');assert.match(job.text,/^Usman (?:gooned on Saif|beat Saif’s ass)/);assert.doesNotMatch(job.text,/Nabeel|Walan|Gud|https?:\/\//);
 const record=(await reopened.room(usman.id)).headToHead.two;
 const wins=job.result.white.id===usman.id?job.result.score.whiteWins:job.result.score.blackWins;
 const losses=job.result.white.id===usman.id?job.result.score.blackWins:job.result.score.whiteWins;
 assert.deepEqual({wins,losses,draws:job.result.score.draws},record);
 assert.match(job.text,new RegExp('Usman '+record.wins+' wins? · Saif '+record.losses+' wins? · '+record.draws+' draws?'));
 await bridge({action:'ack',id:job.id,leaseToken:job.leaseToken,status:'sent'});
});


const {handleSpectator}=require(fileURLToPath(new URL('lib/server/spectator.cjs',build)));
const spectator=(body,cookie='',suffix='',origin='https://rival.test')=>handleSpectator(new Request('https://rival.test/api/spectate'+suffix,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,'cf-connecting-ip':'spectator-test'},...(body?{body:JSON.stringify(body)}:{})}),env);
const spectatorCode='092841',replacementCode='829415';let spectatorCookie,spectatorGame;
const spectatorSalt=sql.prepare('SELECT salt FROM pin_settings WHERE id=1').get().salt;
await check('Spectator access starts disabled and its migration preserves player accounts and records',async()=>{
 assert.equal(sql.prepare('SELECT pin_hash FROM spectator_settings WHERE id=1').get().pin_hash,null);
 assert.equal((await spectator()).status,401);assert.equal((await spectator({action:'login',pin:spectatorCode})).status,503);
 const legacy=new DatabaseSync(':memory:');
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')&&!f.startsWith('0006')).sort())legacy.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 legacy.exec("UPDATE players SET name='Existing Walan',pin_hash='kept-pin' WHERE id='one'; INSERT INTO sessions VALUES ('kept-session','one',9999999999999)");
 const retainedGame=transition(createGame('one','two',5,0),'two','accept',{});
 legacy.prepare('INSERT INTO games(id,active_key,state,version,created_at,finished_at) VALUES (?,1,?,0,?,NULL)').run(retainedGame.id,JSON.stringify(retainedGame),retainedGame.createdAt);
 const tables=legacy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row=>row.name);
 const before=Object.fromEntries(tables.map(table=>[table,legacy.prepare('SELECT * FROM '+table).all()]));
 legacy.exec(readFileSync(new URL('../drizzle/0006_spectator_access.sql',import.meta.url),'utf8'));
 for(const table of tables)assert.deepEqual(legacy.prepare('SELECT * FROM '+table).all(),before[table]);
 legacy.close();
});
await check('Spectator PINs and player PINs cannot collide in either direction',()=>{
 const playerHash=sql.prepare("SELECT pin_hash FROM players WHERE pin_hash IS NOT NULL LIMIT 1").get().pin_hash;
 assert.throws(()=>sql.prepare('UPDATE spectator_settings SET pin_hash=? WHERE id=1').run(playerHash),/conflicts/);
 assert.equal(sql.prepare(spectatorPinUpdate(spectatorCode,spectatorSalt)).get().id,1);
 const hash=sql.prepare('SELECT pin_hash FROM spectator_settings WHERE id=1').get().pin_hash;
 assert.equal(sql.prepare(pinUpdate('one',spectatorCode,spectatorSalt)).get(),undefined);
 assert.throws(()=>sql.prepare("UPDATE players SET pin_hash=? WHERE id='one'").run(hash),/conflicts/);
 assert.throws(()=>sql.prepare("INSERT INTO players(id,name,pin_hash) VALUES ('fake-watcher','Fake',?)").run(hash),/conflicts/);
 assert.throws(()=>spectatorPinUpdate('not-six',spectatorSalt),/6 digits/);
});
await check('Spectator sign-in is origin checked, hashed, rate limited, and isolated from player sessions',async()=>{
 assert.equal((await spectator({action:'login',pin:spectatorCode},'','','https://other.test')).status,403);
 assert.equal((await spectator({action:'login',pin:'000000'})).status,401);
 const before=sql.prepare('SELECT COUNT(*) AS n FROM players').get().n;
 const response=await spectator({action:'login',pin:spectatorCode});assert.equal(response.status,200);
 spectatorCookie=response.headers.get('set-cookie').split(';')[0];assert.match(response.headers.get('set-cookie'),/HttpOnly.*SameSite=Strict.*Secure/);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM players').get().n,before);
 assert.equal(await sessionPlayer(env.DB,new Request('https://rival.test',{headers:{Cookie:spectatorCookie}})),null);
 assert.equal((await get(spectatorCookie)).status,401);assert.equal((await get(spectatorCookie,'?export=all')).status,401);
 assert.equal((await get(spectatorCookie.replace('rr_spectator=','rr_session='))).status,401);
 assert.equal((await spectator(undefined,'rr_spectator='+'0'.repeat(64))).status,401);
 assert.equal((await spectator(undefined,cookieTwo)).status,401);
 sql.exec('DELETE FROM attempts');assert.equal((await POST(request({action:'login',pin:spectatorCode}))).status,401);
 for(let i=0;i<8;i++)await spectator({action:'login',pin:'000000'});
 assert.equal((await spectator({action:'login',pin:spectatorCode})).status,429);sql.exec('DELETE FROM attempts');
});
await check('Spectators can switch live games and follow moves and results without reading credentials or private challenges',async()=>{
 spectatorGame=await reopened.create('one','two',5,0);
 let snapshot=await (await spectator(undefined,spectatorCookie)).json();assert.ok(!snapshot.games.some(game=>game.id===spectatorGame.id));
 assert.equal((await (await spectator(undefined,spectatorCookie,'?game='+spectatorGame.id)).json()).selectedGame,null);
 spectatorGame=await reopened.act('two','accept',{gameId:spectatorGame.id,version:spectatorGame.version});
 sql.exec("INSERT INTO players(id,name) VALUES ('spectator-rival','Other rival')");
 let another=await reopened.create(usman.id,'spectator-rival',3,2);another=await reopened.act('spectator-rival','accept',{gameId:another.id,version:another.version});
 snapshot=await (await spectator(undefined,spectatorCookie,'?game='+spectatorGame.id)).json();
 assert.ok(snapshot.games.some(game=>game.id===spectatorGame.id));assert.ok(snapshot.games.some(game=>game.id===another.id));assert.equal(snapshot.selectedGame.id,spectatorGame.id);
 assert.equal((await (await spectator(undefined,spectatorCookie,'?game='+another.id)).json()).selectedGame.id,another.id);
 assert.doesNotMatch(JSON.stringify(snapshot),/pin_hash|token_hash|spectatorCode|salt|headToHead/);assert.equal(snapshot.recent,undefined);
 spectatorGame=await reopened.act(spectatorGame.white,'move',{gameId:spectatorGame.id,version:spectatorGame.version,from:'e2',to:'e4'});
 assert.equal((await (await spectator(undefined,spectatorCookie,'?game='+spectatorGame.id)).json()).selectedGame.moves[0],'e4');
 const walanLogin=await POST(request({action:'login',pin:'004281'}));assert.equal(walanLogin.status,200);
 const walanCookie=walanLogin.headers.get('set-cookie').split(';')[0];
 for(const cookie of [walanCookie,cookieTwo,cookieUsman]) {
  const response=await get(cookie,'?watch=1');assert.equal(response.status,200);
  const view=await response.json(),viewer=await sessionPlayer(env.DB,new Request('https://rival.test',{headers:{Cookie:cookie}}));
  assert.ok(view.games.length);assert.ok(view.games.every(item=>item.white!==viewer&&item.black!==viewer));
  assert.doesNotMatch(JSON.stringify(view),/pin_hash|token_hash|salt|headToHead/);assert.equal(view.recent,undefined);
 }
 const playerWatch=await (await get(cookieUsman,'?watch=1&game='+spectatorGame.id)).json();assert.equal(playerWatch.selectedGame.moves[0],'e4');
 assert.equal((await (await get(cookieTwo,'?watch=1&game='+spectatorGame.id)).json()).selectedGame,null);
 for(const action of ['move','resign','offerDraw','cancel'])assert.equal((await POST(request({action,gameId:spectatorGame.id,version:spectatorGame.version,from:'e7',to:'e5'},cookieUsman))).status,403,'watching grants no player control');
 assert.equal((await get('','?watch=1')).status,401);assert.equal((await get(spectatorCookie,'?watch=1')).status,401);
 assert.equal((await get(cookieUsman,'?watch=1&game='+ 'x'.repeat(65))).status,400);
 await reopened.act(usman.id,'resign',{gameId:another.id,version:another.version});
});
await check('Spectator cookies cannot challenge, rename, move, resign, draw, or send notification commands',async()=>{
 const before=(await reopened.get(spectatorGame.id));
 const accounts=sql.prepare('SELECT * FROM players ORDER BY id').all();
 for(const action of ['create','rename','move','accept','cancel','resign','offerDraw','acceptDraw','declineDraw']){
  const body={action,gameId:before.id,version:before.version,from:'e7',to:'e5',rival:'two',minutes:5,increment:0,name:'Imposter'};
  assert.equal((await spectator(body,spectatorCookie)).status,403,action);
  assert.equal((await POST(request(body,spectatorCookie))).status,401,action);
 }
 assert.deepEqual(await reopened.get(before.id),before);assert.deepEqual(sql.prepare('SELECT * FROM players ORDER BY id').all(),accounts);
 assert.equal((await handleBridge(new Request('https://rival.test/api/imessage',{method:'POST',headers:{'Content-Type':'application/json',Cookie:spectatorCookie},body:JSON.stringify({action:'claim'})}),env)).status,401);
 spectatorGame=await reopened.act('one','resign',{gameId:before.id,version:before.version});
 const snapshot=await (await spectator(undefined,spectatorCookie,'?game='+before.id)).json();assert.equal(snapshot.selectedGame.status,'finished');assert.ok(!snapshot.games.some(game=>game.id===before.id));
});
await check('Rotating or disabling spectator access revokes viewers only; logout and expiry also lock the view',async()=>{
 const players=sql.prepare('SELECT * FROM players ORDER BY id').all(),sessions=sql.prepare('SELECT * FROM sessions ORDER BY token_hash').all(),games=sql.prepare('SELECT * FROM games ORDER BY id').all();
 sql.prepare(spectatorPinUpdate(spectatorCode,spectatorSalt)).get();assert.equal((await spectator(undefined,spectatorCookie)).status,200);
 sql.prepare(spectatorPinUpdate(replacementCode,spectatorSalt)).get();assert.equal((await spectator(undefined,spectatorCookie)).status,401);
 assert.equal((await spectator({action:'login',pin:spectatorCode})).status,401);
 const login=await spectator({action:'login',pin:replacementCode});spectatorCookie=login.headers.get('set-cookie').split(';')[0];
 sql.close();env.DB=connect();assert.equal((await spectator(undefined,spectatorCookie)).status,200);
 const logout=await spectator({action:'logout'},spectatorCookie);assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);assert.equal((await spectator(undefined,spectatorCookie)).status,401);
 const expiring=await spectator({action:'login',pin:replacementCode});const expiryCookie=expiring.headers.get('set-cookie').split(';')[0];sql.exec('UPDATE spectator_sessions SET expires=0');assert.equal((await spectator(undefined,expiryCookie)).status,401);
 const finalLogin=await spectator({action:'login',pin:replacementCode});const finalCookie=finalLogin.headers.get('set-cookie').split(';')[0];sql.exec('UPDATE spectator_settings SET pin_hash=NULL WHERE id=1');assert.equal((await spectator(undefined,finalCookie)).status,401);
 assert.deepEqual(sql.prepare('SELECT * FROM players ORDER BY id').all(),players);assert.deepEqual(sql.prepare('SELECT * FROM sessions ORDER BY token_hash').all(),sessions);assert.deepEqual(sql.prepare('SELECT * FROM games ORDER BY id').all(),games);
});
await check('Player watch works without spectator access, retains finished results, and respects logout',async()=>{
 const response=await get(cookieUsman,'?watch=1&game='+spectatorGame.id);assert.equal(response.status,200);
 const view=await response.json();assert.equal(view.selectedGame.status,'finished');assert.ok(!view.games.some(game=>game.id===spectatorGame.id));
 const pending=await reopened.create('one','two',5,0);
 assert.equal((await (await get(cookieUsman,'?watch=1&game='+pending.id)).json()).selectedGame,null);
 await reopened.act('one','cancel',{gameId:pending.id,version:pending.version});
 sql.exec('DELETE FROM attempts');
 const login=await POST(request({action:'login',pin:'583920'}));assert.equal(login.status,200);
 const temporary=login.headers.get('set-cookie').split(';')[0];assert.equal((await get(temporary,'?watch=1')).status,200);
 await POST(request({action:'logout'},temporary));assert.equal((await get(temporary,'?watch=1')).status,401);
 assert.equal((await get(cookieUsman,'?watch=1')).status,200);
});
const clubStore=new Store(env.DB);
let clubCookie;
await check('Club migration preserves existing accounts, PINs, records, sessions and occupied games',()=>{
 const legacy=new DatabaseSync(':memory:');legacy.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')&&!f.startsWith('0007')).sort())legacy.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 legacy.exec("INSERT INTO sessions VALUES('retained','one',9999999999999)");
 const old=transition(createGame('one','two',5,0),'two','accept',{});legacy.prepare('INSERT INTO games VALUES(?,1,?,0,?,NULL)').run(old.id,JSON.stringify(old),old.createdAt);
 const tables=['players','sessions','games','game_seats','pin_settings','spectator_settings'];const retained=tables.map(t=>legacy.prepare('SELECT * FROM '+t).all());
 legacy.exec(readFileSync(new URL('../drizzle/0007_club_expansion.sql',import.meta.url),'utf8'));
 tables.forEach((t,i)=>assert.deepEqual(legacy.prepare('SELECT * FROM '+t).all(),retained[i]));legacy.close();
});
await check('Visible-session presence is private, expires, and cannot be forged for another player',async()=>{
 sql.exec('DELETE FROM attempts');const login=await POST(request({action:'login',pin:'004281'}));clubCookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await POST(request({action:'presence',player:'two'},clubCookie))).status,200);
 let roster=(await clubStore.club()).players;assert.equal(roster.find(p=>p.id==='one').presence,'online');assert.equal(roster.find(p=>p.id==='two').presence,'offline');
 sql.exec('UPDATE player_presence SET last_seen=last_seen-60000');assert.equal((await clubStore.roster()).find(p=>p.id==='one').presence,'away');
 sql.exec('UPDATE player_presence SET last_seen=last_seen-180000');assert.equal((await clubStore.roster()).find(p=>p.id==='one').presence,'offline');
 assert.equal((await POST(request({action:'presence'}))).status,401);assert.equal((await get('','?club=1')).status,401);
 const response=await get(clubCookie,'?club=1');assert.equal(response.status,200);assert.doesNotMatch(JSON.stringify(await response.json()),/pin_hash|token_hash|lastSeen|solution/);
});
let seriesGame,seriesState;
const seriesBody=s=>({seriesId:s.id,seriesVersion:s.version});
const turn=async(player,action,extra={})=>{seriesGame=await clubStore.act(player,action,{gameId:seriesGame.id,version:seriesGame.version,...extra});return seriesGame;};
await check('Best-of series creation is atomic, reserves both players, and rejects overlapping games',async()=>{
 const attempts=await Promise.allSettled([clubStore.create('one','two',5,2,3),clubStore.create('one',usman.id,3,0,5)]);
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);seriesGame=attempts.find(r=>r.status==='fulfilled').value;
 seriesState=await clubStore.seriesFor('one');assert.equal(seriesState.version,1);assert.equal(seriesGame.seriesRound,1);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM series').get().n,1);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM series_seats').get().n,2);
 await assert.rejects(clubStore.create('one',usman.id,5,0));await assert.rejects(clubStore.create(usman.id,'two',5,0));
 await assert.rejects(clubStore.seriesAction(usman.id,'endSeries',seriesBody(seriesState)),/not found/);
 await assert.rejects(clubStore.seriesAction('one','nextRound',seriesBody(seriesState)),/current game/);
});
await check('Draws replay the round, colors alternate, and simultaneous next-round requests save once',async()=>{
 const initialWhite=seriesGame.white;
 await turn('two','accept');seriesState=await clubStore.seriesFor('one');await assert.rejects(clubStore.seriesAction('one','endSeries',seriesBody(seriesState)),/active game/);
 await turn('one','offerDraw');await turn('two','acceptDraw');seriesState=await clubStore.seriesFor('one');assert.equal(seriesState.draws,1);assert.equal(seriesState.oneWins,0);
 const attempts=await Promise.allSettled([clubStore.seriesAction('one','nextRound',seriesBody(seriesState)),clubStore.seriesAction('two','nextRound',seriesBody(seriesState))]);
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);seriesGame=attempts.find(r=>r.status==='fulfilled').value;assert.notEqual(seriesGame.white,initialWhite);assert.equal(seriesGame.seriesRound,1);
 await assert.rejects(clubStore.seriesAction('one','endSeries',seriesBody(seriesState)),/changed/);
});
await check('Series results count once, survive reconnect, and release seats after the deciding win',async()=>{
 const before=(await clubStore.room('one')).headToHead.two.wins;
 for(let i=0;i<2;i++){
  await turn(seriesGame.challenger==='one'?'two':'one','accept');const version=seriesGame.version;
  const attempts=await Promise.allSettled([turn('two','resign'),clubStore.act('two','resign',{gameId:seriesGame.id,version})]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
  seriesState=await clubStore.seriesFor('one',seriesGame);assert.equal(seriesState.oneWins,i+1);
  if(i===0){assert.equal(seriesState.status,'active');assert.equal((await new Store(env.DB).room('two')).series.oneWins,1);seriesGame=await clubStore.seriesAction('one','nextRound',seriesBody(seriesState));assert.equal(seriesGame.seriesRound,2);}
 }
 assert.equal(seriesState.status,'finished');assert.equal(seriesState.winner,'one');assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM series_seats').get().n,0);
 assert.equal((await clubStore.room('one')).headToHead.two.wins,before+2);
 await assert.rejects(clubStore.seriesAction('one','nextRound',seriesBody(seriesState)));
});
await check('Best-of-five needs three wins; ending between rounds retains scores and cancels waiting round',async()=>{
 seriesGame=await clubStore.create('one','two',1,0,5);await turn('two','accept');await turn('one','resign');seriesState=await clubStore.seriesFor('one');assert.equal(seriesState.twoWins,1);assert.equal(seriesState.status,'active');
 seriesGame=await clubStore.seriesAction('two','nextRound',seriesBody(seriesState));seriesState=await clubStore.seriesFor('one');const savedWins=(await clubStore.room('two')).stats.two.wins;
 await clubStore.seriesAction('one','endSeries',seriesBody(seriesState));assert.equal((await clubStore.get(seriesGame.id)).status,'cancelled');assert.equal((await clubStore.room('two')).stats.two.wins,savedWins);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM series_seats').get().n,0);
 seriesGame=await clubStore.create('one','two',1,0,5);await turn('two','cancel');assert.equal((await clubStore.room('one')).series.status,'cancelled');
});
await check('Best-of-five remains open at two wins and ends exactly at three',async()=>{
 seriesGame=await clubStore.create('one','two',5,0,5);
 for(let wins=1;wins<=3;wins++){
  await turn(seriesGame.challenger==='one'?'two':'one','accept');await turn('two','resign');seriesState=await clubStore.seriesFor('one',seriesGame);
  assert.equal(seriesState.oneWins,wins);assert.equal(seriesState.status,wins===3?'finished':'active');
  if(wins<3)seriesGame=await clubStore.seriesAction('two','nextRound',seriesBody(seriesState));
 }
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM series_seats').get().n,0);
});
const {leaderboard,presenceStatus}=require(fileURLToPath(new URL('lib/club.cjs',build)));
await check('Leaderboards count only finished matches, break streaks on draws, and keep rival records separate',async()=>{
 const players=[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}];
 const outcomes=[['a','b','a'],['a','b','a'],['a','b',null],['a','c','c'],['a','b','a']].map(([white,black,winner],i)=>({id:String(i),white,black,winner,finishedAt:i}));
 const a=leaderboard(players,outcomes).find(p=>p.id==='a');assert.deepEqual([a.wins,a.losses,a.draws,a.streak,a.bestStreak,a.mainRival,a.winRate],[3,1,1,1,2,'b',60]);assert.deepEqual(a.rivalry,{wins:3,losses:0,draws:1});
 const actual=await clubStore.club();for(const leader of actual.leaders){const room=await clubStore.room(leader.id);assert.deepEqual({wins:leader.wins,losses:leader.losses,draws:leader.draws},room.stats[leader.id]);}
 assert.equal(presenceStatus(null,1000),'offline');assert.equal(presenceStatus(0,45000),'away');assert.equal(presenceStatus(0,180000),'offline');
});
let practiceGame,puzzleId;
await check('Practice imports only legal alternatives to your own moves in finished games and never trusts a client FEN',async()=>{
 practiceGame=await clubStore.create('one','two',5,0);practiceGame=await clubStore.act('two','accept',{gameId:practiceGame.id,version:0});
 const white=practiceGame.white,whiteCookie=white==='one'?clubCookie:cookieTwo;
 practiceGame=await clubStore.act(white,'move',{gameId:practiceGame.id,version:practiceGame.version,from:'f2',to:'f3'});
 const payload={action:'practiceSave',gameId:practiceGame.id,items:[{ply:0,solution:'e2e4',loss:150,depth:12,fen:'untrusted'}]};
 assert.equal((await POST(request(payload,whiteCookie))).status,409);
 practiceGame=await clubStore.act(white,'resign',{gameId:practiceGame.id,version:practiceGame.version});
 assert.equal((await POST(request(payload,white==='one'?cookieTwo:clubCookie))).status,403);
 assert.equal((await POST(request({...payload,items:[{...payload.items[0],solution:'e2e5'}]},whiteCookie))).status,400);
 assert.equal((await POST(request(payload,whiteCookie))).status,200);assert.equal((await POST(request(payload,whiteCookie))).status,200);
 const data=await (await get(whiteCookie,'?practice=1')).json();assert.equal(data.puzzles.length,1);puzzleId=data.puzzles[0].id;assert.equal(data.puzzles[0].fen,new (require('chess.js').Chess)().fen());assert.equal(data.puzzles[0].solution,undefined);
 const wrong=await POST(request({action:'practiceAttempt',id:puzzleId,move:'d2d4'},whiteCookie));assert.equal((await wrong.json()).correct,false);
 const right=await POST(request({action:'practiceAttempt',id:puzzleId,move:'e2e4'},whiteCookie));assert.equal((await right.json()).correct,true);
 assert.equal((await POST(request({action:'practiceReveal',id:puzzleId},white==='one'?cookieTwo:clubCookie))).status,404);
 const solved=(await (await get(whiteCookie,'?practice=1')).json()).puzzles[0];assert.equal(solved.attempts,2);assert.ok(solved.solvedAt);
 const before=JSON.stringify((await clubStore.room(white)).stats);
 await POST(request(payload,whiteCookie));assert.equal((await (await get(whiteCookie,'?practice=1')).json()).puzzles[0].solvedAt,solved.solvedAt);
 assert.equal(JSON.stringify((await clubStore.room(white)).stats),before);
 const backup=await (await get(whiteCookie,'?export=all')).json();assert.ok(backup.practicePuzzles.some(p=>p.id===puzzleId&&p.solution==='e2e4'));assert.ok(backup.seriesHistory.length>0);
});
await check('Anonymous and spectator sessions cannot use new presence, series, leaderboard, or practice endpoints',async()=>{
 for(const suffix of ['?club=1','?practice=1']){assert.equal((await get('',suffix)).status,401);assert.equal((await get(spectatorCookie,suffix)).status,401);}
 for(const action of ['presence','nextRound','endSeries','practiceSave','practiceAttempt','practiceReveal'])assert.equal((await POST(request({action,id:puzzleId},spectatorCookie))).status,401);
});

sql.close();console.log(`\n${passed} integration checks passed.`);
