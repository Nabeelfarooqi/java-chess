import { createInterface } from 'node:readline/promises';
export async function question(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(prompt)).trim(); } finally { rl.close(); }
}
export function hidden(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run this interactively in your Mac Terminal.');
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error) => { process.stdin.off('data', input); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); if (error) reject(error); else resolve(value); };
    const input = buffer => { for (const char of buffer.toString('utf8')) {
      if (char === '\u0003' || char === '\u001b') { finish(new Error('Cancelled.')); return; }
      if (char === '\r' || char === '\n') { finish(); return; }
      if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
      else if (char >= ' ' && value.length < 256) value += char;
    }};
    process.stdout.write(prompt); process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', input);
  });
}
