import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { BlueBubbles, localBlueBubblesUrl } from '../scripts/bluebubbles-client.mjs';
import { chatKind, chatCounts, chatDiagnostics } from '../scripts/imessage-chat-list.mjs';
import { Journal, deliver, privateJson } from '../scripts/imessage-core.mjs';
import { winnerCard } from '../scripts/winner-card.mjs';
import { findPlayer } from '../scripts/cloudflare-admin.mjs';
const directory=mkdtempSync(join(tmpdir(),'rival-imessage-'));
const config={site:'https://chess.test',targets:{gud:'iMessage;-;gud-test'},groupChatGuid:'iMessage;+;test-group'};
const result={white:{id:'one',name:'Walan',character:'walan'},black:{id:'gud',name:'Gud',character:'gud'},winnerId:'gud',time:'5+0',reason:'Checkmate',score:{whiteWins:3,blackWins:4,draws:1}};
const job={id:'game:result',kind:'result',gameId:'game',leaseToken:'lease',attempts:1,text:'Gud beat Walan',result};
let passed=0;async function check(name,fn){await fn();console.log('PASS '+name);passed++;}
try {
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
  assert.deepEqual(chatCounts(chats),{total:103,direct:1,group:1,unsupported:101});
  assert.deepEqual(chats.filter(c=>chatKind(c)==='direct').map(c=>c.guid),['iMessage;-;usman@example.test']);
  assert.deepEqual(chats.filter(c=>chatKind(c)==='group').map(c=>c.displayName),['FRQ']);
 });
 await check('Chat diagnostics distinguish empty API results from filtered chats without disclosing addresses or message bodies',()=>{
  const chats=[{guid:'iMessage;-;usman@example.test',style:45,participants:[{address:'usman@example.test'}],lastMessage:{text:'private-message'}},{guid:'iMessage;+;private-group-id',displayName:'FRQ',style:43,participants:[{},{}]},{guid:'any;-;private-address'},{guid:'private-unknown-address'},null];
  const report=chatDiagnostics(chats);
  assert.match(report,/5 chats: 1 direct iMessage, 1 iMessage groups, 3 unsupported/);
  assert.match(report,/FRQ \| group \| participants: 2 \| style: 43/);
  assert.match(report,/any;-;\[hidden\]: 1/);
  for(const secret of ['usman@example.test','private-message','private-group-id','private-address','private-unknown-address']) assert.ok(!report.includes(secret));
  assert.match(chatDiagnostics([]),/API returned an empty list/);
  assert.equal(chatKind(null),'unsupported');assert.equal(chatKind({guid:12}),'unsupported');
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
  assert.equal(statSync(journal.path(job.id)).mode&0o777,0o600);
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
  const file=join(directory,'config.json');privateJson(file,{secret:'test-only'});assert.equal(statSync(file).mode&0o777,0o600);assert.equal(JSON.parse(readFileSync(file,'utf8')).secret,'test-only');
 });
 console.log(`\n${passed} BlueBubbles bridge checks passed (mock transport; no real messages sent).`);
} finally {rmSync(directory,{recursive:true,force:true});}
