import { siteOrigin } from './imessage-core.mjs';
import { dnsLabel, workerOrigin } from './cloudflare-subdomain.mjs';

/** Read-only proof that local Wrangler mutations target the saved public site. */
export async function verifyDeploymentIdentity(config, bridge, { whoami, api, accountId: accountOverride }) {
  const worker = dnsLabel(config.name);
  const accounts = (await whoami()).accounts;
  const accountId = config.account_id || accountOverride || (accounts?.length === 1 ? accounts[0].id : null);
  if (!/^[a-f0-9]{32}$/.test(accountId || '') || !accounts?.some(a => a.id === accountId)) throw new Error('Select the correct Cloudflare account_id before reconnecting.');
  const databaseId = config.d1_databases?.find(b => b.binding === 'DB')?.database_id;
  if (!databaseId || databaseId === '00000000-0000-4000-8000-000000000000') throw new Error('A real configured DB binding is required.');
  const base = `/accounts/${accountId}/workers`;
  const settings = await api(`${base}/scripts/${worker}/settings`);
  if (!settings.bindings?.some(b => b.type === 'd1' && b.name === 'DB' && b.id === databaseId)) throw new Error('Configured database does not match this Worker. Nothing changed.');
  const site = siteOrigin(bridge.site);
  const subdomain = dnsLabel((await api(`${base}/subdomain`)).subdomain);
  if (site !== workerOrigin(worker, subdomain)) {
    // Custom Domains are account-owned routes to a named production service.
    // https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/list/
    const domains = await api(`${base}/domains?hostname=${encodeURIComponent(new URL(site).hostname)}`);
    if (new URL(site).port || !Array.isArray(domains) || !domains.some(d => d.hostname === new URL(site).hostname && d.service === worker && d.environment === 'production')) {
      throw new Error('The saved site is not a verified domain of this Worker. Nothing changed.');
    }
  }
  const identity = { accountId, worker, databaseId, site };
  if (bridge.deployment && ['accountId', 'worker', 'databaseId'].some(k => bridge.deployment[k] !== identity[k])) throw new Error('Saved deployment identity changed. Review the account and database before reconnecting.');
  return identity;
}
