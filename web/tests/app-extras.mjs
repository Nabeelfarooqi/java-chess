import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import sharp from 'sharp';
const require=createRequire(import.meta.url);
const {gameSound}=require('../.test-build/lib/sounds.cjs');
const {createGame,transition}=require('../.test-build/lib/game.cjs');
let game=transition(createGame('one','two',5,0),'two','accept',{});game.version=1;
assert.equal(gameSound(null,game),null);assert.equal(gameSound(game,game),null);
function move(from,to){const before=game;game=transition(game,game.fen.split(' ')[1]==='w'?'one':'two','move',{from,to});game.version=before.version+1;return gameSound(before,game);}
assert.equal(move('e2','e4'),'move');assert.equal(move('d7','d5'),'move');assert.equal(move('e4','d5'),'capture');
assert.equal(gameSound(game,{...game,id:'different',version:10}),null);
assert.equal(gameSound(game,{...game,version:game.version+1,status:'finished'}),'end');
assert.equal(gameSound(game,{...game,version:game.version+3,moves:[...game.moves,'a','b']}),null);
console.log('PASS Sound events: first load, duplicate versions, new games, reconnect jumps, moves, captures and game end');
const handlers={},cache=new Map(),deleted=[];
const storage={open:async()=>({addAll:async urls=>urls.forEach(url=>cache.set(url,new Response('offline')))}),keys:async()=>['rival-offline-old','unrelated'],delete:async key=>deleted.push(key),match:async key=>cache.get(key)};
let online=true;
runInNewContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),{self:{location:{origin:'https://rival.test'},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{}}},URL,Response,caches:storage,fetch:async()=>{if(!online)throw Error('offline');return new Response('network');}});
async function event(name,request){let promise;handlers[name]({request,waitUntil:p=>promise=p,respondWith:p=>promise=p});return promise?await promise:null;}
await event('install');await event('activate');assert.deepEqual(deleted,['rival-offline-old']);
assert.equal(await event('fetch',{url:'https://rival.test/api/room',method:'GET',mode:'cors'}),null);
assert.equal(await event('fetch',{url:'https://rival.test/api/room',method:'POST',mode:'cors'}),null);
assert.equal(await event('fetch',{url:'https://other.test/',method:'GET',mode:'navigate'}),null);
const request={url:'https://rival.test/',method:'GET',mode:'navigate'};
assert.equal(await (await event('fetch',request)).text(),'network');assert.equal(cache.has('/'),false);
online=false;assert.equal(await (await event('fetch',request)).text(),'offline');assert.equal(cache.has('/api/room'),false);
assert.deepEqual([...cache.keys()].sort(),['/app-icons/180.png','/app-icons/192.png','/app-icons/512.png','/manifest.json','/offline.html'].sort());
const {prepareAppIcons}=await import('../scripts/prepare-app-icons.mjs');await prepareAppIcons();
const manifest=JSON.parse(readFileSync(new URL('../public/manifest.json',import.meta.url)));assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'/');
for(const icon of manifest.icons){const size=Number(icon.sizes.split('x')[0]),meta=await sharp(fileURLToPath(new URL('../public'+icon.src,import.meta.url))).metadata();assert.equal(meta.width,size);assert.equal(meta.height,size);}
console.log('PASS Install/offline behavior: valid generated icons, public-only cache, live network APIs and no stored authenticated pages');
