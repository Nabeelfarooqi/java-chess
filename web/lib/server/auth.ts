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
    const r = await db.prepare('INSERT INTO attempts(key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END, expires=CASE WHEN expires<=? THEN ? ELSE expires END RETURNING count').bind(key, now + window, now, now, now + window).first<{
        count: number;
    }>();
    if (!r || r.count > limit)
        throw new GameError('Too many attempts. Please try again in 15 minutes.', 429);
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
    let player: PlayerId | null = null;
    if (pin.length === 8) {
        if (!env.PIN_ONE_HASH || !env.PIN_TWO_HASH)
            throw new GameError('Room access is not configured yet.', 503);
        const [one, two] = await Promise.all([verifyPin(pin, env.PIN_ONE_HASH), verifyPin(pin, env.PIN_TWO_HASH)]);
        player = one ? 'one' : two ? 'two' : null;
        if (player) {
            const saved = await db.prepare('SELECT pin_hash FROM players WHERE id=?').bind(player).first<{ pin_hash: string | null }>();
            if (saved?.pin_hash) player = null; // A chosen PIN replaces this legacy secret for this player.
        }
    } else {
        // Chosen six-digit and generated twelve-digit codes cannot collide with legacy eight-digit PINs.
        // A shared random KDF salt permits one expensive derivation and an indexed lookup.
        const settings = await db.prepare('SELECT salt FROM pin_settings WHERE id=1').first<{ salt: string }>();
        if (settings) {
            const found = await db.prepare('SELECT id FROM players WHERE pin_hash=?')
                .bind(await pinHash(pin, settings.salt)).first<{ id: string }>();
            player = found?.id || null;
        }
    }
    if (!player)
        throw new GameError('That code did not match. Try again.', 401);
    const token = hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
    await db.batch([
        db.prepare('INSERT OR IGNORE INTO players(id,name,character) VALUES (?,?,?)').bind('one', 'Walan', 'walan'),
        db.prepare('INSERT OR IGNORE INTO players(id,name,character) VALUES (?,?,?)').bind('two', 'Saif', 'saif'),
        db.prepare('DELETE FROM sessions WHERE expires<=?').bind(Date.now()),
        db.prepare('DELETE FROM attempts WHERE expires<=?').bind(Date.now()),
        db.prepare('INSERT INTO sessions(token_hash,player_id,expires) VALUES (?,?,?)').bind(await digest(token), player, Date.now() + 12 * 60 * 60000)
    ]);
    return { player, token };
}
export function sessionCookie(req: Request, token: string) { return `rr_session=${token}; HttpOnly; SameSite=Strict; Path=/;${new URL(req.url).protocol === 'https:' ? ' Secure;' : ''}${token ? '' : ' Max-Age=0;'}`; }
