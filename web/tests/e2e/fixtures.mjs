import { test as base, expect } from '@playwright/test';
import { fork, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function localEnvironment() {
  // Keep OS/runtime paths only. Real Cloudflare/API credentials and NODE_OPTIONS
  // never enter the server process; local fixtures need no external account.
  const env = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC',
    'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, CI: 'true', CLOUDFLARE_CF_FETCH_ENABLED: 'false',
    WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false' };
}

async function launch() {
  const child = fork(fileURLToPath(new URL('./local-server.mjs', import.meta.url)), [], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), env: localEnvironment(),
    execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-12000); });
  const stop = async () => {
    if (child.exitCode !== null) return;
    const exited = new Promise(resolve => child.once('exit', resolve));
    if (child.connected) child.send({ type: 'stop' });
    const timer = setTimeout(() => {
      // Kill only this fixture's known child tree if graceful shutdown stalls.
      if (process.platform === 'win32') spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
      else child.kill('SIGKILL');
    }, 10_000);
    try { await exited; } finally { clearTimeout(timer); }
  };
  try {
    const origin = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Local built app did not start within 120 seconds.\n' + output)), 120_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Local fixture exited (${code}).\n${output}`)); });
      child.on('message', message => {
        if (message.type === 'ready') { clearTimeout(timer); resolve(message.origin); }
        if (message.type === 'error') { clearTimeout(timer); reject(new Error(message.message + '\n' + output)); }
      });
    });
    return { origin, stop };
  } catch (error) { await stop(); throw error; }
}

export const test = base.extend({
  app: [async ({}, provide) => {
    const app = await launch();
    try { await provide(app); } finally { await app.stop(); }
  }, { scope: 'worker', timeout: 150_000 }],
  baseURL: async ({ app }, provide) => { await provide(app.origin); },
});
export { expect };

export async function signIn(page, player = 'one') {
  await page.goto('/');
  await page.getByLabel('Your personal access code').fill(player === 'one' ? '100000000001' : '100000000002');
  await page.getByRole('button', { name: 'Enter room', exact: true }).click();
  await expect(page.locator('.signed-in-player')).toContainText(player === 'one' ? 'Browser One' : 'Browser Two');
}

export function actionResponse(page, action) {
  return page.waitForResponse(response => {
    const request = response.request();
    return new URL(response.url()).pathname === '/api/room' && request.method() === 'POST' && request.postDataJSON()?.action === action;
  });
}
