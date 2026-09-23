# Rival Room

A private chess club that accompanies the Java desktop game. Open the same link, enter your personal code, choose a rival, and play. No user accounts or ChatGPT login are required.

## Change the free workers.dev address

To replace the personal account name in `rival-room.nfarooqi090.workers.dev`, finish any active games and stop the Mac iMessage sender with **Ctrl+C**. From your existing `web` folder:

```bash
npm run cloudflare:subdomain -- rivalchess
```

The command uses your existing Wrangler login, lists the old and proposed URLs for **every Worker in that account**, and asks you to type `CHANGE`. If Cloudflare accepts the name, this game's address becomes `https://rival-room.rivalchess.workers.dev`. Availability is only confirmed by Cloudflare. If the name is taken, choose another, such as `playrivalchess`.

This changes the account subdomain, not the Worker name. It keeps the same deployment, Durable Objects, D1 database, PINs, secrets, and saved scores. No build or redeploy is needed. Other Workers' `workers.dev` links also change; their custom domains are unaffected. Replace old shared links, and sign in again on the new address using your existing PIN.

If iMessage is configured, its saved site URL is updated, its existing token and selected chats are retained, and the delivery journal keeps its original namespace to avoid resending confirmed messages. The command only checks bridge status; it never sends a message or enables notifications. After it succeeds, run `npm run imessage:start`.

If the connection times out or DNS has not updated, wait a minute and rerun the **same command**. An ignored local recovery file records the original account/Worker/database and requested address so the operation can resume without renaming twice. The sender stays blocked until verification completes. A name rejection leaves saved destinations unchanged. If Wrangler needs login, run `npx wrangler login`. For multiple Cloudflare accounts, set the existing game's `account_id` in `cloudflare.local.json` first.

The address follows [Cloudflare's Worker/account URL format](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/); it cannot become just `rivalchess.workers.dev`. The helper uses Cloudflare's [account subdomain API](https://developers.cloudflare.com/api/resources/workers/subresources/subdomains/methods/update/), and captures the Wrangler token privately without saving or printing it.

## Play

- 1-, 3-, 5-, or 10-minute games, optionally adding two seconds after each move.
- Opponent accepts before clocks start. Colors alternate separately for each pair of rivals.
- Drag pieces with a mouse or touch, or tap/click the source and destination. Legal moves, check, castling, en passant, and all promotion choices.
- Immediate local move feedback, live WebSocket updates, reconnect recovery, and one queued premove.
- Stockfish Game Review after a game, with evaluations, suggested lines, and explained move labels.
- Checkmate, stalemate, resignation, agreed draws, repetition and move-count draws.
- Games and clocks survive refreshes. Closing the browser does not stop the clock.
- Saved wins, losses, draws, recent history, individual PGN downloads and a full JSON backup.
- Choose from the club roster; each person can have one active game or challenge at a time. Different pairs can play simultaneously.
- PIN-linked characters: Walan’s green room, Gud’s red room, and Saif’s blue room, with their portraits, themed board halves, and character kings. Other rivals keep their own names and neutral artwork.
- Personal display names. One PIN belongs to each player; do not share your own PIN.

Optional iMessage notifications use BlueBubbles on your Mac: challenge links go to the chosen rival’s direct chat, and finished games send a text result with the updated pair record to your existing group. Images and memes start paused; choose, preview, and enable your local pools with `npm run imessage:memes`. Notifications stay off until you explicitly complete setup and run the sender. See [iMessage setup](IMESSAGE_SETUP.md).

## Smoother play and appearance

The header shows **Live** with the last WebSocket round-trip ping, **Backup sync** when HTTP is covering a reconnect, or **Reconnecting** when the game API cannot be reached. Tap it for the last move-confirmation time, which includes server work and is separate from socket ping, plus rival-display acknowledgement samples. These are actual samples, not a promised latency target.

Dragging updates once per animation frame and reuses board bounds until scrolling or resizing changes them. Unchanged game versions retain their object identity, and piece artwork is memoized. Tapped and opponent moves slide into place in 130 ms; castling animates both pieces. Dropped pieces settle immediately, and reduced-motion preferences disable those animations. Server validation and clock rules still apply.

On phones, larger portraits, a visible connection meter, and an outlined active player make the compact board easier to follow. **Room settings → Board style** offers Characters, Classic, and Slate. This browser remembers the selection; personal king artwork remains visible in every style.

Challenges show both characters. A finished game shows the winner or draw, the saved pair record, **Rematch** with the same clock, Game review, and PGN. A rematch sends a fresh challenge that the opponent must accept. The record card waits for the finished game's history update before showing updated totals.

Character images use committed WebP delivery copies: about **291 KiB combined instead of 1,744 KiB** (83% smaller). Original files remain available; dimensions and Saif's alpha transparency are preserved. To regenerate after replacing source artwork, run `node scripts/prepare-characters.mjs` from `web` and commit the resulting WebP files. This is transfer-size reduction, not a measured claim about live game latency.

## Club expansion: what to use next

| Feature | Where it is | Behavior |
| --- | --- | --- |
| Home-screen app | Club or Room settings → Add Rival Chess to home screen | Install prompt when supported; Safari Share → Add to Home Screen on iPhone. Same link and PIN. |
| Sounds | Room settings → Game sounds | Move, capture, check, result, and one alert when your clock reaches 10 seconds. Mute, volume, and a test button are saved in this browser. |
| Friends lobby | Club | Available, away, offline, playing, in a challenge, or between series rounds. Pick Challenge to return to the clock picker. |
| Leaderboard | Club | All-time W/L/D, win percentage, current/best winning streak, and most-played rival. Ranked by wins, then win percentage and games; this is not Elo. |
| Best of 3 / 5 | Play → Match format | First to 2 / 3 wins. Draws count in normal records but replay the series round. Each round needs the rival’s acceptance. |
| Mistake practice | Game review → Save my mistakes; then Club → Practice my mistakes | Saves up to 40 of your reviewed mistakes/blunders, then lets you find the engine move with hints, reveal, and saved completion. |
| Meme pools | Mac terminal → `npm run imessage:memes` | Your selected local win/loss/draw images; preview and explicitly enable them for future group results. Empty pools stay text-only. |
| Move delivery details | Tap the Live / connection indicator | Separate socket ping, server confirmation, and rival display plus acknowledgement samples. |

**Update an existing installation:** pull and run `npm run cloudflare:deploy`. Migration `0007_club_expansion.sql` adds presence, series, and practice storage. It preserves all existing accounts, PIN hashes, sessions, active games, and match results. Do not rerun the initial PIN generator. Stop the Mac sender with Ctrl+C before pulling and start it again afterward so it loads the updated delivery code. No new dependencies are needed for this release.

**Series:** both participants are reserved until someone wins the series or ends it between games. Colors alternate each actual game, including after a draw. Both can request the next round; a transaction and version check ensure only one challenge wins the race. Ending a series cancels any waiting round without declaring a series winner and keeps completed games in the normal record. An active game must finish first. Declining/expiring the initial challenge cancels the untouched series; a later declined/expired round leaves the series available to continue or end. The result card offers Next round or Rematch series as appropriate. Group announcements remain per game with the normal head-to-head record.

**Presence:** visible tabs heartbeat every 25 seconds, with at most one write per session per 15 seconds. A valid session seen within 45 seconds is online, within three minutes is away, otherwise offline. This is approximate browser presence, not a guarantee that a person is looking at their screen. Club refreshes every 30 seconds while visible; normal room snapshots also refresh presence. Multiple tabs can keep the same profile online. No contact addresses or session details are exposed.

**Practice:** positions are reconstructed from your saved finished game on the server. Only your own moves can be imported, and the proposed alternative must be legal. Engine evaluations come from your local review; the server does not independently run Stockfish. The goal is the saved engine choice, not proof that every other move is bad. Another good move can exist, and a deeper review can change the answer. A changed answer resets completion; saving the same answer preserves it. At most 100 positions are shown at once, with unsolved ones first. Practice and review close while a live game/challenge needs attention. Full JSON exports now also include your series history and all practice positions/progress.

**Install and offline behavior:** the build generates install icons from the bundled, attributed knight SVG. The service worker caches only the public offline notice, manifest, and install icons. It never caches authenticated HTML, API replies, PINs, or game state. Offline opening shows a reconnect notice; online play and clocks still require the server. Installation and audio playback depend on browser support; audio unlocks after interaction with the page. A muted or background tab does not play sounds.

**Delivery measurements:** a move gets a random measurement ID. After the rival’s visible tab commits the position and passes two animation frames, it sends an authenticated acknowledgement through the same player hubs. Only a receipt for a move actually delivered to that socket is accepted, once, with a 30-second expiry. The sender measures elapsed time on its own monotonic clock, retaining up to 20 samples for last/median/95th percentile. This includes the acknowledgement’s return trip; it is an upper-bound-style diagnostic, not exact one-way delay or proof that the person saw the move. Hidden tabs, HTTP-only recovery, and expired samples are excluded. Samples stay in browser memory and do not adjust chess clocks.

## Deploy to your own Cloudflare account

This is a **Cloudflare Worker with D1 and a WebSocket Durable Object**. The Worker runs independently of your PC and serves a `workers.dev` link. A custom domain can be added later.

Install Node.js **22.13 or later**, then open the `web` folder in a terminal (IntelliJ's Terminal is fine):

```sh
npx pnpm@11.25.0 install --frozen-lockfile
npm run cloudflare:setup
npm run cloudflare:deploy
npm run cloudflare:pins
```

1. **Setup** opens Cloudflare's own login in your browser, then creates `rival-room-db`. It stores the database binding in ignored `cloudflare.local.json`. If you have several Cloudflare accounts, select the one that should own the game.
2. **Deploy** first checks the configured migrations with the installed Wrangler SQL splitter against a disposable local SQLite database. If they pass, it prepares the pinned review engine, builds the Worker, applies only pending D1 schema migrations, and publishes. A failed preflight stops before building or touching Cloudflare. The build config adds the `LIVE_PLAYERS` Durable Object binding and its `player-live-v1` migration automatically; existing local Cloudflare configurations work without editing. Keep the `workers.dev` URL that Wrangler prints.
3. **PINs** generates two different random codes, uploads only salted PBKDF2 hashes as Worker secrets, revokes Walan and Saif’s sessions, and prints the codes in your local terminal. Save them in a password manager. Send your friend the URL and their code. Do not put the codes into GitHub or this README.

Until PIN hashes are configured, the room refuses entry. Running `cloudflare:pins` again **replaces both codes**; it does not reset the scores. Do not run it in CI: it requires an interactive terminal to keep codes out of CI logs.

For future updates, run from your existing checkout:

```sh
cd ~/Projects/java-chess/web
git pull --ff-only
npx pnpm@11.25.0 install --frozen-lockfile
npm run cloudflare:deploy
```

Keep using the same D1 database. Creating or selecting a different database would create a different record. Do not delete `rival-room-db` if you want to retain your history.

### Recover from the 0007 migration error

If the club update stopped at `0007_club_expansion.sql` with `incomplete input: SQLITE_ERROR [code: 7500]`, pull the latest follow-up repair. The first fix replaced a `CASE` expression that broke the **local** Wrangler splitter, but did not establish that remote D1 would accept the migration. `migrations apply --remote` sends the whole SQL file to Cloudflare's query endpoint, where it is parsed again; it does not use the local splitter.

Cloudflare documents [remote failures for multiline triggers](https://github.com/cloudflare/workers-sdk/issues/4998) and a [remote-specific CRLF parsing fix](https://github.com/cloudflare/workers-sdk/pull/15044). The pinned Wrangler 4.92.0 predates that fix. The follow-up keeps all seven `0007` triggers on single lines, replaces the remaining guard `CASE` expressions with equivalent `SELECT RAISE ... WHERE` statements, and adds `.gitattributes` to enforce LF for SQL checkouts. Do not reformat these triggers into multiline bodies without rechecking remote compatibility. These changes address the documented compatibility risks; the exact cause on your Mac still requires its latest command output.

Stop the iMessage sender with Ctrl+C if it is running, then run:

```sh
cd ~/Projects/java-chess/web &&
git pull --ff-only &&
git log -1 --oneline &&
npm run cloudflare:deploy &&
npm run imessage:start
```

Cloudflare [rolls back a failed migration](https://developers.cloudflare.com/d1/wrangler-commands/#d1-migrations-apply), keeping earlier successful migrations. No database reset, manual migration-table changes, setup rerun, or PIN rotation is needed. An installation that already applied `0007` skips it as usual; the trigger's scoring behavior is unchanged. The script publishes the Worker only after migrations succeed. Local verification covers parsing, rollback/retry, and preservation of existing data; it does not connect to your production database.

If it still fails, include the printed commit line, the migration preflight result, and the complete final error block when reporting it. Those identify the checked-out revision and whether the failure happened locally or at Cloudflare.

### Existing D1 database

If the database already exists, do not create a replacement. Copy `cloudflare.template.json` to `cloudflare.local.json`, add the binding below using the existing database's **actual** ID, then deploy:

```json
"d1_databases": [{
  "binding": "DB",
  "database_name": "rival-room-db",
  "database_id": "YOUR_EXISTING_DATABASE_ID",
  "migrations_dir": "drizzle"
}]
```

The deploy script refuses a placeholder database ID. The original two PIN hashes are runtime secrets: `PIN_ONE_HASH` and `PIN_TWO_HASH`. Additional players and chosen six-digit PINs use `players.pin_hash` in D1; see below.

## Add Usman (Gud) or another rival

For an existing deployment, pull the latest code and run `npm run cloudflare:deploy` first. The migrations preserve player IDs, PINs, sessions, games and scores, including a game already in progress. Nabeel is Walan, Usman is Gud, and Saif retains his own profile. The corrective character migration updates these display names without transferring identities or scores.

If Usman already has a code, deploying the correction is enough; keep using that code. To invite him on a new installation, run this in your Mac terminal:

```sh
npm run cloudflare:add-player -- Usman
```

The command creates Usman’s profile as **Gud**, attaches the red character to its generated player ID, and prints his personal **12-digit PIN once**. Save it and send him the site link and that code. Refresh the site to see him under **Play against**. Repeat with another name to invite more people:

```sh
npm run cloudflare:add-player -- "Another Friend"
```

Adding someone does not change anyone else’s code or scores. Existing codes keep working until you change them. The original Walan/Saif codes are eight digits, and new players receive twelve-digit codes. Use `cloudflare:set-pin` below to choose a six-digit code for any existing player. The server uses a randomly salted PBKDF2 derivation with an indexed hash lookup; plaintext PINs are not stored. Only someone with your Cloudflare account access can use this terminal command. A duplicate name is rejected, rather than silently replacing an existing identity. A player can change their display name in settings without changing their PIN or records.

**Do not use `cloudflare:pins` to add a friend.** That older command rotates Walan and Saif’s original PINs and removes their chosen-code overrides and revokes only their sessions; it does not add players or erase scores. New-player codes cannot be recovered from storage, so save them when displayed.

Database triggers reserve one seat per player atomically and release it with a finished/cancelled game. These triggers are part of `drizzle/0001_multiple_rivals.sql`; preserve them when editing future schema migrations.

## Choose an easier PIN

After deploying this update, run any of these in `web/`:

```sh
npm run cloudflare:set-pin -- Walan
npm run cloudflare:set-pin -- Gud
npm run cloudflare:set-pin -- Saif
```

Each command asks for exactly **six digits**, twice, with input hidden. Leading zeros work. `Usman` also selects Gud through his saved character identity; an exact player ID works if names are ambiguous. The command refuses a code already belonging to someone else. Do not put the PIN after the command: this keeps it out of shell history.

Changing a code preserves that person’s ID, character, active game, and all scores. It invalidates only that person’s sessions and old code; the other players stay signed in. Setting the same chosen code again makes no change to existing sessions. Both the new six-digit codes and unchanged older codes are supported by the entry page.

| Code | Stored in Cloudflare |
| --- | --- |
| Walan/Saif’s original eight-digit codes | Worker `rival-room` → Settings → Variables and Secrets: `PIN_ONE_HASH` / `PIN_TWO_HASH` |
| Additional players’ twelve-digit codes | D1 `rival-room-db` → `players.pin_hash` |
| Anyone’s chosen six-digit code | D1 `rival-room-db` → `players.pin_hash` |
| Shared random salt for D1 PINs | D1 `rival-room-db` → `pin_settings` |

These are one-way salted PBKDF2 hashes, **not readable codes**. The command derives and saves the replacement hash; typing a plain PIN into the database will not work. For Walan/Saif, a D1 PIN override disables their old Worker-secret code. Avoid `cloudflare:pins` when changing one person: it resets both original players to newly generated eight-digit codes.

## Optional iMessage notifications

Follow [IMESSAGE_SETUP.md](IMESSAGE_SETUP.md) after deployment. The Mac sender pulls authenticated events from Cloudflare and talks only to a local BlueBubbles server. The chess site never receives your BlueBubbles password or contacts. This requires a Mac online with Messages, BlueBubbles, and the Terminal sender running; the website and games continue working without it.

If setup cannot find chats that already exist in Messages, run `npm run imessage:chats` on the Mac. It reports the raw API chat count, supported destination counts, and redacted chat formats without sending messages or changing Cloudflare. Contact names may appear as phone numbers/emails in the selection list. See the troubleshooting section in [IMESSAGE_SETUP.md](IMESSAGE_SETUP.md); a missing selection does not mean you need to recreate the conversation.

Setup and delivery support native `any;-;…` direct chats and `any;+;…` groups as well as `iMessage` identifiers. The selected identifier is preserved exactly; Messages decides the transport for `any` chats, so choose your existing blue-bubble conversations. Search by name or phone/email and confirm the exact numbered destination. Duplicate group names remain separate, and a group can never be used as a private challenge destination. This compatibility fix needs a Mac update/restart, not a Cloudflare redeployment.

For duplicate FRQ entries with the same members, keep setup open and run `npm run imessage:groups` in a second Terminal window. It compares each matching group's latest stored message timestamp without printing message content or sending anything. Match the intended group's Chat ID back to the numbered setup choice; neither a newer database ID nor a tied timestamp is treated as an automatic selection.

If setup fails with `Chess bridge returned HTTP 401` after `SAVE`, run `npm run imessage:connect` to resume from the saved destinations. It checks the current token, reinstalls its Worker hash only if rejected, and allows bounded verification retries before enabling notifications. It preserves player PINs and the delivery journal and sends no messages; start the sender after connection succeeds.

If a group result pauses as `needs_review`, `imessage:status` and the sender Terminal report sanitized HTTP, AppleScript, or Messages error details. Check the destination conversation before a manual retry; unknown outcomes are never automatically resent. Pull/restart the Mac scripts for this diagnostic update; old entries retain their original generic detail. See [status and interrupted sends](IMESSAGE_SETUP.md#status-and-interrupted-sends).

A new challenge sends the challenger’s name, time control, and site link privately to the opponent’s mapped direct chat. A finished game sends one text announcement to the chosen existing group: who beat whom (or drew), their updated head-to-head wins and draws, and the time control/result reason. Messages use **Nabeel** for the saved Walan identity and **Usman** for Gud; site names and PIN ownership stay unchanged. The group result contains no site link. Images stay off until you choose and enable your local meme pools. Newly enabled images apply only to future results; existing journal entries remain text-only. See the meme-pool commands in [iMessage setup](IMESSAGE_SETUP.md#meme-pools).

The pair record includes the announced game and earlier finished games between those same two players, regardless of their colors. Other opponents' results are excluded. A queued announcement uses the record as of that game's finish time. Draws are listed separately from wins.

Owner-approved group text rotates between four win phrases (alternating "gooned on" and "beat [loser's name]’s ass") and three draw phrases. Rotation is per pair, based on saved results, so retries retain their wording. Private challenge text remains a straightforward invitation. Templates live in `resultOpening` in `lib/server/imessage.ts`; no AI service is used. Optional images come only from your selected local pools.

For this club, map **Gud to Usman's direct conversation**, **Saif to Saif's direct conversation**, and select **FRQ** as the results group. Check the listed participants before saving; the code never guesses chat destinations from a name. Walan remains Nabeel and can skip self-notifications. This integration sends through the Apple account signed into Messages on the Mac. It does not create a separate bot identity.

The queue is disabled by default and does not announce historical games. Cancelled, accepted, or expired challenges are skipped before delivery. Results wait while the Mac is offline. Database triggers enqueue each event with the saved game transaction; a lease and a local delivery journal prevent routine reconnects from resending confirmed parts. If BlueBubbles might have sent a message but did not confirm it, the event pauses for manual review instead of being blindly retried. No external messaging system can promise exactly-once delivery across every interruption.

## Spectator PIN

Spectators use a separate shared **six-digit** code. Open the normal site, click **Watch as spectator**, and enter that code. They can choose an active game, watch its board/clocks/captures, flip their view, and see the result when their selected game finishes. Live positions refresh about once per second while the tab is visible. A waiting screen appears when no games are active; private pending challenges are excluded.

Deploy the update first, then create or change the spectator PIN from your Mac:

```bash
npm run cloudflare:spectator-pin
```

The command asks for six digits twice with input hidden. Share that code with viewers; keep personal player codes private. It cannot match a player's chosen PIN. Running the command with a different code immediately revokes existing spectator sessions; using the same code preserves them. To turn spectator access off:

```bash
npm run cloudflare:spectator-pin -- --disable
```

Spectator access is disabled until configured. Viewer sessions expire after 12 hours and have their own cookie and database table. Viewers never become players or appear in the rival picker, cannot submit moves/challenges/profile changes/draws/resignations, and cannot access player exports, player WebSockets, or the messaging bridge. Ordinary server clock expiry still settles games just as it does on a player's page. Rotation, logout, and disabling affect spectator sessions only; player PINs, sessions, identities, and records are preserved.

`/watch` is the spectator page and `/api/spectate` is its read-only game endpoint. Migration `0006_spectator_access.sql` adds the settings/session tables and rejects player/spectator PIN collisions in the database. Spectator code changes store only a PBKDF2 hash, never the readable code. Both views use the existing game records; no duplicate scores or spectator accounts are created.

## Walan, Gud, and Saif characters

| Existing PIN owner | Display name | Character |
| --- | --- | --- |
| Nabeel (original ID `one`) | Walan | Green shirt |
| Usman (his generated player ID) | Gud | Red hoodie |
| Saif (original ID `two`) | Saif | Turquoise drawing with transparent background |

Signing in selects your room theme, portrait, and “You are” name. The other player’s portrait appears beside their clock. The board’s four home ranks use their owner’s green, red, or blue palette. Walan, Gud, and Saif’s drawings fill their king pieces, with a small white/black SVG king badge showing their chess color. Other pieces use fixed white/black SVG artwork, including pawns, so iOS cannot substitute emoji or hide the chess color.

Characters are saved on the player record in D1 and sent with the authenticated roster. They follow each game’s white/black assignments through rematches, board flips, dragging, premoves, and Game Review. Changing a display name never transfers the character, PIN, or scores; a unique index prevents assigning the same character twice. Other rivals use their own names, initials, and standard pieces.

**Saif artwork update:** deploy normally. `0005_saif_character.sql` assigns the transparent drawing only to original player ID `two`, even if he has changed his display name. It does not match other players named Saif or change any names, PINs, sessions, games, or scores. Fresh installations assign his character when the original players are first created.

**Earlier character migrations:** `0003_gud_usman.sql` corrects the previous character release: it restores Saif’s name, gives the existing Usman profile the Gud name/artwork, and retains Walan. The migration locates Usman once by his current Usman/Gud name among additional players, then saves the assignment on that same ID. It does not guess if multiple profiles match. Fresh installations assign Gud when Usman is first added with the existing add-player command.

This update preserves every player ID, PIN hash, session, active seat, and game record. Refresh an already-open tab after deployment. Do **not** run `cloudflare:pins` or create another Usman profile for this correction.

The Walan/Gud JPEG drawings are stored unchanged in `public/characters/`. Saif’s `saif.png` is a transparent cutout made from the supplied drawing; his pale blue portrait frame keeps its dark outlines readable without a black background. CSS contains his whole drawing and crops the older posters. These are ordinary public site assets. `lib/characters.ts` resolves the stored character key to artwork, while `app/characters.css` defines the palettes and portrait framing.

## Board controls and premoves

- **Move:** drag a piece onto a legal square, or click/tap its square and then the destination. Keyboard Tab and Enter/Space also work. Illegal moves snap back.
- **Castle:** move the king two squares toward the rook (`e1–g1`, `e1–c1`, `e8–g8`, or `e8–c8`), or tap/drag the king onto its rook. Both gestures submit the same king move; the rook follows automatically. The path must be clear, both pieces must be unmoved, and the king cannot castle out of, through, or into check. A blocked castling gesture explains these requirements instead of silently selecting the rook.
- **Premove:** while the opponent is thinking, drag or select your next move. The highlighted queue holds one move; another choice replaces it. Promotion asks which piece to use.
- **Cancel:** press Escape, right-click the board, or use **Cancel** beside the queued move.
- A premove is rechecked when your turn arrives. If it is illegal, the game ends, the connection fails, or you change games, it is cancelled. The tab must remain open for the queue to run. It uses normal server clock timing; zero-time premoves and network lag compensation are not implemented.
- **Flip board** changes your view without changing identity, color, or turn. Your PIN continues to identify your own name and scores.

Captured pieces appear beneath the player who took them, grouped by piece type with repeat counts. A `+N` badge shows only the leading player’s net material advantage (pawn 1, knight/bishop 3, rook 5, queen 9). The score uses the current board, so exchanges, en passant, and promotions are counted correctly. The display follows player colors through board flips and survives refreshes from saved game history.

On phones, active games use compact player/clock rows, a board sized to the available viewport, and a short turn/control bar. Tap the question-mark button for castling and premove instructions. A queued premove retains its visible Cancel button. Draw/resign controls appear above the move list, and safe-area padding accommodates iPhone screen cutouts. Pinch zoom remains enabled.

Piece artwork: Colin M. L. Burnett’s cburnett set from Lichess, distributed unchanged under GPL-2.0-or-later. Attribution, source, and the license accompany the SVGs in `public/pieces/`.

## Game Review

After a game, choose **Game review** on the result or under **The record**. The review workspace keeps your characters on the board and adds:

- **An evaluation timeline:** drag or use the slider's arrow keys to revisit any position. All scores use White's perspective; positive favors White. The graph is a pawn-score display capped at ±6, not a win probability.
- **Key moments and All moves:** jump to mistakes, blunders, inaccuracies, and brilliant moves, or filter to your side. Player cards show reviewed move counts, best moves, mistakes, blunders, and average loss in pawns. Forced-mate evaluations are excluded from that average.
- **Compare move arrows:** see the engine's choice in teal and your played move in orange, on the position before the move.
- **Playable engine lines:** tap any move in a candidate line or explore the reply to the played move. The board shows that continuation without changing the saved game.
- **Try a better move:** play either side, undo, promote to any piece, ask for a hint, or analyze your continuation. The starting game and its record stay unchanged. Matching the first engine choice is feedback, not proof that every other move is bad.
- **Deepen this move:** spend two seconds comparing up to three candidates, then 1.5 seconds checking the played position. This improves the selected turning point without restarting the entire review.
- **Save my mistakes for practice:** retains the existing import of up to 40 of your reviewed mistakes/blunders into Club → Practice my mistakes.

The first pass spends about 250 ms per position; **Deeper review** spends one second per position. Actual duration and depth depend on the device. Stop pauses the work; **Resume review** fills missing positions. Existing evaluations remain visible during refinement. Closing the review cancels its worker and pending downloads. Up to 12 game/engine combinations are cached in the current tab, including partial results; reloading clears those analysis results. Analysis is available only for finished games.

### Free engine choices

**Stockfish 19 Lite** remains the default, with a roughly 1.8 MB initial engine download. Under **Engine strength**, explicitly choose **Load Full · 99 MB** for the full Stockfish 19 evaluation network. It is a 99 MB download (94.5 MiB), uses more memory, and is best suited to a computer. Both variants are single-threaded browser workers: no paid API, analysis server, subscription, or new Cloudflare service is required. Full does not download just because you open a Lite review. Switching engines keeps their evaluations separate and returns to the start of the review. Full's downloaded binary is reused within that open review and released when you close it or change engines; subsequent transfers depend on the browser's HTTP cache. If Full fails, use **Lite instead**.

The first development/build downloads both pinned Stockfish.js 19.0.0 variants from `unpkg.com` and verifies SHA-256 hashes. The complete Full WASM is cached outside public assets, then split into five files of at most 20 MiB to fit Cloudflare's per-asset limit. The browser verifies and reassembles the original binary byte-for-byte, with progress and cancellation. No large engine file is added to Git. Deploying this update takes a larger initial asset upload; later builds reuse the verified cache. A modern browser with WebAssembly and Web Workers is required. Ordinary Workers/D1/live-game free-tier limits still apply to the website.

Labels are **Best, Excellent, Good, Inaccuracy, Mistake, Blunder, Forced**, and a custom **Brilliant** sacrifice heuristic. Inaccuracies lose at least 0.5 pawns, mistakes 1 pawn, and blunders 2 pawns compared with the evaluation before the move, from the mover's perspective. Best matches the engine's first choice; Forced is the only legal move. Brilliant requires an engine-best, sound offer of a more valuable piece, depth 12 or higher, and little evaluation loss. These are Rival Room's estimates, not Chess.com's ratings. Deeper analysis may change them. There is no invented accuracy percentage or Elo estimate.

The unmodified engine is GPL-3.0; its license and exact corresponding source links are served at `/engine/Copying.txt` and `/engine/SOURCE.txt`, and linked inside the review. See [Stockfish.js upstream](https://github.com/nmrugg/stockfish.js).

**Update:** pull and run `npm run cloudflare:deploy`. This review release adds no migration and needs no PIN changes or iMessage setup. `npm test` includes review ranking/classification/variation checks; `npm run test:review:engines` additionally prepares the assets, verifies Full's download/reassembly lifecycle, and runs both actual WASM engines through UCI. Build, type checks, existing multiplayer tests, and a DOM interaction smoke check passed. The available browser could not access the local preview, so real iPhone rendering and browser Worker loading still need an on-device check after deployment.

## Records and backups

D1 stores authoritative games and sessions. Scores are calculated from finished games, so repeating a finish request cannot award extra wins. Each player’s all-time totals include only games they played. Head-to-head scores cover only the selected pair. History and exports include only your own games; the screen lists your latest 20 finished games. Cancelled challenges are excluded.

Use **The record → Export all** for a complete JSON backup and **Save PGN** for an individual chess game. Storage is durable, not a promise of literal permanence: retain backups and the Cloudflare account/database. Automatic off-account backups and restore/import are possible follow-ups.

## Rules and limitations

- The server validates every move and uses its own clock. Client-supplied board positions, results, player IDs, and clocks are not accepted.
- Committed moves are pushed to both players over authenticated WebSockets. Local legal previews respond immediately; the server still decides the saved position and result. Old responses cannot rewind a newer game version. Lightweight polling recovers missed messages and settles timeouts: normally every five seconds with a live socket (previously two), or about every 350 ms plus request time during active play without one. An additional clock-deadline check and shorter polling near zero settle flag falls without waiting five seconds. Full roster/history refreshes run separately. Actual latency depends on your network and Cloudflare region; no production latency target is promised.
- Threefold repetition and the 50-move rule are automatic draws, using chess.js's online-game convention.
- On timeout, the result is drawn if the non-flagging side has only a king, a single bishop or knight, or bishops all on one color; otherwise it wins. This is a practical room rule, not a full FIDE possible-mate adjudicator.
- A disconnected player's clock continues. If both leave, a timeout is recorded the next time the room is requested or the enabled Mac sender checks for events, using the persisted clock state.
- Challenges expire in 15 minutes. Session access lasts up to 12 hours or until Lock room is clicked. Browsers may restore session cookies; use Lock room on a shared device.
- The entry page is reachable without an account. All game data, exports, player changes, and moves are protected by server-verified sessions.
- PIN attempts are limited by IP and globally; sessions use random tokens stored hashed, with HttpOnly, SameSite=Strict, Secure cookies on HTTPS. Writes require a same-origin JSON request.
- WebSocket notifications, recovery polling, and game actions consume Cloudflare Worker, Durable Object, and D1 resources. Cloudflare account quotas and service availability still apply; the chess game itself needs no desktop server. Optional iMessage delivery needs your Mac, and Cloudflare usage still counts toward your account limits.

## Development and checks

```sh
npm run db:check
npm run test:migrations
npm test
npm run typecheck
npm run build
```

The club release passes 66 integration checks, real Workers WebSocket/series tests, 24 mocked messaging checks, component presentation tests, offline-cache/icon/sound tests, subdomain regression tests, TypeScript checking, and a production build. The remote preview browser could not reach the local preview, so this release does not claim an on-device iPhone visual/audio/install verification. Test iPhone installation and real BlueBubbles image delivery on your devices after deploying.

Migration checks reproduce the **local** `0007` parsing failure with the old `CASE` spelling, verify rollback and the corrected retry, and preserve sample player/PIN data, sessions, active games/seats, completed records, spectator access, and queued notifications. They also check the single-line compatibility format and directly exercise valid rounds and invalid seat, round, clock and participant combinations after removing guard `CASE` blocks. `npm test` includes these checks. Preflight is an early compatibility check, not a substitute for production D1 validation; the deploy still stops if Cloudflare rejects a migration.

The repair was also verified with the actual Wrangler 4.92.0 CLI against a disposable local D1 database: the old trigger failed, its schema changes rolled back, the corrected migration applied while retaining sample PIN/session data, and a repeat apply correctly found nothing pending. A separate deployment check confirmed that invalid SQL stops the script before its build or remote commands.

Tests use disposable local SQLite databases and the local Workers/Miniflare runtime bundled with Wrangler. They verify access control, CSRF protection, rate limiting, multiple PIN identities, participant authorization, independent pair scores, safe upgrades and character renaming of existing records, character ownership across color swaps, legal moves, special moves, checkmate, draws, clock expiry, concurrent writes, session revocation, persistence after reopening the database, castling on both sides for both colors, premove legality, stale response handling, stable duplicate-game updates, clock-aware polling, result-card pairing/freshness, connection status, review classification, and authenticated WebSocket delivery/revocation. They also check six-digit PIN replacement and duplicate rejection, notification migrations/leases, stale challenge suppression, result scores, uncertain sends, retry journals, documented BlueBubbles request formats, and PNG rendering. Spectator checks cover disabled access, code collisions, origin/rate limits, live game selection, blocked player/notification actions, persistence, session expiry, rotation/disable/logout, and denial of player WebSocket access. They do not contact your Cloudflare account or send real messages. Live Apple Messages permissions and delivery must be checked on the Mac after setup.

The app uses React, TypeScript, Vinext, chess.js, Cloudflare D1, WebSocket Durable Objects, and a separately loaded Stockfish browser worker. The original Java Swing game remains in the repository root and opens normally in IntelliJ.

## Source map

| File | Responsibility |
| --- | --- |
| `worker.ts` | Cloudflare entry point, game API routing, authenticated WebSocket upgrades. |
| `lib/server/api.ts`, `store.ts` | Request validation, authoritative D1 transactions, and compact/full snapshots. |
| `lib/server/player-live.ts`, `live.ts` | Per-player notification hubs and post-commit broadcasts. |
| `app/use-room.ts`, `lib/room-update.ts`, `lib/connection.ts` | Fetching, reconnects, measured ping, clock-aware polling, and stale-version protection. |
| `app/connection-meter.tsx`, `app/match-result.tsx`, `app/play-polish.css` | Connection feedback, character matchups, result/rematch card, mobile polish, and board styles. |
| `app/chess-board.tsx`, `lib/board.ts` | Mouse/touch input, legal previews, castling input, and premoves. |
| `lib/characters.ts`, `app/character-art.tsx`, `app/characters.css` | PIN-identity artwork, character kings, board camps, and room palettes. |
| `app/player-clock.tsx` | Clock updates isolated from board rendering. |
| `app/game-review.tsx`, `app/review-widgets.tsx`, `app/review.css`, `lib/review*.ts`, `lib/use-game-review.ts` | Review workspace, engine choices, verified asset loading, variations, and move-label heuristics. |
| `lib/server/imessage.ts`, `drizzle/0004_imessage_pin_tools.sql` | Authenticated notification queue, committed-game triggers, and per-player PIN revocation. |
| `scripts/set-pin.mjs`, `cloudflare-admin.mjs` | Hidden personal PIN replacement and Cloudflare administration. |
| `scripts/imessage-*.mjs`, `bluebubbles-client.mjs`, `winner-card.mjs` | Local setup, sender, delivery journal, and result image rendering. |
| `lib/club.ts`, `lib/series.ts`, `drizzle/0007_club_expansion.sql` | Presence, leaderboard calculations, atomic series seats/results and practice storage. |
| `app/club-hub.tsx`, `app/series-banner.tsx`, `app/practice-room.tsx`, `lib/server/practice.ts` | Club interface, series controls, and private practice API. |
| `app/use-game-sounds.ts`, `lib/sounds.ts`, `app/install-app.tsx`, `public/sw.js` | Gesture-unlocked sounds, home-screen installation and public-only offline fallback. |
| `scripts/meme-pool.mjs`, `scripts/meme-cli.mjs` | Local pool selection, prepared images, preview and enable/pause controls. |
| `scripts/prepare-engine.mjs` | Pinned engine assets, integrity checks, and license/source attribution. |

## Change descriptions

Feature commits should explain the problem, behavior changed, verification performed, and any deployment steps or limitations. Update this README with changes to controls, setup, architecture, and commands in the same submission. The root README should keep its web companion overview current. Never put access codes, sessions, or deployment credentials in commit messages or documentation.

## Source notes

The scaffold's `sites()` build plugin is retained to emit portable build metadata; direct deployment uses your local Cloudflare configuration and Wrangler. It requires no Sites account or ChatGPT sign-in. No Sites project ID, deployment credential, real PIN, production secret, or user data is committed.
