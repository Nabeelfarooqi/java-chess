import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base = new URL('../public/engine/', import.meta.url);
const fullHash = 'hyXCZXJ2Jhf9lrLqg/8TDmZAuFgViQ1oK/jEnbCCByE=';
const digest = bytes => createHash('sha256').update(bytes).digest('base64');
async function download(path, expected, target) {
  try { const bytes = await readFile(target); if (digest(bytes) === expected) return bytes; } catch {}
  const response = await fetch(`https://unpkg.com/stockfish@19.0.0/${path}`, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Could not prepare Stockfish (${response.status}). Retry the build.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== expected) throw new Error('Stockfish integrity check failed.');
  await writeFile(target, bytes);
  return bytes;
}
export async function prepareEngine() {
  const assets = [
    ['bin/stockfish-19-lite-single.js','0zRBJKsGf7C5Dud4c7uOn79fwBvFJf5xSw+UJYHoieY='],
    ['bin/stockfish-19-lite-single.wasm','V6wtcjEqujRnYOPxc/aHqMIRII6XqHJoQ29/DhC7U4c='],
    ['bin/stockfish-19-single.js','cncvi91zU+TiQkXZRruDH1a8zPAvoWp3nBuSpsAOXMI='],
    ['Copying.txt','Czg9WmPaZE9ijZnDOXbqZIftiaqlnwsyV5kt6sEXHms=']
  ];
  await mkdir(base, { recursive: true });
  await Promise.all(assets.map(async ([path, expected]) => {
    const target = new URL(path.split('/').at(-1), base);
    await download(path, expected, target);
  }));
  // Keep the complete WASM outside public: each deployed asset must fit Cloudflare's limit.
  const cache = new URL('../.sites-runtime/engine/', import.meta.url);
  await mkdir(cache, { recursive: true });
  const bytes = await download('bin/stockfish-19-single.wasm', fullHash, new URL('stockfish-19-single.wasm', cache));
  const chunks = [];
  for (let offset = 0, i = 0; offset < bytes.length; offset += 20 * 1024 * 1024, i++) {
    const chunk = bytes.subarray(offset, offset + 20 * 1024 * 1024);
    const file = `stockfish-19-full-${i}.part`;
    await writeFile(new URL(file, base), chunk);
    chunks.push({ file, bytes: chunk.length, sha256: digest(chunk) });
  }
  await writeFile(new URL('full-manifest.json', base), JSON.stringify({ version: 19, bytes: bytes.length, sha256: fullHash, chunks }));
  await writeFile(new URL('SOURCE.txt', base), 'Stockfish.js 19.0.0, GPL-3.0. Copyright 2026 Chess.com, LLC and Stockfish contributors.\nUnmodified lite and full single-threaded builds from npm stockfish@19.0.0. Full WASM is split for transport and reassembled byte-for-byte.\nCorresponding source: https://github.com/nmrugg/stockfish.js/tree/54fde71d90c7c403964f6cacef48f7bbec495df1\nSource archive: https://github.com/nmrugg/stockfish.js/archive/54fde71d90c7c403964f6cacef48f7bbec495df1.tar.gz\nBuild instructions: README.md and build.js in that source tree.\nLicense: Copying.txt\n');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await prepareEngine();
