import { siteOrigin } from './imessage-core.mjs';

export function dnsLabel(value) {
  if (typeof value !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)) {
    throw new Error('Use a lowercase name with letters, numbers, or internal hyphens, without dots.');
  }
  return value;
}

export function workerOrigin(worker, subdomain) {
  return `https://${dnsLabel(worker)}.${dnsLabel(subdomain)}.workers.dev`;
}

export function moveBridgeSite(bridge, oldSite, newSite) {
  if (!bridge) return null;
  const site = siteOrigin(bridge.site);
  if (site !== oldSite && site !== newSite) {
    throw new Error('The saved iMessage site does not match this Worker. No saved destinations were changed.');
  }
  // Journal filenames include the original site. Retain that namespace so a
  // confirmed message is never resent just because the public URL changed.
  return { ...bridge, site: newSite, journalSite: bridge.journalSite || oldSite };
}

export async function changeSubdomain(plan, { api, savePending, clearPending, loadBridge, saveBridge, verifyBridge }) {
  const { accountId, worker, from, to, databaseId } = plan;
  if (!/^[a-f0-9]{32}$/.test(accountId) || !databaseId) throw new Error('Invalid saved account or database.');
  const oldSite = workerOrigin(worker, from), newSite = workerOrigin(worker, to);
  const base = `/accounts/${accountId}/workers`;
  const readSubdomain = async () => dnsLabel((await api(`${base}/subdomain`)).subdomain);
  const current = await readSubdomain();
  if (current !== from && current !== to) throw new Error('The account subdomain changed elsewhere. Stop and check Cloudflare before continuing.');
  const settings = await api(`${base}/scripts/${worker}/settings`);
  if (!settings.bindings?.some(b => b.type === 'd1' && b.name === 'DB' && b.id === databaseId)) {
    throw new Error('This Worker does not use the database in cloudflare.local.json. Nothing changed.');
  }
  const bridge = loadBridge();
  const moved = moveBridgeSite(bridge, oldSite, newSite);
  savePending(plan);
  if (current !== to) {
    try { await api(`${base}/subdomain`, { method: 'PUT', body: { subdomain: to } }); }
    catch (error) {
      // A transport failure can hide a successful rename. Keep the recovery
      // record unless Cloudflare explicitly rejected it AND still reports old.
      if (error.rejected) {
        try { if (await readSubdomain() === from) clearPending(); } catch {}
      }
      throw error;
    }
  }
  if (await readSubdomain() !== to) throw new Error('Cloudflare has not confirmed the new subdomain. Rerun this command to resume.');
  if (moved) {
    saveBridge(moved);
    // Only the status endpoint is called: this never enables notifications,
    // claims jobs, sends messages, or changes any secret or player PIN.
    await verifyBridge(moved);
  }
  clearPending();
  return newSite;
}
