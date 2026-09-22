import sharp from 'sharp';
import {mkdir,readFile} from 'node:fs/promises';
export async function prepareAppIcons(){
    const directory=new URL('../public/app-icons/',import.meta.url);await mkdir(directory,{recursive:true});
    const piece=await readFile(new URL('../public/pieces/wN.svg',import.meta.url));
    await Promise.all([180,192,512].map(async size=>{
        const inset=Math.round(size*.23),edge=size-2*inset;
        const knight=await sharp(piece).resize(edge,edge).png().toBuffer();
        await sharp({create:{width:size,height:size,channels:4,background:'#23362b'}}).composite([{input:knight,left:inset,top:inset}]).png().toFile(new URL(`${size}.png`,directory).pathname);
    }));
}
