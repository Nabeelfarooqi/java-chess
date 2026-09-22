import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
const xml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
const text = (value, x, y, size = 28, color = '#f7f2df', weight = 400) => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}" font-family="Arial, Helvetica, sans-serif">${xml(value)}</text>`;
async function portrait(player) {
  if (['walan', 'gud'].includes(player.character)) {
    const path = new URL('../public/characters/'+player.character+'.jpeg', import.meta.url);
    const source = sharp(fileURLToPath(path)), size = await source.metadata();
    // The supplied originals are larger than their in-chat previews. Frame by proportions.
    return source.extract({ left: Math.round(size.width * 650 / 1824), top: Math.round(size.height * 290 / 1367), width: Math.round(size.width * 470 / 1824), height: Math.round(size.height * 545 / 1367) }).resize(188, 218).png().toBuffer();
  }
  return Buffer.from(`<svg width="188" height="218"><rect width="188" height="218" rx="16" fill="#334239"/>${text(player.name.slice(0,1).toUpperCase(),58,142,92)}</svg>`);
}
export async function winnerCard(result) {
  const { white, black, winnerId, time, reason, score } = result;
  const winner = winnerId === white.id ? white : black;
  const headline = winnerId ? winner.name+' WINS' : 'HONORS EVEN';
  const art = `<svg width="1000" height="630" xmlns="http://www.w3.org/2000/svg"><rect width="1000" height="630" rx="28" fill="#14201a"/><rect x="30" y="26" width="940" height="6" rx="3" fill="${winnerId && winner.character === 'gud' ? '#f1a197' : '#a9ec88'}"/>
    ${text('RIVAL ROOM',44,76,22,'#a9bdae',700)}${text(headline,44,143,Math.min(48,1280/headline.length),'#f7f2df',800)}
    ${text(white.name,275,235,Math.min(30,480/Math.max(white.name.length,1)), '#f7f2df',700)}${text('WHITE',275,270,18,'#adbeaf')}
    ${text(black.name,752,235,Math.min(30,400/Math.max(black.name.length,1)), '#f7f2df',700)}${text('BLACK',752,270,18,'#adbeaf')}
    ${text(String(score.whiteWins),285,345,60,'#a9ec88',800)}${text(String(score.blackWins),760,345,60,'#f1a197',800)}
    ${text('HEAD-TO-HEAD',44,474,18,'#adbeaf',700)}${text(score.draws+(score.draws === 1 ? ' draw' : ' draws'),760,474,22,'#adbeaf')}
    ${text(time+'  ·  '+reason,44,535,29)}${text('Another game. Another chapter.',44,589,20,'#adbeaf')}
    </svg>`;
  return sharp(Buffer.from(art)).composite([{ input: await portrait(white), left: 44, top: 198 }, { input: await portrait(black), left: 520, top: 198 }]).png().toBuffer();
}
