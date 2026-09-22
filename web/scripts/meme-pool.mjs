import {mkdir,readFile,writeFile,readdir,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {privateJson} from './imessage-core.mjs';
export const pools=['win','loss','draw'];
export function outcomePool(result,perspective='one') { return !result?.winnerId?'draw':result.winnerId===perspective||![result.white?.id,result.black?.id].includes(perspective)?'win':'loss'; }
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export class MemePool {
    constructor(directory){this.directory=resolve(directory);}
    async setup(){await mkdir(this.directory,{recursive:true,mode:0o700});for(const folder of [...pools,'prepared'])await mkdir(resolve(this.directory,folder),{recursive:true,mode:0o700});}
    async settings(){try{const settings=JSON.parse(await readFile(resolve(this.directory,'settings.json'),'utf8'));return {enabled:settings.enabled===true,enabledAt:Number(settings.enabledAt)||0,perspective:typeof settings.perspective==='string'?settings.perspective:'one'};}catch(error){if(error.code==='ENOENT')return {enabled:false,enabledAt:0,perspective:'one'};throw Error('Meme settings could not be read. Run imessage:memes pause, then configure them again.');}}
    async configure(enabled,perspective){await this.setup();const current=await this.settings();privateJson(resolve(this.directory,'settings.json'),{enabled,enabledAt:enabled?Date.now():current.enabledAt,perspective:perspective||current.perspective});}
    async list(pool){if(!pools.includes(pool))throw Error('Unknown meme pool.');try{return (await readdir(resolve(this.directory,pool),{withFileTypes:true})).filter(file=>file.isFile()&&/\.(png|jpe?g|webp)$/i.test(file.name)).map(file=>file.name).sort().slice(0,100);}catch(error){if(error.code==='ENOENT')return [];throw error;}}
    async prepare(pool,name){
        if(!pools.includes(pool)||!(await this.list(pool)).includes(name))throw Error('Meme file is not in the selected pool.');
        const path=resolve(this.directory,pool,name),stat=await lstat(path);
        if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)throw Error('Use a regular PNG, JPEG, or WebP image under 8 MB.');
        let png;try{png=await sharp(await readFile(path),{limitInputPixels:20000000,animated:false}).rotate().resize(1200,1200,{fit:'inside',withoutEnlargement:true}).png().toBuffer();}catch{throw Error('An image could not be decoded. Use PNG, JPEG, or WebP under 20 megapixels.');}
        const id=hash(png);await mkdir(resolve(this.directory,'prepared'),{recursive:true,mode:0o700});await writeFile(resolve(this.directory,'prepared',id+'.png'),png,{mode:0o600});return {hash:id,pool};
    }
    async choose(job){const settings=await this.settings();if(job.kind!=='result'||!settings.enabled||!Number.isFinite(job.createdAt)||job.createdAt<settings.enabledAt)return null;const pool=outcomePool(job.result,settings.perspective),files=await this.list(pool);if(!files.length)return null;const index=parseInt(hash(job.id).slice(0,8),16)%files.length;return this.prepare(pool,files[index]);}
    async read(plan){if(!plan||!pools.includes(plan.pool)||!/^[a-f0-9]{64}$/.test(plan.hash))throw Error('Invalid saved meme selection.');const bytes=await readFile(resolve(this.directory,'prepared',plan.hash+'.png'));if(hash(bytes)!==plan.hash)throw Error('Prepared meme changed. Restore it before retrying.');return bytes;}
    async preview(){await this.setup();let html='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Rival Chess meme pools</title><style>body{background:#131713;color:#eef5e8;font:16px system-ui;padding:24px}section{display:flex;flex-wrap:wrap;gap:20px}figure{margin:0;width:220px}img{width:220px;height:220px;object-fit:contain;background:#222}figcaption{overflow-wrap:anywhere}p{max-width:700px;line-height:1.6}</style><h1>Your meme pools</h1><p>Local preview only. Nothing is sent. Images send to the configured results group only after you enable pools. Loss is from your selected player’s perspective; games between other players use win. Draws always use draw.</p>';let count=0;for(const pool of pools){html+='<h2>'+pool+'</h2><section>';for(const name of await this.list(pool)){const plan=await this.prepare(pool,name);html+='<figure><img alt="Selected '+pool+' meme" src="data:image/png;base64,'+(await this.read(plan)).toString('base64')+'"><figcaption>'+escape(name)+'</figcaption></figure>';count++;}html+='</section>';}const path=resolve(this.directory,'preview.html');await writeFile(path,html,{mode:0o600});return {path,count};}
}
