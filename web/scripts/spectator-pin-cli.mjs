import { query } from './cloudflare-admin.mjs';
import { hidden } from './terminal-input.mjs';
import { spectatorPinUpdate } from './spectator-pin.mjs';

try {
  if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--disable')) throw new Error('Use cloudflare:spectator-pin, optionally with --disable. Do not put codes in the command.');
  if (!query("SELECT name FROM sqlite_master WHERE type='table' AND name='spectator_settings'").length) throw new Error('Run npm run cloudflare:deploy first.');
  if (process.argv[2] === '--disable') {
    query('UPDATE spectator_settings SET pin_hash=NULL WHERE id=1');
    console.log('Spectator access disabled and spectator sessions revoked. Player PINs and records are unchanged.');
  } else {
    console.log('Set a shared spectator code. It permits watching only; it cannot play or change records.');
    const pin = await hidden('Choose a 6-digit spectator PIN (hidden): ');
    if (!/^\d{6}$/.test(pin)) throw new Error('Choose exactly 6 digits.');
    if (pin !== await hidden('Enter it again (hidden): ')) throw new Error('The codes did not match. Nothing changed.');
    const salt = query('SELECT salt FROM pin_settings WHERE id=1')[0]?.salt;
    if (!query(spectatorPinUpdate(pin, salt)).length) throw new Error('That code belongs to a player. Choose a different spectator code.');
    console.log('Spectator PIN saved. Share it with viewers and ask them to click Watch as spectator on the site.');
    console.log('Changing this code revokes existing spectator sessions. Player PINs and records stay the same.');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
