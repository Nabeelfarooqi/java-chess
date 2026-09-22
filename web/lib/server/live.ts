import type { Game } from '../game';
export type LiveEnv = { DB?: D1Database; LIVE_PLAYERS?: DurableObjectNamespace; PIN_ONE_HASH?: string; PIN_TWO_HASH?: string; IMESSAGE_BRIDGE_HASH?: string };
export async function broadcast(env: LiveEnv, game: Game) {
    if (!env.LIVE_PLAYERS) return;
    const body = JSON.stringify(game);
    const results = await Promise.allSettled([game.white, game.black].map(id => env.LIVE_PLAYERS!.get(env.LIVE_PLAYERS!.idFromName(id)).fetch('https://live.internal/publish', { method: 'POST', body })));
    if (results.some(r => r.status === 'rejected' || !r.value.ok)) console.warn('Live notification failed; polling will recover.');
}
