import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
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
  const statements=readFileSync(root+'drizzle/'+f,'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
  await db.batch(statements.map(s=>db.prepare(s)));
 }
 const origin=(await mf.ready).origin;
 const post=(body,cookie='')=>mf.dispatchFetch(origin+'/api/room',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
 const login=async pin=>{const r=await post({action:'login',pin});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]};
 const one=await login('19462850'),two=await login('60392714');
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
 pa=message(a);pb=message(b);
 const moved=await post({action:'move',gameId:g.id,version:g.version,from:'e2',to:'e4',compact:true},one);g=(await moved.json()).game;
 assert.equal((await pb).game.moves[0],'e4');await pa;
 const snapshot=await mf.dispatchFetch(origin+'/api/room?live=1',{headers:{Cookie:two}});const snapshotBody=await snapshot.json();assert.equal(snapshotBody.game.version,g.version);assert.equal(snapshotBody.recent,undefined);
 const revoked=message(a);
 assert.equal((await post({action:'logout'},one)).status,200);pb=message(b);
 await post({action:'resign',gameId:g.id,version:g.version,compact:true},two);
 assert.equal((await pb).game.status,'finished');assert.equal((await revoked).type,'locked');a.close();
 assert.equal((await mf.dispatchFetch(origin+'/api/room?live=1',{headers:{Cookie:one}})).status,401);
 console.log('PASS Real Workers runtime: authenticated WebSockets, origin isolation, challenge/move delivery, compact snapshots and session revocation');
} finally { for(const ws of sockets)try{ws.close()}catch{};await mf.dispose(); }
