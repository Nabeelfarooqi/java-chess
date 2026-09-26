import { GameError, type PlayerId } from '../game';
const enc = new TextEncoder();
export const hex = (data: ArrayBuffer) => Array.from(new Uint8Array(data), b => b.toString(16).padStart(2, '0')).join('');
export const digest = async (value: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(value)));
export async function pinHash(pin: string, salt: string) { const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']); return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256)); }
function equal(a: string, b: string) { if (a.length !== b.length)
    return false; let n = 0; for (let i = 0; i < a.length; i++)
    n |= a.charCodeAt(i) ^ b.charCodeAt(i); return n === 0; }
export async function verifyPin(pin: string, stored: string) { const [salt, hash] = stored.split(':'); if (!salt || !hash)
    throw new GameError('Room access is not configured yet.', 503); return equal(await pinHash(pin, salt), hash); }
export function sessionToken(req: Request) { return req.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith('rr_session='))?.slice(11) || ''; }
export async function sessionPlayer(db: D1Database, req: Request): Promise<PlayerId | null> { const token = sessionToken(req); if (!/^[0-9a-f]{64}$/.test(token))
    return null; const r = await db.prepare('SELECT player_id FROM sessions WHERE token_hash=? AND expires>?').bind(await digest(token), Date.now()).first<{
    player_id: PlayerId;
}>(); return r?.player_id || null; }
export async function rateLimit(db: D1Database, key: string, limit: number, window: number, now = Date.now()) {
    const r = await db.prepare('INSERT INTO attempts(key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END, expires=CASE WHEN expires<=? THEN ? ELSE expires END RETURNING count,expires').bind(key, now + window, now, now, now + window).first<{
        count: number; expires: number;
    }>();
    if (!r || r.count > limit) {
        const seconds = Math.max(1, Math.ceil(((r?.expires ?? now + window) - now) / 1000));
        throw new RateLimitError(seconds);
    }
}
export class RateLimitError extends GameError {
    constructor(public retryAfter: number) {
        super(`Too many attempts. Please try again in ${retryAfter >= 60 ? `${Math.ceil(retryAfter / 60)} minute${retryAfter > 60 ? 's' : ''}` : `${retryAfter} second${retryAfter === 1 ? '' : 's'}`}.`, 429);
    }
}
export async function login(db: D1Database, req: Request, pin: unknown, env: {
    PIN_ONE_HASH?: string;
    PIN_TWO_HASH?: string;
}) {
    const ip = req.headers.get('cf-connecting-ip') || 'local-preview';
    await rateLimit(db, 'login-ip:' + await digest(ip), 8, 15 * 60000);
    await rateLimit(db, 'login-global', 50, 15 * 60000);
    if (typeof pin !== 'string' || !/^(\d{6}|\d{8}|\d{12})$/.test(pin))
        throw new GameError('Enter your personal 6-, 8-, or 12-digit access code.', 401);
    type Credential = { id: string; pin_hash: string | null; legacy_pin_hash: string | null; auth_version: number };
    let credential: Credential | null = null;
    if (pin.length === 8) {
        // Capture the database generation BEFORE verification. Persisted legacy
        // hashes make subsequent rotations independent of a stale Worker secret.
        const rows = (await db.prepare("SELECT id,pin_hash,legacy_pin_hash,auth_version FROM players WHERE id IN ('one','two')").all<Credential>()).results;
        let configured = false;
        for (const row of rows) {
            if (row.pin_hash) continue;
            const stored = row.legacy_pin_hash || (row.id === 'one' ? env.PIN_ONE_HASH : env.PIN_TWO_HASH);
            if (!stored) continue;
            configured = true;
            if (await verifyPin(pin, stored)) credential = row;
        }
        if (!configured && !await db.prepare('SELECT id FROM players WHERE pin_hash IS NOT NULL OR legacy_pin_hash IS NOT NULL LIMIT 1').first())
            throw new GameError('Room access is not configured yet.', 503);
    } else {
        // Chosen six-digit and generated twelve-digit codes cannot collide with legacy eight-digit PINs.
        // A shared random KDF salt permits one expensive derivation and an indexed lookup.
        const settings = await db.prepare('SELECT salt FROM pin_settings WHERE id=1').first<{ salt: string }>();
        if (settings) {
            credential = await db.prepare('SELECT id,pin_hash,legacy_pin_hash,auth_version FROM players WHERE pin_hash=?')
                .bind(await pinHash(pin, settings.salt)).first<Credential>();
        }
    }
    if (!credential)
        throw new GameError('That code did not match. Try again.', 401);
    const player = credential.id;
    const token = hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
    const results = await db.batch([
        db.prepare('DELETE FROM sessions WHERE expires<=?').bind(Date.now()),
        db.prepare('DELETE FROM attempts WHERE expires<=?').bind(Date.now()),
        db.prepare('INSERT INTO sessions(token_hash,player_id,expires) SELECT ?,id,? FROM players WHERE id=? AND auth_version=? AND pin_hash IS ? AND legacy_pin_hash IS ? RETURNING player_id')
            .bind(await digest(token), Date.now() + 12 * 60 * 60000, player, credential.auth_version, credential.pin_hash, credential.legacy_pin_hash)
    ]);
    if (!results[2].results.length) throw new GameError('Your access code changed. Please sign in again.', 401);
    return { player, token };
}
export function sessionCookie(req: Request, token: string) { return `rr_session=${token}; HttpOnly; SameSite=Strict; Path=/;${new URL(req.url).protocol === 'https:' ? ' Secure;' : ''}${token ? '' : ' Max-Age=0;'}`; }
