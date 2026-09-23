export type EngineMode = 'lite' | 'full';
export type EngineAsset = { url: string; dispose: () => void };
const fullHash = 'hyXCZXJ2Jhf9lrLqg/8TDmZAuFgViQ1oK/jEnbCCByE=';

export async function loadReviewAssets(mode: EngineMode, signal: AbortSignal, progress: (percent: number) => void): Promise<EngineAsset> {
    if (mode === 'lite') return { url: '/engine/stockfish-19-lite-single.js', dispose: () => {} };
    const response = await fetch('/engine/full-manifest.json', { signal });
    if (!response.ok) throw new Error('Full engine files are unavailable. Try Lite or redeploy the latest build.');
    const manifest = await response.json() as { bytes: number; sha256: string; chunks: { file: string; bytes: number; sha256: string }[] };
    if (manifest.sha256 !== fullHash || manifest.bytes !== 99102793 || manifest.chunks.length !== 5) throw new Error('Full engine manifest did not match this release. Refresh the page.');
    const buffers: ArrayBuffer[] = []; let loaded = 0;
    for (const [i, chunk] of manifest.chunks.entries()) {
        if (chunk.file !== `stockfish-19-full-${i}.part`) throw new Error('Invalid engine chunk.');
        const result = await fetch(`/engine/${chunk.file}`, { signal });
        if (!result.ok) throw new Error('Full engine download interrupted. Retry or use Lite.');
        const bytes = await result.arrayBuffer(); signal.throwIfAborted();
        const hash = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))));
        if (bytes.byteLength !== chunk.bytes || hash !== chunk.sha256) throw new Error('Full engine integrity check failed. Retry the download.');
        buffers.push(bytes); loaded += bytes.byteLength; progress(Math.round(loaded / manifest.bytes * 100));
    }
    // Verify the reassembled upstream binary, not just the manifest's individual chunks.
    const blob = new Blob(buffers, { type: 'application/wasm' });
    const hash = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))));
    signal.throwIfAborted();
    if (hash !== fullHash) throw new Error('Full engine integrity check failed.');
    const url = URL.createObjectURL(blob);
    return { url: '/engine/stockfish-19-single.js#' + encodeURIComponent(url), dispose: () => URL.revokeObjectURL(url) };
}
