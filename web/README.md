# Rival Room

A private two-player web companion to the Java desktop game. Open the same link, enter your own eight-digit code, and challenge your friend. No user accounts or ChatGPT login are required.

## Play

- 1-, 3-, 5-, or 10-minute games, optionally adding two seconds after each move.
- Opponent accepts before clocks start. Colors alternate on the next challenge.
- Legal moves, check, castling, en passant, and choice of promotion piece.
- Checkmate, stalemate, resignation, agreed draws, repetition and move-count draws.
- Games and clocks survive refreshes. Closing the browser does not stop the clock.
- Saved wins, losses, draws, recent history, individual PGN downloads and a full JSON backup.
- Personal display names. One PIN belongs to each player; do not share your own PIN.

Group-chat messages are not connected yet. Nothing sends a message to anyone.

## Deploy to your own Cloudflare account

This is a **Cloudflare Worker with D1**, not a static Pages upload. The Worker runs independently of your PC and serves a `workers.dev` link. A custom domain can be added later.

Install Node.js **22.13 or later**, then open the `web` folder in a terminal (IntelliJ's Terminal is fine):

```sh
npx pnpm@11.25.0 install --frozen-lockfile
npm run cloudflare:setup
npm run cloudflare:deploy
npm run cloudflare:pins
```

1. **Setup** opens Cloudflare's own login in your browser, then creates `rival-room-db`. It stores the database binding in ignored `cloudflare.local.json`. If you have several Cloudflare accounts, select the one that should own the game.
2. **Deploy** builds the Worker, applies only pending schema migrations, and publishes. Keep the `workers.dev` URL that Wrangler prints.
3. **PINs** generates two different random codes, uploads only salted PBKDF2 hashes as Worker secrets, revokes existing sessions, and prints the codes in your local terminal. Save them in a password manager. Send your friend the URL and their code. Do not put the codes into GitHub or this README.

Until PIN hashes are configured, the room refuses entry. Running `cloudflare:pins` again **replaces both codes**; it does not reset the scores. Do not run it in CI: it requires an interactive terminal to keep codes out of CI logs.

For future updates, pull the repo and run:

```sh
npx pnpm@11.25.0 install --frozen-lockfile
npm run cloudflare:deploy
```

Keep using the same D1 database. Creating or selecting a different database would create a different record. Do not delete `rival-room-db` if you want to retain your history.

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

The deploy script refuses a placeholder database ID. PIN hashes are runtime secrets, not build variables: `PIN_ONE_HASH` and `PIN_TWO_HASH`.

## Records and backups

D1 stores authoritative games and sessions. Scores are calculated from finished games, so repeating a finish request cannot award extra wins. All-time totals include all games, while the screen lists the latest 20. Cancelled challenges are excluded.

Use **The record → Export all** for a complete JSON backup and **Save PGN** for an individual chess game. Storage is durable, not a promise of literal permanence: retain backups and the Cloudflare account/database. Automatic off-account backups and restore/import are possible follow-ups.

## Rules and limitations

- The server validates every move and uses its own clock. Client-supplied board positions, results, player IDs, and clocks are not accepted.
- Both players see updates by polling about every 0.7 seconds during play. This first version has no lag compensation, premoves, or WebSocket transport.
- Threefold repetition and the 50-move rule are automatic draws, using chess.js's online-game convention.
- On timeout, the result is drawn if the non-flagging side has only a king, a single bishop or knight, or bishops all on one color; otherwise it wins. This is a practical room rule, not a full FIDE possible-mate adjudicator.
- A disconnected player's clock continues. If both leave, a timeout is recorded the next time the room is requested, using the persisted clock state.
- Challenges expire in 15 minutes. Session access lasts up to 12 hours or until Lock room is clicked. Browsers may restore session cookies; use Lock room on a shared device.
- The entry page is reachable without an account. All game data, exports, player changes, and moves are protected by server-verified sessions.
- PIN attempts are limited by IP and globally; sessions use random tokens stored hashed, with HttpOnly, SameSite=Strict, Secure cookies on HTTPS. Writes require a same-origin JSON request.
- Polling consumes Worker/D1 requests. Cloudflare account quotas and service availability still apply; there is no always-on desktop server or subscription added by this code.

## Development and checks

```sh
npm test
npm run typecheck
npm run build
```

Tests use a disposable local SQLite database. They verify access control, CSRF protection, rate limiting, two-player identity, legal moves, special moves, checkmate, draws, clock expiry, concurrent writes, session revocation, and persistence after reopening the database. They do not contact your Cloudflare account.

The app uses React, TypeScript, Vinext, chess.js, and Cloudflare D1. The original Java Swing game remains in the repository root and opens normally in IntelliJ.

## Source notes

The scaffold's `sites()` build plugin is retained to emit portable build metadata; direct deployment uses your local Cloudflare configuration and Wrangler. It requires no Sites account or ChatGPT sign-in. No Sites project ID, deployment credential, real PIN, production secret, or user data is committed.
