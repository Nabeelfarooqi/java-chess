import { GameError } from '../game';

/** Read at most limit UTF-8 bytes, including requests without Content-Length. */
export async function readJson(req: Request, limit: number): Promise<Record<string, unknown>> {
    const declared = req.headers.get('content-length');
    if (declared && Number(declared) > limit) throw new GameError('Request is too large.', 413);
    const reader = req.body?.getReader();
    if (!reader) throw new GameError('Invalid request.', 400);
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > limit) {
                // Do not await an untrusted producer's cancellation callback.
                void reader.cancel().catch(() => {});
                throw new GameError('Request is too large.', 413);
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); }
    catch { throw new GameError('Invalid request.', 400); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GameError('Invalid request.', 400);
    return value as Record<string, unknown>;
}
