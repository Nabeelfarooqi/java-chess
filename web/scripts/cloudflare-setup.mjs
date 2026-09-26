import { existsSync,readFileSync,writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomInt,randomBytes,pbkdf2Sync } from 'node:crypto';
import { resolve } from 'node:path';
import { newPlayer, playerName } from './player-pin.mjs';
import { quote } from './cloudflare-admin.mjs';
const config=resolve('cloudflare.local.json');
const wrangler=resolve('node_modules/wrangler/bin/wrangler.js');
function run(args,input,privateOutput=false){const r=spawnSync(process.execPath,[wrangler,...args],{stdio:privateOutput?'pipe':input?['pipe','inherit','inherit']:'inherit',input,encoding:'utf8'});if(r.status!==0){if(privateOutput)console.error('Private Cloudflare update failed. Check login and deploy the latest migrations before retrying.');process.exit(r.status||1);}}
const mode=process.argv[2]||'setup';
if(!['setup','pins','deploy','add-player'].includes(mode))throw new Error('Use setup, pins, deploy, or add-player.');
if(!existsSync(config)){if(mode!=='setup')throw new Error('Run npm run cloudflare:setup first.');writeFileSync(config,readFileSync('cloudflare.template.json'));}
if(mode==='setup'){
 console.log('Opening Cloudflare login. Choose the account that should own your game.');
 run(['login']);
 const c=JSON.parse(readFileSync(config,'utf8'));
 if(!c.d1_databases?.some(d=>d.binding==='DB'&&d.database_id)){
  console.log('Creating your persistent chess database. If this name already exists, set its database_id in cloudflare.local.json instead of creating a replacement.');
  run(['d1','create','rival-room-db','--binding','DB','--update-config','--config',config]);
 }
 const ready=JSON.parse(readFileSync(config,'utf8'));
 if(!ready.d1_databases?.some(d=>d.binding==='DB'&&d.database_id))throw new Error('The DB binding was not written. Add the returned database ID to cloudflare.local.json.');
 for(const db of ready.d1_databases)if(db.binding==='DB')db.migrations_dir='drizzle';
 writeFileSync(config,JSON.stringify(ready,null,2)+'\n');
 console.log('\nCloudflare is connected. Next: npm run cloudflare:deploy, then npm run cloudflare:pins.');
}
if(mode==='deploy'){
 const c=JSON.parse(readFileSync(config,'utf8'));const database=c.d1_databases?.find(d=>d.binding==='DB');
 if(!database?.database_id||database.database_id==='00000000-0000-4000-8000-000000000000')throw new Error('A real D1 database is required. Run npm run cloudflare:setup first.');
 const checked=spawnSync(process.execPath,['scripts/check-migrations.mjs',resolve(database.migrations_dir||'migrations')],{stdio:'inherit'});if(checked.status!==0)process.exit(checked.status||1);
 const built=spawnSync(process.execPath,['scripts/run-framework.mjs','build'],{stdio:'inherit'});if(built.status!==0)process.exit(built.status||1);
 run(['d1','migrations','apply','DB','--remote','--config',config]);
 run(['deploy','--config',resolve('dist/server/wrangler.json')]);
 console.log('\nUse the workers.dev URL printed above. On the FIRST deployment, run npm run cloudflare:pins to enable access. Later deployments keep your existing PINs and records.');
}
if(mode==='pins'){
 if(!process.stdout.isTTY)throw new Error('Run this interactively on your own computer; PINs must not appear in CI logs.');
 const pinOne=String(randomInt(10000000,100000000));let pinTwo;do{pinTwo=String(randomInt(10000000,100000000))}while(pinOne===pinTwo);
 const hash=pin=>{const salt=randomBytes(24).toString('hex');return salt+':'+pbkdf2Sync(pin,salt,100000,32,'sha256').toString('hex')};
 const hashOne=hash(pinOne),hashTwo=hash(pinTwo);
 run(['d1','execute','DB','--remote','--config',config,'--command','SELECT legacy_pin_hash,auth_version FROM players LIMIT 0']);
 run(['secret','bulk','--config',config],JSON.stringify({PIN_ONE_HASH:hashOne,PIN_TWO_HASH:hashTwo}),true);
 run(['d1','execute','DB','--remote','--config',config,'--command',`UPDATE players SET pin_hash=NULL,legacy_pin_hash=${quote(hashOne)},auth_version=auth_version+1 WHERE id='one'; UPDATE players SET pin_hash=NULL,legacy_pin_hash=${quote(hashTwo)},auth_version=auth_version+1 WHERE id='two'; DELETE FROM sessions WHERE player_id IN ('one','two')`],undefined,true);
 console.log('\nSave these two personal access codes in a password manager. They are not saved to a file or GitHub.');
 console.log('Your code (Walan): '+pinOne);console.log('Your friend’s code (Saif): '+pinTwo);
 console.log('Share only your friend’s code with them. Rerunning this command replaces both original codes and locks their sessions. Additional players keep their codes.');
}

if(mode==='add-player'){
 if(!process.stdout.isTTY)throw new Error('Run this interactively on your own computer; PINs must not appear in CI logs.');
 const name=playerName(process.argv.slice(3).join(' '));
 const query=command=>{
  const r=spawnSync(process.execPath,[wrangler,'d1','execute','DB','--remote','--config',config,'--json','--command',command],{encoding:'utf8',maxBuffer:1024*1024});
  if(r.status!==0)throw new Error('Could not update the database. Make sure cloudflare:deploy finished and Wrangler is logged in. '+(r.stderr||''));
  const result=JSON.parse(r.stdout);
  if(result.some(item=>item.success===false))throw new Error('Database update failed.');
  return result.flatMap(item=>item.results||[]);
 };
 const settings=query('SELECT salt FROM pin_settings WHERE id=1')[0];
 if(!settings)throw new Error('Run npm run cloudflare:deploy first to install the player migration.');
 const player=newPlayer(name,settings.salt);
 const inserted=query(player.sql);
 if(!inserted.some(row=>row.id===player.id))throw new Error('A player with that name or character already exists. No PINs or scores were changed.');
 console.log('\nAdded '+player.name+'. Save this code now; it cannot be recovered from the database.');
 console.log(player.name+'’s personal PIN: '+player.pin);
 console.log('Share the site link and this PIN with '+player.name+'. Other PINs and saved scores are unchanged.');
}
