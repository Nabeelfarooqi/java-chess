# Rival Room iMessage setup

This optional integration uses **BlueBubbles Server on your Mac**. The website stays on Cloudflare. Your Mac collects chess events and sends them through the Apple account already signed into Messages. BlueBubbles is free software; your existing Cloudflare limits and internet/electricity costs still apply.

No message is sent by installing the update or running the setup wizard. Delivery starts only when you run `imessage:start` after choosing destinations. It does not post as a separate bot: recipients see your signed-in Apple account as the sender.

## 1. Update the chess site

Apply the accompanying patch, or pull it after it has been pushed to your repository. Then:

```sh
cd ~/Projects/java-chess/web
npx pnpm@11.25.0 install --frozen-lockfile
npm run cloudflare:deploy
```

Keep your existing `cloudflare.local.json` and `rival-room-db`. Migration `0004_imessage_pin_tools.sql` adds a disabled notification queue and a per-player PIN-change trigger. It preserves existing codes, players, games, and scores. Do not rerun first-time setup or recreate the database.

You can now choose easier codes without setting up messaging:

```sh
npm run cloudflare:set-pin -- Walan
npm run cloudflare:set-pin -- Gud
npm run cloudflare:set-pin -- Saif
```

Each command asks for six digits twice, invisibly. The code is saved as a hash and only that person's old sessions/code are invalidated. Gud is Usman; `-- Usman` works too. Never include a real code in a command, commit, screenshot, or this document.

## 2. Prepare BlueBubbles on the Mac

1. Open **Messages** and sign into the Apple account you want to send from. Ensure your existing iMessage conversations with Gud and Saif, plus the intended group chat, appear there. Send any initial messages yourself if those conversations do not exist yet.
2. Install **BlueBubbles Server** using its [official installation guide](https://docs.bluebubbles.app/server/installation-guides/manual-setup) and [official releases](https://github.com/BlueBubblesApp/bluebubbles-server/releases). Follow its macOS permissions prompts, including access needed to read the Messages database and control Messages.
3. Set and save a BlueBubbles server password. Keep the server running. Note its local HTTP port; the usual local URL is `http://127.0.0.1:1234`.
4. This sender uses the basic AppleScript API for text and PNG attachments to **existing** chats. It does not require BlueBubbles Private API features. A public tunnel, port forwarding, and a BlueBubbles phone client are unnecessary for this integration because both the sender and BlueBubbles run on the same Mac. Follow your installed BlueBubbles version's setup screens for any additional server configuration.

Use an all-iMessage group for this version; SMS/RCS destinations are not supported by the setup wizard. See the [BlueBubbles FAQ](https://bluebubbles.app/faq/) for supported macOS versions and service limitations.

## 3. Connect the chess site and select recipients

In your existing `web` folder:

```sh
npm run imessage:setup
```

The wizard asks for:

- Your chess site's HTTPS address, such as `https://rival-room.nfarooqi090.workers.dev`.
- The local BlueBubbles URL and password (hidden while typed).
- Each player's exact existing **direct chat**, shown with participant addresses. Map Gud to Usman's conversation and Saif to Saif's. You can press Enter to skip Walan if you do not need messages to yourself.
- The exact existing **group chat** for game results.

Review the displayed names and participant addresses, then type `SAVE`. The wizard stores the destinations on the Mac, installs a random bridge-token hash as a Worker secret, verifies the specified site, and enables future notifications. It sends no test messages. Starting the sender after a gap can deliver results queued since setup.

Only run one sender on one Mac. Stop it before rerunning setup to change destinations. Do not change destinations while resolving an uncertain delivery; the journal deliberately refuses to redirect an existing event into a different chat.

## 4. Run the sender

```sh
npm run imessage:start
```

Keep this Terminal window and BlueBubbles running. The sender checks about every ten seconds. It requests protection from idle sleep while running, but shutting down, closing the laptop lid, losing internet, or quitting Messages/BlueBubbles can interrupt delivery. **Ctrl+C stops the sender.** This release does not install an automatic background/login service. After restarting the Mac, start BlueBubbles and run the command again.

Once you are ready for real messages, challenge Gud or Saif from the site. Their configured DM receives the challenger name, time control, and link. Finish the game to send the result text and PNG to the selected group. The image includes Walan/Gud artwork when those identities play, a neutral initial for Saif or another player, and the pair's wins/draws as of that result.

The game works even when the sender is stopped. Finished-game announcements queue for later. Challenges already accepted, cancelled, or older than 15 minutes are skipped when checked for delivery. Games finished before notifications were enabled are not backfilled. An active game that finishes after setup can produce a result.

## Status and interrupted sends

From another Terminal window in `web/`:

```sh
npm run imessage:status
```

The latest 30 events show `pending`, `leased` (being processed), `sent`, `skipped`, or `needs_review`. A lease expires after five minutes if the sender stops abruptly. Confirmed text/image parts are journaled locally and are not sent again merely because Cloudflare's acknowledgement failed.

If an event says `needs_review`, first inspect the intended conversation in Messages. BlueBubbles can time out after a send, so an automatic retry could duplicate it. Stop the sender with Ctrl+C. If the unconfirmed message is missing and you want to retry, copy the exact event ID from status:

```sh
npm run imessage:retry -- 'PASTE_JOB_ID_HERE'
```

Read the prompt and type `RETRY` only after checking. Restart with `npm run imessage:start`. Confirmed parts stay complete; only unconfirmed parts are retried. Leave the event paused if the message already arrived. If the process crashed and left a stale sender lock, run `imessage:start` once and stop it normally before using setup/retry.

## Storage and privacy

| Location | Contents |
| --- | --- |
| D1 `notification_outbox` | Event IDs, game references, delivery state; no recipient addresses or BlueBubbles password |
| D1 `notification_settings` | Whether new events should be queued |
| Worker secret `IMESSAGE_BRIDGE_HASH` | SHA-256 hash of a random 256-bit bridge token |
| Local `web/.imessage/config.json` | Bridge token, local BlueBubbles password, and selected chat identifiers |
| Local `web/.imessage/journal/` | Confirmed/unconfirmed delivery parts to prevent routine resend |

The `.imessage` folder is Git-ignored, restricted to your Mac user, and must not be committed or shared. Files containing credentials/journals are written with `0600` permissions. Retain the journal across restarts. The Worker verifies the bridge token before releasing events; normal players cannot read the queue. The local sender accepts only loopback BlueBubbles URLs. Setup reads chat names and participants, not conversation message bodies.

## Verification and implementation

`npm test`, `npm run typecheck`, and `npm run build` cover the application. The notification tests use disposable local databases and a mock BlueBubbles transport: they send **no actual iMessages**. Real delivery and macOS permission prompts still require the first check on your Mac.

The implementation follows the [official BlueBubbles API guide](https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks) and the server's [message router](https://github.com/BlueBubblesApp/bluebubbles-server/blob/f2e2286241a7c3b6617a82b37d4afaab4df3a6b9/packages/server/src/server/api/http/api/v1/routers/messageRouter.ts). It uses `/api/v1/chat/query`, `/api/v1/message/text`, and `/api/v1/message/attachment` with `method=apple-script`.
