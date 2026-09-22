// Re-encode the supplied artwork for delivery. Keep the original files,
// dimensions, crop, and transparency; no runtime image service is required.
import sharp from 'sharp';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

for (const [name, extension] of [['walan', 'jpeg'], ['gud', 'jpeg'], ['saif', 'png']]) {
    const source = fileURLToPath(new URL(`../public/characters/${name}.${extension}`, import.meta.url));
    const target = fileURLToPath(new URL(`../public/characters/${name}.webp`, import.meta.url));
    await sharp(source).webp({ quality: 88, alphaQuality: 100, effort: 6 }).toFile(target);
    const before = (await stat(source)).size, after = (await stat(target)).size;
    console.log(`${name}: ${Math.round(before / 1024)} → ${Math.round(after / 1024)} KiB (${Math.round((1 - after / before) * 100)}% smaller)`);
}
