import { pbkdf2Sync } from 'node:crypto';
import { query, quote, findPlayer } from './cloudflare-admin.mjs';
import { hidden } from './terminal-input.mjs';
export function pinUpdate(playerId, pin, salt) {
  if (!/^\d{6}$/.test(pin)) throw new Error('Choose exactly 6 digits.');
  if (!/^[0-9a-f]{48}$/.test(salt)) throw new Error('Deploy the latest migrations first.');
  const hash = pbkdf2Sync(pin, salt, 100000, 32, 'sha256').toString('hex');
  return `UPDATE players SET pin_hash=${quote(hash)} WHERE id=${quote(playerId)} AND NOT EXISTS (SELECT 1 FROM players WHERE pin_hash=${quote(hash)} AND id<>${quote(playerId)}) AND NOT EXISTS (SELECT 1 FROM spectator_settings WHERE pin_hash=${quote(hash)}) RETURNING id`;
}
export async function setPin(selector) {
  if (!selector) throw new Error('Use npm run cloudflare:set-pin -- Walan (or Gud, Usman, Saif, or a player ID).');
  if (!query("SELECT name FROM sqlite_master WHERE type='trigger' AND name='players_pin_changed'").length) throw new Error('Run npm run cloudflare:deploy before changing PINs.');
  const player = findPlayer(query('SELECT id,name,character FROM players'), selector);
  const salt = query('SELECT salt FROM pin_settings WHERE id=1')[0]?.salt;
  console.log('Change only '+player.name+'’s code. Their character and all scores stay the same.');
  const pin = await hidden('New 6-digit PIN (hidden): ');
  if (!/^\d{6}$/.test(pin)) throw new Error('Choose exactly 6 digits.');
  if (pin !== await hidden('Enter it again (hidden): ')) throw new Error('The codes did not match. Nothing changed.');
  const changed = query(pinUpdate(player.id, pin, salt));
  if (!changed.length) throw new Error('That code is already used by another player or spectator access. Choose a different code.');
  console.log(player.name+'’s PIN was saved. Sign in with the chosen code. Other players are unchanged.');
}
