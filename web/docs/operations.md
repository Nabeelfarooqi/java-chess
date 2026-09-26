# Release and recovery guide

Run web commands from `web/` in the existing installation. Keep its real `cloudflare.local.json`, `.imessage/config.json`, and `.imessage/journal/`; a fresh checkout does not contain them. This guide describes operator actions. Automated tests use local databases and mock messaging and do not deploy or send iMessages.

## Prepare a release

1. Stop the Mac sender with Ctrl+C and let active games finish. Keep it stopped through migration, deployment, and the initial health checks. Back up the local `.imessage` directory privately while the sender is stopped; it contains credentials and the record of confirmed sends.
2. Select the reviewed commit and install its frozen dependencies. Record `git rev-parse HEAD`, `git status --short`, Node and pnpm versions, and the dependency lockfile checksum. Resolve unexpected working-tree changes before building. Use Node 22.13 or later and pnpm 11.25.0.
3. Confirm the intended Cloudflare account ID, Worker name, D1 database ID, and public HTTPS origin against Cloudflare's deployed configuration. For multiple accounts, set the intended `account_id` in `cloudflare.local.json`. Record this non-secret tuple and the current deployment version in the release notes. A familiar database name alone is insufficient. Review the generated `dist/server/wrangler.json` after building for the same Worker, account, and DB binding.
4. Make and rehearse a database recovery point as described below. Record applied migrations before changing anything, then the filenames and checksums of the migration files in the release. Preserve historical migration files; do not edit migration history to force a retry.
5. Run the checks for the exact commit being released:

```sh
npx pnpm@11.25.0 install --frozen-lockfile
npm run verify
npm run test:browser
```

`verify` runs lint, TypeScript checks, application and operational regressions, migration checks, a production build, and review-engine checks. The browser test uses its local test configuration; it is not permission to run tests against a production room. Install the browser binaries required by its configuration if missing. For desktop changes, run `java Build.java test` and `java Build.java build` from the repository root with a supported JDK; CI covers JDK 17 and 21. Headless Swing checks do not replace the native checks below.

The deploy script itself runs migration preflight and a build, then applies remote migrations before publishing. It does **not** automatically perform the complete release verification, make a backup, rehearse remote D1 changes, capture provenance, or perform post-deployment checks. Complete those steps separately.

## Database backup and rehearsal

Use the actual configured database name in place of `YOUR_DATABASE_NAME` and a private absolute output path. These commands read the remote database; [an export blocks other database requests](https://developers.cloudflare.com/d1/best-practices/import-export-data/#known-limitations-1), so schedule it while games are idle. The installed Wrangler CLI supports:

```sh
npx wrangler d1 export YOUR_DATABASE_NAME --remote --config cloudflare.local.json --output /PRIVATE/PATH/rival-before-release.sql
npx wrangler d1 time-travel info DB --config cloudflare.local.json --json
npx wrangler d1 migrations list DB --remote --config cloudflare.local.json
npx wrangler d1 execute DB --remote --config cloudflare.local.json --command "SELECT id, name, applied_at FROM d1_migrations ORDER BY id"
```

`migrations list` reports **unapplied** files; the last query records applied history using the project's default migration table. If the installation overrides `migrations_table`, query that configured table instead. Record export time, file checksum, database ID, Time Travel bookmark, migration history, and the current Worker deployment version together. Never put database exports, PIN hashes, session tokens, Wrangler credentials, or local messaging configuration in Git or public CI artifacts. A player's JSON game export is useful for history but is not a full D1 recovery backup.

Verify that the SQL export is nonempty and rehearse importing it into an explicitly separate disposable database. Use a separate rehearsal configuration with a different DB ID and Worker name; verify those IDs before any import or migration. Keep notifications disabled and exclude real messaging credentials. Use synthetic data where possible; treat any production copy as private. Apply the release migrations and test sign-in, session invalidation, games, history, and rollback/retry behavior on that target. A local SQLite test does not prove Cloudflare's remote SQL parser will accept a migration. Retain the rehearsal result and target identity with the release evidence.

Check the account's current [D1 Time Travel availability and restore procedure](https://developers.cloudflare.com/d1/reference/time-travel/) before relying on a bookmark. A recorded bookmark is not a rehearsal or a guarantee of indefinite retention. Follow [Cloudflare's export guidance](https://developers.cloudflare.com/d1/best-practices/import-export-data/) for export limitations and restoration. Do not run a restore against production as a test.

## Deploy, verify, and retain evidence

After the release checks and recovery preparation, the existing-installation deployment command is:

```sh
npm run cloudflare:deploy
```

Capture the deployed commit, UTC time, Worker version/deployment ID, account/Worker/database/origin tuple, migration preflight output, remote migration result, and post-deployment check results. Record configuration identity and relevant non-secret settings, not secret values. Keep the pre-release evidence and backup reference alongside it.

After deployment, check the printed HTTPS origin loads the expected release without server errors. Confirm the configured DB still contains the expected roster and game history, that a signed-out `GET /api/room` returns 401, and that an owner-approved test player can sign in and refresh an authenticated room. If PIN rotation is part of the release, verify the previous code and previous sessions are rejected and the new code succeeds. Use an explicitly approved test game to check challenge acceptance, legal move delivery to a second browser, reconnect, finish, and persisted history. Do not create surprise games or notifications in a real club for a smoke test. Check Worker error logs using sanitized output.

Update the Mac checkout to the same compatible release **after the Worker is deployed**. Inspect `npm run imessage:status -- --review` before restarting. A status command is read-only and sends no messages. If delivery is enabled and intentionally resuming, start `npm run imessage:start`; queued events can then send. Changing bridge credentials or destinations is a separate configuration action, not a mandatory deployment step.

### Migration and rollback boundaries

Deploy migration `0008_auth_revision_and_indexes.sql` before running the updated `cloudflare:pins` command. It adds `players.legacy_pin_hash`, `players.auth_version`, invalidation triggers, and indexes. The rotation command performs a schema preflight before updating secrets. A normal update does **not** need PIN rotation or setup repeated.

`npm run cloudflare:pins` intentionally replaces both original Walan/Saif codes, clears their chosen-code overrides, persists the same new salted hashes in Worker secrets and D1, advances their authentication revisions, and revokes their sessions. Additional players retain their codes. Run it interactively only when those two codes need rotation; use `cloudflare:set-pin -- PLAYER` for a chosen code for one player. Neither operation is a remedy for an iMessage bridge error.

Secrets and D1 are separate services, so rotation is not one cross-service transaction. If it fails partway, keep the sender stopped if it was already stopped for release work, inspect the reported stage privately, and complete a fresh successful rotation before sharing codes. Do not assume a partially failed command changed neither service or manually paste hashes into logs. Codes print only after the command's updates succeed.

A Worker rollback does not undo D1 migrations. These schema additions remain after an application rollback; verify the previous application is compatible before using it. In particular, rolling back authentication code can remove the new revision/legacy-hash protections. Prefer a compatible fix-forward release for an authentication regression. Do not drop the new columns, remove migration records, or restore an old database over newer games just to make old code run. [Cloudflare rolls back a failed migration while retaining earlier successful migrations](https://developers.cloudflare.com/d1/wrangler-commands/#d1-migrations-apply); retain the error and applied-history evidence before retrying. A full data restore needs an explicit downtime/data-loss decision and a rehearsed procedure.

## Inspect and resolve iMessage events

Deploy the updated Worker first, then update the Mac scripts. These commands need the saved local bridge configuration; player PINs do not authorize them.

```sh
# Latest 30 events
npm run imessage:status

# Exact lookup, including an ID older than the recent list
npm run imessage:status -- JOB_ID

# All needs_review events, automatically following server cursor pages
npm run imessage:status -- --review
```

The normal list is bounded; an older missing row does not mean it was deleted. `--review` follows the server's keyset pagination and does not claim or send jobs. The CLI does not expose a manual cursor flag. A leased event can remain leased until its five-minute lease expires after a crash; use status to observe it before deciding recovery.

For `needs_review`, stop the sender and inspect the exact intended Messages conversation first, including duplicate group threads. A timeout or missing confirmation can happen **after** a send. Do not repeatedly retry to find out whether it arrived. HTTP 202/accepted, an empty receipt, or a malformed receipt stays uncertain. A successful endpoint receipt means BlueBubbles observed a message in the Mac's Messages database; it does not prove recipient delivery or reading. The implementation validates the [official text/attachment response contract](https://github.com/BlueBubblesApp/bluebubbles-server/blob/f2e2286241a7c3b6617a82b37d4afaab4df3a6b9/packages/server/src/server/api/http/api/v1/routers/messageRouter.ts), but actual Mac/version behavior still needs validation.

Choose exactly one resolution after inspecting Messages:

| Command | Effect |
| --- | --- |
| `npm run imessage:retry -- JOB_ID retry` | Requeues unfinished parts, preserving confirmed parts and existing destination checks. Omitting `retry` selects this choice. |
| `npm run imessage:retry -- JOB_ID original` | Explicitly retains the originally journaled conversation. Fails if no valid original destination was recorded. |
| `npm run imessage:retry -- JOB_ID current` | Explicitly uses the currently configured destination. Refused if any part has already been confirmed, so one result is not split across chats. |
| `npm run imessage:retry -- JOB_ID sent` | Records that the operator verified the event was sent; sends nothing. |
| `npm run imessage:retry -- JOB_ID discard` | Resolves the event as skipped; sends nothing. |

Each command requires the matching uppercase confirmation (`RETRY`, `ORIGINAL`, `CURRENT`, `SENT`, or `DISCARD`). There is no separate `imessage:resolve` npm command. `retry` does not silently approve a changed destination; use the deliberate original/current choice when appropriate. For partially sent multipart results, use original, sent, or discard after inspecting each part. Confirmed text/image parts remain recorded and are not intentionally resent by retry. A genuinely uncertain part can still duplicate if it actually arrived; only the operator can decide that risk.

Terminal sent/discard resolution is written locally before the server update. If the acknowledgement fails, rerun the same sent/discard choice after checking exact status. Do not erase the journal to unblock a retry. If the event is already terminal on the server, no retry is needed. The journal namespace is retained during a workers.dev address change so confirmed events remain recognizable.

## Locks and interrupted address changes

Sender, setup, reconnect, retry/resolution, and account address changes share `.imessage/sender.lock` when messaging is configured. They hold it throughout their operation. A live owner blocks a competing command. Exit that process normally (Ctrl+C for the sender), then retry; do not delete its lock to run both. Status is read-only and does not acquire the sender lock.

Locks contain `PID:token` (older plain PID records are also accepted). A verifiably dead PID is recovered automatically, with a separate `.recovery` guard preventing two commands from both removing a stale lock. If the owner cannot be verified, the command stops. PID reuse or permission restrictions can make a lock look live; inspect the process command and owner before taking action.

If an error specifically names a leftover `sender.lock.recovery` or `.cloudflare-subdomain.lock.recovery`, first close competing commands and verify the PID recorded in that guard no longer exists. Remove only that named guard after verification, then rerun the command so it can recover the stale lock. For a malformed lock, inspect the active processes and retain its contents privately before removing only that exact lock when no owner exists. Never delete the whole `.imessage` directory, its journal, or configuration as lock recovery.

Account address changes additionally hold `.cloudflare-subdomain.lock` and retain recovery state in `.cloudflare-subdomain.json`. While either is present, normal sender/recovery commands are blocked. Rerun the **same** `npm run cloudflare:subdomain -- REQUESTED_NAME` command to finish verification; do not delete recovery state to bypass it. It can recover a dead process lock and resume the saved operation. The address change affects every workers.dev URL in the account, so its displayed impact and confirmation still matter.

Reconnect verifies the authenticated account, deployed Worker DB binding, and saved origin before changing a bridge secret or enabling notifications. It accepts the correct workers.dev origin or a Cloudflare Custom Domain mapped to that Worker's production service. A mismatch requires checking configuration and deployed identity; it is not solved by resetting the bridge token repeatedly. This proof is implemented in the reconnect flow; it does not replace the manual release identity checks for the general deployment command.

## Validation that needs hardware or services

Record OS, browser/JDK/BlueBubbles version, release SHA, scenario, and result. Sanitize evidence; omit codes, chat identifiers, addresses, message bodies, and credentials.

- **BlueBubbles on the actual Mac:** verify Messages automation permission, selected direct/group conversations, and one explicitly authorized text and attachment delivery. Then verify restart with retained journal does not repeat confirmed parts, and that an uncertain/failed part goes to review. Use a controlled test conversation and approved recipients; mocks do not establish production delivery. Keep the Mac awake and online. Do not deliberately interrupt a real contact's send to test failure recovery.
- **Physical iPhone/iPad Safari and Android Chrome:** play from both seats using touch drag/tap, all promotion choices, reconnect/background/foreground, clock display, and narrow/landscape layouts. Check install behavior, audio activation/mute, keyboard access where available, screen reader labels, and reduced motion. Check Lite/Full review and cancellation on memory-constrained devices. Desktop emulation does not prove these platform behaviors.
- **Native Java desktop:** launch on the supported target OS with its normal display scaling and JDK. Exercise file choosers, invalid/cancelled/slow loads, overwrite/save permission failures, closing during a write, AI cancellation, promotion/resign/draw dialogs, keyboard board navigation, and screen reader behavior. The load/save checks use injected storage in headless tests; they do not exercise native dialogs or actual network drives. Cancellation prevents stale UI updates; a save that already finished replacing the file cannot be undone by a later Cancel click.

The implementation audit did not perform a production deploy/restore rehearsal, real BlueBubbles delivery, physical mobile checks, or native desktop dialog/accessibility checks. These remain release checks for the deployment owner, Mac owner, and device testers respectively. Record completion against the release SHA; keep unperformed checks listed as pending with an owner and target environment. Passing automated checks is evidence for the covered cases, not a claim of flawless behavior on untested devices or services.
