import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base = new URL('../public/engine/', import.meta.url);
export async function prepareEngine() {
  const assets = [
    ['bin/stockfish-19-lite-single.js','0zRBJKsGf7C5Dud4c7uOn79fwBvFJf5xSw+UJYHoieY='],
    ['bin/stockfish-19-lite-single.wasm','V6wtcjEqujRnYOPxc/aHqMIRII6XqHJoQ29/DhC7U4c='],
    ['Copying.txt','Czg9WmPaZE9ijZnDOXbqZIftiaqlnwsyV5kt6sEXHms=']
  ];
  await mkdir(base, { recursive: true });
  await Promise.all(assets.map(async ([path, expected]) => {
    const target = new URL(path.split('/').at(-1), base);
    const valid = bytes => createHash('sha256').update(bytes).digest('base64') === expected;
    try { if (valid(await readFile(target))) return; } catch {}
    const response = await fetch(`https://unpkg.com/stockfish@19.0.0/${path}`, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Could not prepare Stockfish (${response.status}). Retry the build.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!valid(bytes)) throw new Error('Stockfish integrity check failed.');
    await writeFile(target, bytes);
  }));
  await writeFile(new URL('SOURCE.txt', base), 'Stockfish.js 19.0.0, GPL-3.0. Copyright 2026 Chess.com, LLC and Stockfish contributors.\nUnmodified lite single-threaded build from npm stockfish@19.0.0.\nCorresponding source: https://github.com/nmrugg/stockfish.js/tree/54fde71d90c7c403964f6cacef48f7bbec495df1\nSource archive: https://github.com/nmrugg/stockfish.js/archive/54fde71d90c7c403964f6cacef48f7bbec495df1.tar.gz\nBuild instructions: README.md and build.js in that source tree.\nLicense: Copying.txt\n');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await prepareEngine();
