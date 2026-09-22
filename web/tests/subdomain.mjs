import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changeSubdomain, dnsLabel, moveBridgeSite, workerOrigin } from '../scripts/cloudflare-subdomain.mjs';
import { Journal, deliver } from '../scripts/imessage-core.mjs';

const plan = { accountId: 'a'.repeat(32), worker: 'rival-room', from: 'old-name', to: 'rivalchess', databaseId: 'existing-db' };
const oldSite = workerOrigin(plan.worker, plan.from), newSite = workerOrigin(plan.worker, plan.to);
function fixture() {
  const state = { current: plan.from, pending: null, calls: [], saves: 0, verifies: 0,
    bridge: { site: oldSite, bridgeToken: 'test-token', blueBubblesPassword: 'test-password', targets: { saif: 'any;-;saif' }, groupChatGuid: 'any;+;frq' } };
  const deps = {
    api: async (path, options = {}) => {
      state.calls.push([path, options]);
      if (path.endsWith('/settings')) return { bindings: [{ type: 'd1', name: 'DB', id: 'existing-db' }] };
      if (options.method === 'PUT') { state.current = options.body.subdomain; if (state.timeout) throw Error('timeout'); }
      return { subdomain: state.current };
    },
    savePending: value => { state.pending = structuredClone(value); },
    clearPending: () => { state.pending = null; },
    loadBridge: () => state.bridge,
    saveBridge: value => { state.saves++; state.bridge = value; },
    verifyBridge: async () => { state.verifies++; if (state.dnsFailed) throw Error('DNS not ready'); },
  };
  return { state, deps };
}
let passed = 0;
async function check(name, fn) { await fn(); console.log('PASS '+name); passed++; }
await check('Rejects domains, URLs and invalid labels before any change', () => {
  for (const value of ['https://rivalchess', 'rival.chess', '-name', 'name-', 'a'.repeat(64), 'UPPER', '../x', '', null]) assert.throws(() => dnsLabel(value));
  assert.equal(dnsLabel('rival-chess'), 'rival-chess');
});
await check('Changes only account subdomain and preserves credentials, destinations and journal namespace', async () => {
  const { state, deps } = fixture(), original = structuredClone(state.bridge);
  assert.equal(await changeSubdomain(plan, deps), newSite);
  assert.equal(state.pending, null);
  assert.deepEqual(state.bridge, { ...original, site: newSite, journalSite: oldSite });
  assert.equal(state.verifies, 1);
  assert.deepEqual(state.calls.filter(([, o]) => o.method), [[`/accounts/${plan.accountId}/workers/subdomain`, { method: 'PUT', body: { subdomain: plan.to } }]]);
});
await check('A lost rename response resumes without submitting the rename twice', async () => {
  const { state, deps } = fixture(); state.timeout = true;
  await assert.rejects(changeSubdomain(plan, deps), /timeout/);
  assert.deepEqual(state.pending, plan); assert.equal(state.bridge.site, oldSite);
  await changeSubdomain(state.pending, deps);
  assert.equal(state.bridge.site, newSite); assert.equal(state.pending, null);
  assert.equal(state.calls.filter(([, o]) => o.method === 'PUT').length, 1);
});
await check('DNS failure keeps the recovery record and stable delivery namespace', async () => {
  const { state, deps } = fixture(); state.dnsFailed = true;
  await assert.rejects(changeSubdomain(plan, deps), /DNS/);
  assert.equal(state.bridge.site, newSite); assert.equal(state.bridge.journalSite, oldSite); assert.deepEqual(state.pending, plan);
  state.dnsFailed = false; await changeSubdomain(state.pending, deps);
  assert.equal(state.pending, null); assert.equal(state.calls.filter(([, o]) => o.method).length, 1);
});
await check('An explicit unavailable-name rejection clears recovery only after confirming the old address', async () => {
  const { state, deps } = fixture(), originalApi = deps.api;
  deps.api = async (path, options) => { if (options?.method) { const e = Error('unavailable'); e.rejected = true; throw e; } return originalApi(path, options); };
  await assert.rejects(changeSubdomain(plan, deps), /unavailable/);
  assert.equal(state.current, plan.from); assert.equal(state.pending, null); assert.equal(state.saves, 0);
});
await check('Wrong database, changed account subdomain and unrelated bridge origin are blocked', async () => {
  for (const fault of ['database', 'subdomain', 'bridge']) {
    const { state, deps } = fixture(), originalApi = deps.api;
    if (fault === 'database') deps.api = (path, options) => path.endsWith('/settings') ? { bindings: [{ type: 'd1', name: 'DB', id: 'wrong-db' }] } : originalApi(path, options);
    if (fault === 'subdomain') state.current = 'unexpected';
    if (fault === 'bridge') state.bridge.site = 'https://unrelated.test';
    await assert.rejects(changeSubdomain(plan, deps));
    assert.equal(state.pending, null); assert.equal(state.saves, 0); assert.ok(state.calls.every(([, o]) => !o.method));
  }
});
await check('Account update without an iMessage setup needs no credentials or message operations', async () => {
  const { state, deps } = fixture(); state.bridge = null;
  assert.equal(await changeSubdomain(plan, deps), newSite);
  assert.equal(state.saves, 0); assert.equal(state.verifies, 0); assert.equal(state.pending, null);
});
await check('Previously delivered messages remain delivered through two address changes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rival-domain-'));
  try {
    const { state } = fixture();
    const journal = new Journal(directory, oldSite);
    journal.put('game:result', { chatGuid: state.bridge.groupChatGuid, parts: { text: { status: 'done' } } });
    const moved = moveBridgeSite(moveBridgeSite(state.bridge, oldSite, newSite), newSite, 'https://rival-room.third-name.workers.dev');
    assert.equal(moved.journalSite, oldSite);
    const acks = [];
    const status = await deliver({ id: 'game:result', kind: 'result', text: 'result', attempts: 2, leaseToken: 'test' }, moved, {
      journal: new Journal(directory, moved.journalSite || moved.site),
      bb: { text: () => { throw Error('must not resend'); } }, post: async value => acks.push(value),
    });
    assert.equal(status, 'sent'); assert.equal(acks[0].status, 'sent');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
console.log(`\n${passed} subdomain checks passed.`);
