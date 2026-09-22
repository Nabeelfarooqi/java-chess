import { createHash } from 'node:crypto';
import { siteOrigin } from './imessage-core.mjs';
import { chatKind } from './imessage-chat-list.mjs';

export async function connectSavedBridge(config, { post, installHash, enableNotifications, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), progress = () => {} }) {
  siteOrigin(config.site);
  if (typeof config.bridgeToken !== 'string' || !/^[a-f0-9]{64}$/.test(config.bridgeToken)) throw new Error('Saved bridge token is invalid. Run imessage:setup to configure access again.');
  if (chatKind({ guid: config.groupChatGuid }) !== 'group' || !config.targets || Array.isArray(config.targets) || typeof config.targets !== 'object' || Object.values(config.targets).some(guid => chatKind({ guid }) !== 'direct')) throw new Error('Saved destinations are invalid. Run imessage:setup to select them again.');
  const status = async () => {
    const result = await post({ action: 'status' });
    if (![0, 1].includes(result?.settings?.enabled) || !Array.isArray(result?.jobs)) throw new Error('The site did not return a valid chess bridge status. Check the site URL and deployed migrations.');
    return result;
  };
  let connected = false;
  try { await status(); connected = true; }
  catch (error) { if (error.status !== 401) throw error; }
  if (!connected) {
    progress('The site rejected the saved token. Reinstalling its hash on the configured Worker...');
    // Keep the same token and destinations; do not invalidate saved journals or
    // replace player PINs. The raw bridge token never goes to Wrangler.
    await installHash(createHash('sha256').update(config.bridgeToken).digest('hex'));
    progress('Secret uploaded. Verifying the website connection...');
    const delays = [0, 2000, 3000, 5000, 10000, 10000];
    for (let attempt = 0; attempt < delays.length; attempt++) {
      if (delays[attempt]) await pause(delays[attempt]);
      try { await status(); connected = true; break; }
      catch (error) {
        if (![401, 503].includes(error.status)) throw error;
        if (attempt === delays.length - 1) throw new Error(`The chess site still returns HTTP ${error.status}. Your saved destinations are retained. Check that the Worker/account in cloudflare.local.json owns the saved site, then rerun npm run imessage:connect. Notifications were not enabled by this attempt.`);
        progress(`Website returned HTTP ${error.status}; retrying verification (${attempt + 1}/${delays.length - 1})...`);
      }
    }
  }
  if (!connected) throw new Error('The chess bridge could not be verified.');
  await enableNotifications();
  const verified = await status();
  if (verified.settings.enabled !== 1) throw new Error('The bridge is authenticated, but its database still reports notifications disabled. Check that the configured DB belongs to this Worker.');
  return verified;
}
