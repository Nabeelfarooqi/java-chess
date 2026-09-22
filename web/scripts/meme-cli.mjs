import {resolve} from 'node:path';
import {readFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {MemePool,pools} from './meme-pool.mjs';
import {question} from './terminal-input.mjs';
try {
    const pool=new MemePool(resolve('.imessage/memes')),mode=process.argv[2]||'setup';
    await pool.setup();
    if(mode==='pause'){await pool.configure(false);console.log('Images paused. Text announcements continue.');}
    else if(mode==='enable'){
        if(!existsSync('.imessage/config.json'))throw Error('Run npm run imessage:setup first.');
        const config=JSON.parse(readFileSync('.imessage/config.json','utf8'));
        if(!config.groupChatGuid)throw Error('Choose a results group with imessage:setup first.');
        const preview=await pool.preview();if(!preview.count)throw Error('Add images to the win, loss, or draw folders first.');
        const current=await pool.settings();
        const perspective=(await question(`Perspective player ID [${current.perspective}; one = Walan]: `)).trim()||current.perspective;
        if(!/^[a-zA-Z0-9-]{1,64}$/.test(perspective))throw Error('Use a player ID, not a PIN.');
        if(perspective!=='one'&&!Object.hasOwn(config.targets||{},perspective))throw Error('That player ID has no configured destination. Use one, two, or a configured added player ID.');
        console.log(`Future results will send one selected image to your existing results destination: ${config.groupChatGuid}.\nWin: your player wins, or a game between others. Loss: your player loses. Draw: anyone draws. Empty pools stay text-only.\nLocal preview: ${preview.path}`);
        if(process.platform==='darwin')spawnSync('open',[preview.path],{stdio:'ignore'});
        if((await question('Type ENABLE to use these pools for future results: '))!=='ENABLE')throw Error('Left unchanged.');
        await pool.configure(true,perspective);console.log('Meme pools enabled for future results. The running sender reads this setting automatically. No messages were sent by setup.');
    }else if(mode==='preview'){
        const result=await pool.preview();console.log(`${result.count} selected images. Preview: ${result.path}`);if(process.platform==='darwin')spawnSync('open',[result.path],{stdio:'ignore'});
    }else if(mode==='setup'||mode==='list'){
        const settings=await pool.settings();console.log(`Images ${settings.enabled?'enabled':'paused'} · Perspective ${settings.perspective}`);
        for(const name of pools)console.log(`${name}: ${(await pool.list(name)).length} images · ${resolve(pool.directory,name)}`);
        console.log('Put your chosen PNG/JPEG/WebP files in those folders (8 MB / 20 megapixels maximum each). Then run:\nnpm run imessage:memes -- preview\nnpm run imessage:memes -- enable\nPause anytime: npm run imessage:memes -- pause');
        if(mode==='setup'&&process.platform==='darwin')spawnSync('open',[pool.directory],{stdio:'ignore'});
    }else throw Error('Use setup, list, preview, enable, or pause.');
}catch(error){console.error(error.message);process.exitCode=1;}
