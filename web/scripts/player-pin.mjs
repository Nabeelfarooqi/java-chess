import { randomInt, randomUUID, pbkdf2Sync } from 'node:crypto';

export function playerName(value) {
  const name = value.trim();
  if (!name || name.length > 24 || /[\x00-\x1f]/.test(name)) throw new Error('Use a name between 1 and 24 characters.');
  return name;
}
const quote = value => "'" + value.replaceAll("'", "''") + "'";
export function newPlayer(name, salt) {
  name = playerName(name);
  // New installations have no Usman record at migration time. Assign his
  // character once when invited, then keep it attached to the generated ID.
  const character = ['usman', 'gud'].includes(name.toLowerCase()) ? 'gud' : null;
  if (character) name = 'Gud';
  if (!/^[0-9a-f]{48}$/.test(salt)) throw new Error('Invalid PIN settings. Deploy the latest migrations first.');
  // Twelve digits keep newly issued codes separate from the two original eight-digit PINs.
  const pin = String(randomInt(100000000000, 1000000000000));
  const id = randomUUID();
  const hash = pbkdf2Sync(pin, salt, 100000, 32, 'sha256').toString('hex');
  const sql = `INSERT INTO players(id,name,pin_hash,character) SELECT ${quote(id)},${quote(name)},${quote(hash)},${character ? quote(character) : 'NULL'} WHERE NOT EXISTS (SELECT 1 FROM players WHERE lower(name)=lower(${quote(name)})${character ? ' OR character=' + quote(character) : ''}) RETURNING id`;
  return { id, name, character, pin, sql };
}
