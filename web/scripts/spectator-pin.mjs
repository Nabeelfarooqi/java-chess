import { pbkdf2Sync } from 'node:crypto';
import { quote } from './cloudflare-admin.mjs';

export function spectatorPinUpdate(pin, salt) {
  if (!/^\d{6}$/.test(pin)) throw new Error('Choose exactly 6 digits.');
  if (!/^[0-9a-f]{48}$/.test(salt)) throw new Error('Deploy the latest migrations first.');
  const hash = pbkdf2Sync(pin, salt, 100000, 32, 'sha256').toString('hex');
  return `UPDATE spectator_settings SET pin_hash=${quote(hash)} WHERE id=1 AND NOT EXISTS (SELECT 1 FROM players WHERE pin_hash=${quote(hash)}) RETURNING id`;
}
