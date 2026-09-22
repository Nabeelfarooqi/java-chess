import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { unstable_splitSqlQuery as splitSqlQuery } from 'wrangler';
const wranglerRequire = createRequire(realpathSync(new URL('../node_modules/wrangler/package.json', import.meta.url)));
const { Miniflare } = wranglerRequire('miniflare');
const { build } = wranglerRequire('esbuild');
const NodeWebSocket = createRequire(wranglerRequire.resolve('miniflare'))('ws');
const root = fileURLToPath(new URL('../', import.meta.url));
mkdirSync(root + '.test-build', { recursive: true });
await build({entryPoints:[root+'worker.ts'],outfile:root+'.test-build/realtime.mjs',bundle:true,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:workers'],plugins:[{name:'framework-stub',setup(b){b.onResolve({filter:/^vinext\/server\/fetch-handler$/},()=>({path:'framework',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export default {fetch(){return new Response("Not found",{status:404})}}',loader:'js'}));}}]});
const hash = pin => 'test-salt:' + pbkdf2Sync(pin,'test-salt',100000,32,'sha256').toString('hex');
const mf = new Miniflare({modules:true,scriptPath:root+'.test-build/realtime.mjs',compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'live-test'},durableObjects:{LIVE_PLAYERS:{className:'PlayerLive',useSQLite:true}},bindings:{PIN_ONE_HASH:hash('19462850'),PIN_TWO_HASH:hash('60392714')},unsafeEvalBinding:undefined});
const sockets=[];
try {
 const db=await mf.getD1Database('DB');
 for(const f of readdirSync(root+'drizzle').filter(f=>f.endsWith('.sql')).sort()){
  const statements=splitSqlQuery(readFileSync(root+'drizzle/'+f,'utf8'));
  await db.batch(statements.map(s=>db.prepare(s)));
 }
 const origin=(await mf.ready).origin;
 const post=(body,cookie='')=>mf.dispatchFetch(origin+'/api/room',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
 const login=async pin=>{const r=await post({action:'login',pin});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]};
 const one=await login('19462850'),two=await login('60392714');
 const settings=await db.prepare('SELECT salt FROM pin_settings WHERE id=1').first();
 const spectatorHash=pbkdf2Sync('092841',settings.salt,100000,32,'sha256').toString('hex');
 await db.prepare('UPDATE spectator_settings SET pin_hash=? WHERE id=1').bind(spectatorHash).run();
 const spectatorLogin=await mf.dispatchFetch(origin+'/api/spectate',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'login',pin:'092841'})});
 assert.equal(spectatorLogin.status,200);const watcher=spectatorLogin.headers.get('set-cookie').split(';')[0];
 assert.equal((await mf.dispatchFetch(origin+'/api/spectate',{headers:{Cookie:watcher}})).status,200);
 for(const cookie of [watcher,watcher.replace('rr_spectator=','rr_session=')]){
  assert.equal((await mf.dispatchFetch(origin+'/api/live',{headers:{Upgrade:'websocket',Origin:origin,Cookie:cookie,'x-player-id':'one'}})).status,401);
  assert.equal((await post({action:'create',rival:'two',minutes:5,increment:0},cookie)).status,401);
 }

 assert.equal((await mf.dispatchFetch(origin+'/api/live',{headers:{Upgrade:'websocket',Origin:origin}})).status,401);
 assert.equal((await mf.dispatchFetch(origin+'/api/live',{headers:{Upgrade:'websocket',Origin:'https://other.test',Cookie:one}})).status,403);
 async function connect(cookie){const ws=new NodeWebSocket(origin.replace('http:','ws:')+'/api/live',{headers:{Origin:origin,Cookie:cookie,'x-player-id':'forged'}});await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});sockets.push(ws);return ws;}
 const a=await connect(one),b=await connect(two);
 const message=ws=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('No live update')),10000);ws.addEventListener('message',function listen(e){if(e.data==='pong')return;clearTimeout(timer);ws.removeEventListener('message',listen);resolve(JSON.parse(e.data));});});
 let pa=message(a),pb=message(b);
 const challenge=await post({action:'create',rival:'two',minutes:5,increment:0,compact:true},one);assert.equal(challenge.status,200);let body=await challenge.json();let g=body.game;
 assert.equal(body.stats,undefined);assert.equal((await pa).game.id,g.id);assert.equal((await pb).game.id,g.id);
 pa=message(a);pb=message(b);
 const accepted=await post({action:'accept',gameId:g.id,version:g.version,compact:true},two);g=(await accepted.json()).game;
 assert.equal((await pa).game.status,'active');await pb;
 const watched=await mf.dispatchFetch(origin+'/api/spectate?game='+g.id,{headers:{Cookie:watcher}});
 assert.equal((await watched.json()).selectedGame.id,g.id);
 await db.prepare('UPDATE spectator_settings SET pin_hash=NULL WHERE id=1').run();
 assert.equal((await mf.dispatchFetch(origin+'/api/spectate',{headers:{Cookie:watcher}})).status,401);

 pa=message(a);pb=message(b);
 const moved=await post({action:'move',gameId:g.id,version:g.version,from:'e2',to:'e4',compact:true,moveId:'11111111-2222-3333-4444-555555555555'},one);g=(await moved.json()).game;
 assert.equal((await pb).game.moves[0],'e4');await pa;
 const receiptPromise=message(a);
 b.send(JSON.stringify({type:'seen',gameId:'wrong-game',version:g.version,moveId:g.delivery.id}));
 b.send(JSON.stringify({type:'seen',gameId:g.id,version:g.version,moveId:g.delivery.id}));
 const receipt=await receiptPromise;assert.equal(receipt.type,'receipt');assert.equal(receipt.actor,'one');assert.equal(receipt.moveId,g.delivery.id);assert.equal(receipt.gameId,g.id);
 const duplicate=[];const collect=data=>{if(data.toString()!=='pong')duplicate.push(JSON.parse(data.toString()));};a.on('message',collect);
 b.send(JSON.stringify({type:'seen',gameId:g.id,version:g.version,moveId:g.delivery.id}));
 await new Promise(resolve=>setTimeout(resolve,150));a.off('message',collect);assert.equal(duplicate.length,0);
 assert.equal((await post({action:'presence'},two)).status,200);
 const club=await mf.dispatchFetch(origin+'/api/room?club=1',{headers:{Cookie:two}});assert.equal((await club.json()).players.find(p=>p.id==='two').presence,'online');
 const snapshot=await mf.dispatchFetch(origin+'/api/room?live=1',{headers:{Cookie:two}});const snapshotBody=await snapshot.json();assert.equal(snapshotBody.game.version,g.version);assert.equal(snapshotBody.recent,undefined);
 const revoked=message(a);
 assert.equal((await post({action:'logout'},one)).status,200);pb=message(b);
 await post({action:'resign',gameId:g.id,version:g.version,compact:true},two);
 assert.equal((await pb).game.status,'finished');assert.equal((await revoked).type,'locked');a.close();
 assert.equal((await mf.dispatchFetch(origin+'/api/room?live=1',{headers:{Cookie:one}})).status,401);
 const fresh=await login('19462850');
 const seriesResponse=await post({action:'create',rival:'two',minutes:3,increment:2,bestOf:3},fresh);assert.equal(seriesResponse.status,200);
 const seriesRoom=await seriesResponse.json();assert.equal(seriesRoom.series.bestOf,3);assert.equal(seriesRoom.series.version,1);assert.equal(seriesRoom.game.seriesRound,1);
 const cancelled=await post({action:'cancel',gameId:seriesRoom.game.id,version:0},two);assert.equal((await cancelled.json()).series.status,'cancelled');
 console.log('PASS Real Workers runtime: authenticated WebSockets, origin isolation, challenge/move delivery, compact snapshots, display receipts with replay protection, presence, atomic series, spectator isolation and session revocation');
} finally { for(const ws of sockets)try{ws.close()}catch{};await mf.dispose(); }
