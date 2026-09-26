import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {MemePool,outcomePool} from '../scripts/meme-pool.mjs';
import { BlueBubbles, localBlueBubblesUrl } from '../scripts/bluebubbles-client.mjs';
import { chatKind, chatCounts, chatDiagnostics, chatLabel, filterChats } from '../scripts/imessage-chat-list.mjs';
import { groupActivityReport } from '../scripts/imessage-group-activity.mjs';
import { Journal, deliver, privateJson, cloudBridge } from '../scripts/imessage-core.mjs';
import { connectSavedBridge } from '../scripts/imessage-connect.mjs';
import { winnerCard } from '../scripts/winner-card.mjs';
import { findPlayer } from '../scripts/cloudflare-admin.mjs';
const directory=mkdtempSync(join(tmpdir(),'rival-imessage-'));
const config={site:'https://chess.test',targets:{gud:'iMessage;-;gud-test'},groupChatGuid:'iMessage;+;test-group'};
const result={white:{id:'one',name:'Walan',character:'walan'},black:{id:'gud',name:'Gud',character:'gud'},winnerId:'gud',time:'5+0',reason:'Checkmate',score:{whiteWins:3,blackWins:4,draws:1}};
const job={id:'game:result',kind:'result',gameId:'game',leaseToken:'lease',attempts:1,text:'Gud beat Walan',result};
let passed=0;async function check(name,fn){await fn();console.log('PASS '+name);passed++;}
try {
 await check('Reconnect keeps saved destinations and token, waits through temporary 401 responses, then enables notifications',async()=>{
  const saved={...config,bridgeToken:'c'.repeat(64)},before=JSON.stringify(saved),calls=[],hashes=[],delays=[],logs=[];
  let enabled=0,checks=0;
  const post=cloudBridge(saved,async(url,options)=>{
   assert.equal(url,config.site+'/api/imessage');assert.equal(options.headers.Authorization,'Bearer '+saved.bridgeToken);
   assert.deepEqual(JSON.parse(options.body),{action:'status'});calls.push('status');checks++;
   return checks<=3?Response.json({error:'unauthorized'},{status:401}):Response.json({settings:{enabled},jobs:[]});
  });
  const result=await connectSavedBridge(saved,{post,installHash:async hash=>{calls.push('install');hashes.push(hash)},enableNotifications:async()=>{calls.push('enable');enabled=1},pause:async ms=>delays.push(ms),progress:text=>logs.push(text)});
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(saved.bridgeToken));
  assert.deepEqual(hashes,[Buffer.from(digest).toString('hex')]);
  assert.deepEqual(calls,['status','install','status','status','status','enable','status']);
  assert.deepEqual(delays,[2000,3000]);assert.equal(result.settings.enabled,1);assert.equal(JSON.stringify(saved),before);
  assert.ok(!logs.join('').includes(saved.bridgeToken));assert.ok(!logs.join('').includes(hashes[0]));
 });
 await check('Persistent bridge rejection and secret upload failures never enable notifications or discard saved selections',async()=>{
  const saved={...config,bridgeToken:'c'.repeat(64)},before=JSON.stringify(saved);let installs=0,enables=0,checks=0,waited=0;
  const unauthorized=cloudBridge(saved,async()=>{checks++;return Response.json({}, {status:401})});
  await assert.rejects(connectSavedBridge(saved,{post:unauthorized,installHash:async()=>installs++,enableNotifications:async()=>enables++,pause:async ms=>{waited+=ms}}),/still returns HTTP 401.*saved destinations are retained/);
  assert.equal(installs,1);assert.equal(enables,0);assert.equal(checks,7);assert.equal(waited,30000);assert.equal(JSON.stringify(saved),before);
  await assert.rejects(connectSavedBridge(saved,{post:unauthorized,installHash:async()=>{throw Error('upload failed')},enableNotifications:async()=>enables++}),/upload failed/);assert.equal(enables,0);
 });
 await check('A valid saved connection resumes without uploading a new secret; malformed status and invalid config stay blocked',async()=>{
  const saved={...config,bridgeToken:'c'.repeat(64)};let enables=0;
  const fail=async()=>{throw Error('must not install a secret')};
  const post=async()=>({settings:{enabled:enables?1:0},jobs:[]});
  await connectSavedBridge(saved,{post,installHash:fail,enableNotifications:async()=>enables++});assert.equal(enables,1);
  await assert.rejects(connectSavedBridge(saved,{post:async()=>({ok:true}),installHash:fail,enableNotifications:async()=>enables++}),/valid chess bridge status/);assert.equal(enables,1);
  await assert.rejects(connectSavedBridge({...saved,bridgeToken:'bad'},{post:fail,installHash:fail,enableNotifications:fail}),/token is invalid/);
  await assert.rejects(connectSavedBridge({...saved,groupChatGuid:'any;-;private'},{post:fail,installHash:fail,enableNotifications:fail}),/destinations are invalid/);
  await assert.rejects(connectSavedBridge(saved,{post:async()=>({settings:{enabled:0},jobs:[]}),installHash:fail,enableNotifications:async()=>{}}),/database still reports notifications disabled/);
 });
 await check('Duplicate-group activity reads only the latest entry per exact group and never sends, merges, or exposes message content',async()=>{
  const timestamp=Date.UTC(2026,8,22,3,0),calls=[];
  const bb=new BlueBubbles('http://127.0.0.1:1234','test-password',async(url,options)=>{
   calls.push({url,options});
   if(calls.length===3) return Response.json({status:500},{status:500});
   return Response.json({status:200,data:calls.length===1?[{dateCreated:timestamp,text:'private body',handle:{address:'private@example.test'},guid:'private-message-id'}]:[]});
  });
  const groups=[{guid:'any;+;group#1',displayName:'FRQ',originalROWID:765,style:43,participants:[{address:'private@example.test'}]},{guid:'any;+;group/2',displayName:'FRQ',originalROWID:762,style:43},{guid:'any;+;group3',displayName:'FRQ',originalROWID:728,style:43},{guid:'any;-;direct-address',displayName:'FRQ',style:45}];
  const report=await groupActivityReport(groups,bb);
  assert.equal(calls.length,3);
  assert.deepEqual(calls.map(c=>decodeURIComponent(c.url.pathname)),groups.slice(0,3).map(g=>'/api/v1/chat/'+g.guid+'/message'));
  for(const {url,options} of calls){assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(url.searchParams.get('limit'),'1');assert.equal(url.searchParams.get('sort'),'DESC');}
  assert.match(report,/Chat ID 765 \| FRQ/);assert.match(report,/Chat ID 762 \| FRQ.*No stored messages/);assert.match(report,/Chat ID 728 \| FRQ.*Lookup failed/);
  assert.ok(report.includes(new Date(timestamp).toLocaleString()));
  for(const secret of ['private body','private@example.test','private-message-id','test-password','group#1','direct-address']) assert.ok(!report.includes(secret));
  assert.match(await groupActivityReport([],bb),/No matching/);assert.equal(calls.length,3);
 });
 await check('Unreadable activity timestamps remain errors instead of looking like current or empty chats',async()=>{
  for(const data of [{},[{dateCreated:null}],[{dateCreated:'not-a-date'}],[{dateCreated:9e20}]]){
   const bb=new BlueBubbles('http://127.0.0.1:1234','test',async()=>Response.json({status:200,data}));
   await assert.rejects(bb.lastActivity('any;+;test'));
  }
 });
 await check('Chat discovery preserves unsupported services and paginates to existing iMessage conversations',async()=>{
  const firstPage=Array.from({length:100},(_,i)=>({guid:`SMS;-;phone-${i}`,participants:[]}));
  const lastPage=[{guid:'iMessage;-;usman@example.test',participants:[{address:'usman@example.test'}]}, {guid:'iMessage;+;private-group-id',displayName:'FRQ',participants:[{},{}]}, {guid:'any;-;private-address'}];
  const calls=[];const bb=new BlueBubbles('http://127.0.0.1:1234','test-only',async(url,options)=>{
   calls.push({path:url.pathname,body:JSON.parse(options.body)});
   return Response.json({status:200,data:calls.length===1?firstPage:lastPage});
  });
  const chats=await bb.chats();
  assert.deepEqual(calls.map(c=>c.path),['/api/v1/chat/query','/api/v1/chat/query']);
  assert.deepEqual(calls.map(c=>c.body.offset),[0,100]);
  assert.deepEqual(chatCounts(chats),{total:103,direct:2,group:1,unsupported:100});
  assert.deepEqual(chats.filter(c=>chatKind(c)==='direct').map(c=>c.guid),['iMessage;-;usman@example.test','any;-;private-address']);
  assert.deepEqual(chats.filter(c=>chatKind(c)==='group').map(c=>c.displayName),['FRQ']);
 });
 await check('Chat diagnostics distinguish empty API results from filtered chats without disclosing addresses or message bodies',()=>{
  const chats=[{guid:'iMessage;-;usman@example.test',style:45,participants:[{address:'usman@example.test'}],lastMessage:{text:'private-message'}},{guid:'iMessage;+;private-group-id',displayName:'FRQ',style:43,participants:[{},{}]},{guid:'any;-;private-address'},{guid:'private-unknown-address'},null];
  const report=chatDiagnostics(chats);
  assert.match(report,/5 chats: 2 selectable direct chats, 1 selectable groups, 2 unsupported/);
  assert.match(report,/FRQ \| group \| participants: 2 \| style: 43/);
  assert.match(report,/any;-;\[hidden\]: 1/);
  for(const secret of ['usman@example.test','private-message','private-group-id','private-address','private-unknown-address']) assert.ok(!report.includes(secret));
  assert.match(chatDiagnostics([]),/API returned an empty list/);
  assert.equal(chatKind(null),'unsupported');assert.equal(chatKind({guid:12}),'unsupported');
 });
 await check('The reported 402 any direct chats and 52 any groups are selectable without confusing groups and DMs',()=>{
  const directs=Array.from({length:402},(_,i)=>({guid:`any;-;contact-${i}`,style:45,participants:[{}]}));
  const groups=Array.from({length:52},(_,i)=>({guid:`any;+;group-${i}`,style:43,participants:Array(10).fill({})}));
  assert.deepEqual(chatCounts([...directs,...groups]),{total:454,direct:402,group:52,unsupported:0});
  assert.equal(chatKind({guid:'any;+;group',style:43,participants:[{}]}),'group');
  for(const chat of [{guid:'any;-;address',style:43},{guid:'any;+;group',style:45},{guid:'any;-;address',participants:[{},{}]},{guid:'SMS;-;address'},{guid:'RCS;+;group'},{guid:'any;-;'},{guid:'any;?;address'},{guid:'any;-;address;extra'},{guid:'any;-;address\n'}]) assert.equal(chatKind(chat),'unsupported');
 });
 await check('Search finds unnamed phone conversations and keeps duplicate FRQ chats distinct for confirmation',()=>{
  const chats=[{guid:'any;-;+15550000111',style:45,participants:[{address:'+1 (555) 000-0111'}]}, {guid:'any;+;first-group',displayName:'FRQ',originalROWID:12,participants:[{address:'one@example.test'},{address:'two@example.test'}]}, {guid:'any;+;second-group',displayName:'FRQ',originalROWID:34,participants:[{address:'one@example.test'},{address:'two@example.test'}]}];
  assert.deepEqual(filterChats(chats,'(555) 000-0111'),[chats[0]]);
  assert.deepEqual(filterChats(chats,'frq'),chats.slice(1));
  assert.deepEqual(filterChats(chats,'Usman'),[]);
  assert.deepEqual(filterChats(chats,''),chats);
  assert.notEqual(chatLabel(chats[1]),chatLabel(chats[2]));
  assert.match(chatLabel(chats[1]),/Chat ID 12/);assert.match(chatLabel(chats[2]),/Chat ID 34/);
 });
 await check('Native any chat IDs survive delivery unchanged; challenge/group type mismatches and explicit SMS stay blocked',async()=>{
  const auto={...config,targets:{gud:'any;-;usman@example.test'},groupChatGuid:'any;+;frq-exact-guid'};
  const calls=[],journal=new Journal(directory,config.site);
  const bb=new BlueBubbles('http://127.0.0.1:1234','test-only',async(url,options)=>{calls.push(JSON.parse(options.body));return Response.json({status:200,data:{guid:'sent'}})});
  const options={bb,post:async()=>{},journal};
  const challenge={...job,id:'auto-challenge',kind:'challenge',recipientId:'gud'};
  assert.equal(await deliver(challenge,auto,options),'sent');
  assert.equal(await deliver({...job,id:'auto-result'},auto,options),'sent');
  assert.deepEqual(calls.map(c=>c.chatGuid),['any;-;usman@example.test','any;+;frq-exact-guid']);
  assert.ok(calls.every(c=>c.method==='apple-script'));
  assert.equal(await deliver({...challenge,id:'auto-wrong-dm'},{...auto,targets:{gud:auto.groupChatGuid}},options),'needs_review');
  assert.equal(await deliver({...job,id:'auto-wrong-group'},{...auto,groupChatGuid:auto.targets.gud},options),'needs_review');
  assert.equal(await deliver({...challenge,id:'sms-dm'},{...auto,targets:{gud:'SMS;-;usman'}},options),'needs_review');
  assert.equal(calls.length,2);
  assert.equal(journal.get('auto-result').chatGuid,'any;+;frq-exact-guid');
 });
 await check('BlueBubbles uses documented local AppleScript text and multipart PNG endpoints',async()=>{
  const calls=[];const bb=new BlueBubbles('http://127.0.0.1:1234','test-password',async(url,options)=>{calls.push({url,options});return Response.json({status:200,data:{guid:'accepted'}})});
  await bb.text(config.targets.gud,'Challenge text','test-guid');await bb.image(config.groupChatGuid,Buffer.from([1,2,3]),'image-guid');
  assert.equal(calls[0].url.pathname,'/api/v1/message/text');assert.equal(calls[0].url.searchParams.get('password'),'test-password');
  assert.equal(JSON.parse(calls[0].options.body).method,'apple-script');assert.equal(JSON.parse(calls[0].options.body).chatGuid,config.targets.gud);
  assert.equal(calls[1].url.pathname,'/api/v1/message/attachment');assert.equal(calls[1].options.body.get('attachment').type,'image/png');assert.equal(calls[1].options.body.get('chatGuid'),config.groupChatGuid);
  assert.throws(()=>localBlueBubblesUrl('http://public.example'),/local BlueBubbles/);
 });
 await check('Winner PNG contains both supplied characters; draw and generic Saif cards also render',async()=>{
  for(const data of [result,{...result,winnerId:null},{...result,black:{id:'two',name:'Saif <test>',character:null},winnerId:'two'}]){
   const png=await winnerCard(data);const metadata=await sharp(png).metadata();assert.equal(metadata.format,'png');assert.equal(metadata.width,1000);assert.equal(metadata.height,630);
  }
  writeFileSync(new URL('../.test-build/winner-card.png',import.meta.url),await winnerCard(result));
 });
 await check('Result delivery sends only text to the selected group and never renders or sends an image',async()=>{
  const journal=new Journal(directory,config.site),calls=[],acks=[];
  const bb={text:async(...args)=>calls.push(['text',...args]),image:async(...args)=>calls.push(['image',...args])};
  assert.equal(await deliver(job,config,{bb,post:async body=>acks.push(body),render:async()=>{throw Error('Images are paused')},journal}),'sent');
  assert.deepEqual(calls.map(c=>c.slice(0,2)),[['text',config.groupChatGuid]]);assert.equal(acks[0].status,'sent');
  await deliver({...job,attempts:2},config,{bb,post:async()=>{},render:async()=>{throw Error('must not render again')},journal});assert.equal(calls.length,1);
  if(process.platform!=='win32')assert.equal(statSync(journal.path(job.id)).mode&0o777,0o600);
 });
 await check('A challenge goes only to its recipient DM, never to the group',async()=>{
  const calls=[];const challenge={...job,id:'challenge',kind:'challenge',recipientId:'gud'};
  await deliver(challenge,config,{bb:{text:async(...args)=>calls.push(args)},post:async()=>{},render:async()=>{throw Error('no image for challenge')},journal:new Journal(directory,config.site)});
  assert.equal(calls.length,1);assert.equal(calls[0][0],config.targets.gud);
 });
 await check('Unknown outcomes pause for review instead of blindly sending duplicate iMessages',async()=>{
  let calls=0;const statuses=[],journal=new Journal(directory,config.site);const uncertain={...job,id:'uncertain'};
  const options={bb:{text:async()=>{calls++;throw Error('network timeout')}},post:async b=>statuses.push(b.status),render:async()=>Buffer.from('png'),journal};
  assert.equal(await deliver(uncertain,config,options),'needs_review');
  assert.equal(await deliver({...uncertain,attempts:2},config,options),'needs_review');assert.equal(calls,1);assert.deepEqual(statuses,['needs_review','needs_review']);
  assert.equal(await deliver({...job,id:'lost-journal',attempts:2},config,options),'needs_review');assert.equal(calls,1);
 });
 await check('Failed group sends preserve useful error categories without exposing credentials, message content, or chat identifiers',async()=>{
  const secret='private-password',address='private@example.test',body='private message body',chat='any;+;private-group';
  const cases=[
   [401,{error:{message:secret}},/HTTP 401.*access was rejected/],
   [500,{error:{message:`Can't get chat ${chat}, ${address}, ${body}, ${secret}. (-1728)`}},/HTTP 500.*selected Messages object \(-1728\)/],
   [500,{error:{message:`Not authorized ${secret} (-1743)`}},/automation permission denied/],
   [500,{error:{message:`Timed out ${secret} (-1712)`}},/AppleScript timed out/],
   [500,{error:{message:`Other error ${secret} (-1700)`}},/AppleScript error -1700/],
   [500,{error:{message:'Failed to send message!'},data:{error:22,text:body,chatGuid:chat}},/Messages send error code 22/],
   [500,{error:{message:'Failed to send message! Message not found in database after 60 seconds!'}},/not confirmed in the Messages database/],
   [200,{status:500,error:{message:secret},data:{text:body}},/HTTP 500.*BlueBubbles Logs/],
  ];
  for(const [index,[status,payload,expected]] of cases.entries()){
   let sends=0;const acks=[],event={...job,id:'diagnostic-'+index};
   const bb=new BlueBubbles('http://127.0.0.1:1234',secret,async()=>{sends++;return Response.json(payload,{status})});
   const options={bb,post:async b=>acks.push(b),journal:new Journal(directory,config.site)};
   assert.equal(await deliver(event,config,options),'needs_review');
   assert.match(acks[0].detail,expected);assert.match(acks[0].detail,/Check Messages before retrying/);
   assert.ok(acks[0].detail.length<=160);
   for(const privateValue of [secret,address,body,chat]) assert.ok(!JSON.stringify(acks).includes(privateValue));
   assert.equal(await deliver({...event,attempts:2},config,options),'needs_review');assert.equal(sends,1);
  }
 });
 await check('Transport timeouts and unreadable responses stay unconfirmed with redacted diagnostics',async()=>{
  const cases=[
   [async()=>{throw new DOMException('secret-url','TimeoutError')},/request timed out/],
   [async()=>{throw Error('secret-url')},/connection failed/],
   [async()=>new Response('secret-url',{status:502}),/HTTP 502/],
   [async()=>new Response('secret-url'),/unreadable response/],
   [async()=>Response.json(null),/unreadable response/],
  ];
  for(const [index,[fetcher,expected]] of cases.entries()){
   const acks=[],bb=new BlueBubbles('http://127.0.0.1:1234','secret-url',fetcher);
   assert.equal(await deliver({...job,id:'transport-'+index},config,{bb,post:async b=>acks.push(b),journal:new Journal(directory,config.site)}),'needs_review');
   assert.match(acks[0].detail,expected);assert.ok(!JSON.stringify(acks).includes('secret-url'));
  }
  const acks=[];
  await deliver({...job,id:'untrusted-error'},config,{bb:{text:async()=>{throw Error('secret-url')}},post:async b=>acks.push(b),journal:new Journal(directory,config.site)});
  assert.equal(acks[0].detail,'BlueBubbles did not confirm text delivery. Check Messages before retrying.');
 });
 await check('An acknowledgement outage retries bookkeeping without resending the completed result',async()=>{
  const journal=new Journal(directory,config.site);let sends=0;const options={bb:{text:async()=>sends++,image:async()=>sends++},render:async()=>Buffer.from('png'),journal};
  const event={...job,id:'ack-outage'};
  await assert.rejects(deliver(event,config,{...options,post:async()=>{throw Error('offline')}}));
  await deliver({...event,attempts:2},config,{...options,post:async()=>{}});assert.equal(sends,1);
 });
 await check('An older confirmed result text is not repeated and its unfinished image stays paused',async()=>{
  const journal=new Journal(directory,config.site),acks=[];const event={...job,id:'old-image'};
  journal.put(event.id,{chatGuid:config.groupChatGuid,parts:{text:{status:'done'},image:{status:'sending'}}});
  const fail=async()=>{throw Error('must not send any part')};
  assert.equal(await deliver({...event,attempts:2},config,{bb:{text:fail,image:fail},post:async b=>acks.push(b),render:fail,journal}),'sent');
  assert.equal(acks[0].status,'sent');
 });
 await check('Missing recipients and changed destinations never send to a guessed chat',async()=>{
  const journal=new Journal(directory,config.site);const options={bb:{text:async()=>{throw Error('must not send')}},post:async()=>{},render:async()=>Buffer.from('png'),journal};
  assert.equal(await deliver({...job,id:'unknown',kind:'challenge',recipientId:'missing'},config,options),'skipped');
  assert.equal(await deliver(job,{...config,groupChatGuid:'iMessage;+;different-group'},options),'needs_review');
 });
 await check('PIN selectors resolve Usman through his stored Gud identity; private config files are restricted',()=>{
  const players=[{id:'one',name:'Walan',character:'walan'},{id:'two',name:'Saif',character:null},{id:'uuid',name:'Renamed',character:'gud'}];
  assert.equal(findPlayer(players,'Usman').id,'uuid');assert.equal(findPlayer(players,'Saif').id,'two');
  const file=join(directory,'config.json');privateJson(file,{secret:'test-only'});if(process.platform!=='win32')assert.equal(statSync(file).mode&0o777,0o600);assert.equal(JSON.parse(readFileSync(file,'utf8')).secret,'test-only');
 });
 await check('Meme pools are opt-in, outcome-specific, future-only, metadata-stripped and locally previewable',async()=>{
  const pool=new MemePool(join(directory,'memes'));await pool.setup();assert.equal((await pool.settings()).enabled,false);
  assert.equal(outcomePool(result,'one'),'loss');assert.equal(outcomePool({...result,winnerId:'one'},'one'),'win');assert.equal(outcomePool({...result,winnerId:null},'one'),'draw');assert.equal(outcomePool(result,'unrelated'),'win');
  const image=await sharp({create:{width:20,height:10,channels:3,background:'red'}}).jpeg().toBuffer();
  // Ampersands exercise HTML escaping while remaining a valid filename on Windows.
  for(const name of ['win','loss','draw'])writeFileSync(join(pool.directory,name,'chosen & reviewed.jpg'),image);
  assert.equal(await pool.choose({...job,createdAt:Date.now()}),null);await pool.configure(true,'one');
  const enabled=(await pool.settings()).enabledAt;
  assert.equal(await pool.choose({...job,createdAt:enabled-1}),null);assert.equal(await pool.choose({...job,kind:'challenge',createdAt:enabled+1}),null);
  const plan=await pool.choose({...job,createdAt:enabled+1});assert.equal(plan.pool,'loss');assert.deepEqual(await pool.choose({...job,createdAt:enabled+1}),plan);
  const metadata=await sharp(await pool.read(plan)).metadata();assert.equal(metadata.format,'png');assert.equal(metadata.exif,undefined);
  const preview=await pool.preview();assert.equal(preview.count,3);assert.match(readFileSync(preview.path,'utf8'),/chosen &amp; reviewed/);
  await assert.rejects(pool.read({hash:'../../config',pool:'win'}));
 });
 await check('Result image retries retain the chosen image, never repeat confirmed text, and wait for manual review',async()=>{
  const pool=new MemePool(join(directory,'memes')),journal=new Journal(directory,config.site),acks=[];
  const event={...job,id:'meme-retry',createdAt:Date.now()+1};let texts=0,images=0;
  const options={memes:pool,journal,post:async b=>acks.push(b),bb:{text:async()=>texts++,image:async()=>{images++;throw Error('private-local-path');}}};
  assert.equal(await deliver(event,config,options),'needs_review');assert.equal(texts,1);assert.equal(images,1);
  const selected=journal.get(event.id).meme;assert.ok(selected.hash);assert.ok(!JSON.stringify(acks).includes('private-local-path'));
  assert.equal(await deliver({...event,attempts:2},config,options),'needs_review');assert.equal(images,1);
  const state=journal.get(event.id);delete state.parts.image;journal.put(event.id,state);
  assert.equal(await deliver(event,config,{...options,bb:{text:async()=>texts++,image:async()=>images++}}),'sent');
  assert.equal(texts,1);assert.equal(images,2);assert.deepEqual(journal.get(event.id).meme,selected);
  await deliver({...event,attempts:2},config,{...options,bb:{text:async()=>texts++,image:async()=>images++}});assert.equal(texts,1);assert.equal(images,2);
 });
 await check('Pausing meme pools keeps text delivery working and never retrofits images to old journals',async()=>{
  const pool=new MemePool(join(directory,'memes')),journal=new Journal(directory,config.site);await pool.configure(false);
  let texts=0;const options={memes:pool,journal,post:async()=>{},bb:{text:async()=>texts++,image:async()=>{throw Error('must not send')}}};
  await deliver({...job,id:'paused-meme',createdAt:Date.now()+1},config,options);assert.equal(texts,1);
  await pool.configure(true);const old={...job,id:'old-text-after-enable',createdAt:Date.now()+1};journal.put(old.id,{chatGuid:config.groupChatGuid,parts:{text:{status:'done'}}});
  await deliver(old,config,options);assert.equal(texts,1);
 });
 console.log(`\n${passed} BlueBubbles bridge checks passed (mock transport; no real messages sent).`);
} finally {rmSync(directory,{recursive:true,force:true});}
