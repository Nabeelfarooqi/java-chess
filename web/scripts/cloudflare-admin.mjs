import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
export const configPath = resolve('cloudflare.local.json');
export const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
export function requireConfig() {
  if (!existsSync(configPath)) throw new Error('Run this from your existing web folder after cloudflare:setup.');
  return JSON.parse(readFileSync(configPath, 'utf8'));
}
export function wrangler(args, input) {
  requireConfig();
  const result = spawnSync(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), ...args, '--config', configPath], { input, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('Cloudflare command failed. Check Wrangler login and deploy the latest migrations first.');
  return result.stdout;
}
export function query(command) {
  const result = JSON.parse(wrangler(['d1', 'execute', 'DB', '--remote', '--json', '--command', command]));
  if (result.some(item => item.success === false)) throw new Error('The database could not save this change.');
  return result.flatMap(item => item.results || []);
}
export function findPlayer(players, selector) {
  const value = selector.trim().toLowerCase();
  const alias = value === 'nabeel' ? 'walan' : value === 'usman' ? 'gud' : value;
  const matches = players.filter(p => p.id === selector || p.character === alias || p.name.toLowerCase() === value);
  if (matches.length !== 1) throw new Error('Choose one exact player name or player ID; no unique player matched.');
  return matches[0];
}
