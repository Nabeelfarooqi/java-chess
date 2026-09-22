# Rival Room iMessage setup

This optional integration uses **BlueBubbles Server on your Mac**. The website stays on Cloudflare. Your Mac collects chess events and sends them through the Apple account already signed into Messages. BlueBubbles is free software; your existing Cloudflare limits and internet/electricity costs still apply.

No message is sent by installing the update or running the setup wizard. Delivery starts only when you run `imessage:start` after choosing destinations. It does not post as a separate bot: recipients see your signed-in Apple account as the sender.

## 1. Update the chess site

**Changing the free site address:** stop the sender, then run `npm run cloudflare:subdomain -- rivalchess` from your existing `web` folder. It previews the account-wide URL change, updates this Mac's saved chess URL, and keeps the token, chosen chats, and delivery journal. Resume with `npm run imessage:start` after verification succeeds. See [address setup and recovery](README.md#change-the-free-workersdev-address). No new chat selection or player PIN reset is needed.

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
4. This sender uses the basic AppleScript API for text messages to **existing** chats. Images start paused. Optional local pools use the same AppleScript attachment API; see [Meme pools](#meme-pools). It does not require BlueBubbles Private API features. A public tunnel, port forwarding, and a BlueBubbles phone client are unnecessary for this integration because both the sender and BlueBubbles run on the same Mac. Follow your installed BlueBubbles version's setup screens for any additional server configuration.

Choose your existing blue-bubble conversations. The wizard accepts both `iMessage;…` identifiers and the `any;…` identifiers returned by some Mac Messages databases. An `any` identifier means Messages selects the service for that existing conversation; it does not prove that the conversation uses iMessage. Explicit SMS/RCS identifiers remain excluded. See the [BlueBubbles FAQ](https://bluebubbles.app/faq/) for supported macOS versions and service limitations.

## 3. Connect the chess site and select recipients

In your existing `web` folder:

```sh
npm run imessage:setup
```

The wizard asks for:

- Your chess site's HTTPS address, such as `https://rival-room.nfarooqi090.workers.dev`.
- The local BlueBubbles URL and password (hidden while typed).
- Each player's exact existing **direct chat**, shown with participant addresses. Map Gud to Usman's conversation and Saif to Saif's. You can press Enter to skip Walan if you do not need messages to yourself.
- The exact existing **group chat** for game results: choose **FRQ**, checking its participant addresses against your intended group.

At each destination, search by chat name or phone/email before selecting its listed number. For an unnamed private chat, use the person's number/email from Contacts; phone searches ignore spaces, parentheses, and hyphens. Search `FRQ` for the results group. If more than one FRQ appears, each remains a separate choice with its participants and Chat ID. The wizard never chooses by name automatically. Type `/` at the number prompt to search again, or `SKIP` at a player's search prompt to skip that player's private notifications (for example Walan).

Review the displayed names and participant addresses, then type `SAVE`. The wizard stores the destinations on the Mac, installs a random bridge-token hash as a Worker secret, verifies the specified site, and enables future notifications. It sends no test messages. Starting the sender after a gap can deliver results queued since setup.

### Connection fails after SAVE (Chess bridge HTTP 401)

Your destinations and bridge token are saved **before** the website connection check. Resume without selecting chats or entering your BlueBubbles password again:

```sh
cd ~/Projects/java-chess/web
git pull --ff-only
npm run imessage:connect
```

The reconnect command first checks the saved token. If the site returns 401, it verifies that the configured Worker exists and reinstalls only `IMESSAGE_BRIDGE_HASH` from the same saved token. It retries 401/503 verification responses for up to six checks with 30 seconds of backoff, then enables notifications only after successful authentication and confirms the website reports them enabled. This also runs at the end of new setup. It does not change player PINs, chat selections, or the delivery journal, claim events, or send messages.

[Cloudflare secret updates deploy a new Worker version](https://developers.cloudflare.com/workers/configuration/secrets/#adding-secrets-to-your-project). A 401 immediately after an update does not identify whether the cause is a temporary update delay or a wrong target/token. If verification still fails, your destinations remain saved; check that the Worker name/account in `cloudflare.local.json` owns the saved chess-site URL. Do not reset the game database or player PINs. After `Connection verified. Notifications enabled.`, run `npm run imessage:start`.

### Chats exist in Messages but setup cannot find them

Run the read-only check on your Mac:

```sh
npm run imessage:chats
```

Press Enter for the local BlueBubbles URL and enter its password when prompted. No chess-site URL or Cloudflare login is required. This command sends no messages, changes no destinations, and saves no credentials. It reports the total returned by BlueBubbles, supported direct/group counts, redacted identifier formats, and up to 20 recent chat labels/types. It omits participant addresses and message bodies; chat display names remain visible.

An empty API response is different from chats that the wizard excludes as unsupported. If the total is zero, check BlueBubbles Full Disk Access and that Messages on the Mac is signed into the intended account, then use **BlueBubbles Logs → Manage → Full Restart**. If the total is nonzero but the required type is missing, use the diagnostic output to investigate the returned formats; do not recreate existing conversations or guess their identifiers. Older versions incorrectly excluded every `any;-;…` direct chat and `any;+;…` group. Current setup and delivery both accept these native formats, preserve the exact selected identifier, and still reject group/direct mismatches and conflicting chat metadata. They do not rewrite `any` to `iMessage`, merge duplicate names, or guess a destination.

Messages contact names are not always returned by the BlueBubbles chat API. Usman or Saif Hassan may appear as an unnamed chat with their phone number/email during setup; verify that address against Contacts before selecting. Gud maps to Usman, Saif maps to Saif Hassan, and results go to FRQ. The old generic “create the required iMessage chat” error did not establish that those conversations were missing; current setup prints the API counts and directs you to this check instead. The native-chat compatibility and diagnostic updates run only on the Mac and do not require redeploying the chess site. Stop any running sender, pull the update, complete setup, then run `npm run imessage:start`.

### Multiple FRQ groups have the same members

A higher Chat ID is a newer database row, not proof of the currently active conversation. Keep the setup wizard open at its group-number prompt. Open a second Terminal window with **Command+N**, then run:

```sh
cd ~/Projects/java-chess/web
git pull --ff-only
npm run imessage:groups
```

Enter the local BlueBubbles URL/password, then press Enter for `FRQ` (or enter a different group name). The check reports each matching group's **Chat ID and newest stored message time** in the Mac's timezone. Compare those times with the conversation you intend to use in Messages, then return to the original setup window and select the numbered entry with that Chat ID. It does not select a group automatically, and equal times do not resolve ambiguous threads. A failed lookup is shown as a failure, not as an empty chat.

This is read-only: no test messages, changed destinations, saved credentials, or Cloudflare changes. For each matching group it requests one latest-message object from the local BlueBubbles API and retains only its timestamp; message text, sender details, and attachments are discarded and never printed or saved. The report shows group names and member counts, without participant addresses. There is no need to restart setup or redeploy the site to run this check.

Only run one sender on one Mac. Stop it before rerunning setup to change destinations. Do not change destinations while resolving an uncertain delivery; the journal deliberately refuses to redirect an existing event into a different chat.

## 4. Run the sender

```sh
npm run imessage:start
```

Keep this Terminal window and BlueBubbles running. The sender checks about every ten seconds. It requests protection from idle sleep while running, but shutting down, closing the laptop lid, losing internet, or quitting Messages/BlueBubbles can interrupt delivery. **Ctrl+C stops the sender.** This release does not install an automatic background/login service. After restarting the Mac, start BlueBubbles and run the command again.

Once you are ready for real messages, challenge Gud or Saif from the site. Their configured DM receives the challenger name, time control, and link. Gud's destination is Usman's private conversation; Saif's is Saif's. Finish the game to send one text announcement to FRQ, selected above. Group announcements have no site link. They stay text-only unless you enable your local meme pools. Messages use Nabeel for Walan and Usman for Gud, without renaming the site's characters or changing their PINs or records.

Example group announcement (illustrative scores):

```text
Usman gooned on Nabeel.
Somebody’s about to blame the Wi-Fi 💀
Head-to-head: Usman 4 wins · Nabeel 3 wins · 1 draw
5+0 · Checkmate
```

Draws say the two players drew and update their draw total. The record counts only that pair's finished games, including this result, regardless of colors. Delayed announcements use the pair record as of that game's finish time. Images and meme pools are on hold; the owner can choose them later. When installing this text-only update, stop any older sender with Ctrl+C, pull/deploy, and restart it so the Mac also runs the new delivery code. Existing saved destinations remain valid.

Win announcements rotate through four owner-approved phrases, alternating "gooned on" and "beat [loser's name]’s ass", followed by a short joke. Draws rotate through three separate phrases without declaring a winner. Each pair's saved decisive-game count or draw count selects the next phrase, so retries and delayed delivery keep the same wording. All pairings, including Saif's, use the same pools. These are text templates; no AI service is involved. Images, if enabled, are chosen separately from your local pools. Edit `resultOpening` in `lib/server/imessage.ts` to change the wording.

The game works even when the sender is stopped. Finished-game announcements queue for later. Challenges already accepted, cancelled, or older than 15 minutes are skipped when checked for delivery. Games finished before notifications were enabled are not backfilled. An active game that finishes after setup can produce a result.

## Status and interrupted sends

From another Terminal window in `web/`:

```sh
npm run imessage:status
```

The latest 30 events show `pending`, `leased` (being processed), `sent`, `skipped`, or `needs_review`. A lease expires after five minutes if the sender stops abruptly. Confirmed texts are journaled locally and are not sent again merely because Cloudflare's acknowledgement failed. Text and selected image parts are journaled separately. A failed image never causes a confirmed text to be sent again. Older text-only journal entries stay text-only; no new image is added retroactively.

Failed sends now print a sanitized reason in the sender Terminal and save it in the status table: HTTP rejection, connection/timeout, an AppleScript error code, or a Messages send code. Raw API error bodies can contain credentials, addresses, and message text, so they are never printed or uploaded. An older generic `needs_review` entry cannot recover its original error; stop the sender, pull the Mac scripts, and review it before a manual retry. This update requires no Cloudflare deployment or repeat setup.

If a challenge is `sent` but the result is `needs_review`, the website queued both events and the group send needs investigation. Open the selected group in Messages and check whether the announcement is present, including among duplicate group threads. For a missing announcement, follow the manual retry below. An AppleScript `-1728` means a selected Messages object could not be found; verify the exact group rather than switching to another FRQ by name. `-1743` indicates Messages automation permission was denied. A timeout leaves delivery uncertain. For a generic HTTP 500 or a repeated failure, inspect BlueBubbles Logs around the attempt; share only the relevant error, with addresses and message text removed. Do not repeatedly requeue an uncertain send.

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

## Meme pools

First stop the old sender with Ctrl+C, pull the update, deploy the Worker, and restart `npm run imessage:start` so both ends have the new event timestamp and delivery code. In another Terminal window, from `web`:

```bash
npm run imessage:memes
```

This creates and opens `.imessage/memes` on the Mac. Put **your chosen images** in its `win`, `loss`, and `draw` folders. Accepts PNG, JPEG, and WebP, at most 8 MB / 20 megapixels per source and 100 files per pool. Animated WebP uses its first frame; GIF is not supported. These ignored folders and generated previews are local, not uploaded to GitHub or Cloudflare.

```bash
npm run imessage:memes -- preview
npm run imessage:memes -- enable
```

Preview opens a local HTML contact sheet and sends nothing. Enable asks for the perspective **player ID**, default `one` (Walan/Nabeel), displays the existing configured results destination, opens the preview, and asks for `ENABLE`. Do not enter a PIN as the player ID. `two` is Saif; added players use their configured IDs.

| Outcome | Pool |
| --- | --- |
| Your chosen player wins | `win` |
| Your chosen player loses | `loss` |
| Other players finish a decisive game | `win`, celebrating that winner |
| Anyone draws | `draw` |

The text always names the actual winner/loser and correct pair record. One image follows the text, to the already selected results group only. No meme goes to challenge DMs. An empty applicable pool means text only. Selection is deterministic per event from sorted filenames, then frozen in its delivery journal. Repeats across different games are possible. Rename/add/remove files to change future selections; keep `prepared` and `journal` for recovery.

```bash
npm run imessage:memes -- list
npm run imessage:memes -- pause
```

The running updated sender reads these settings for each job; no restart is needed just to enable/pause. Enabling applies only to results created afterward. Pausing keeps text announcements working. If an image is already in flight it cannot be recalled. Prepared PNGs are capped at 1200×1200 and metadata is stripped; the original image files are untouched. Invalid images pause that event before sending so you can fix the pool rather than send an unintended substitute.

If an image outcome is uncertain, the job becomes `needs_review` and is not blindly retried. Check the group in Messages, stop the sender, and use the existing `imessage:retry -- JOB_ID` flow only when appropriate. Confirmed text/image parts remain complete. If only the image failed, the retry uses the same prepared image and does not repeat the text. Existing pre-feature journal entries are never retrofitted with memes. Actual attachment delivery still depends on BlueBubbles, Messages permissions, and the Mac being awake; automated tests use mocks and send no real messages.
