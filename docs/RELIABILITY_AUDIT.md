# Rival Chess reliability audit and implementation

Audited baseline: `b186fb406200b258e6bb3b7ee3e2451d92b870a2`, September 25, 2026. Scope: Java desktop chess, Rival Room web client, Workers/D1, realtime delivery, Stockfish review, deployment scripts, and the Mac messaging bridge.

Three specialists reviewed gameplay/accessibility, backend/dependencies, and desktop/operations. The integrator independently reproduced defects and combined their fixes. This document distinguishes implemented changes from work requiring production evidence, hardware, or a policy decision. It is not a claim of flawless behavior.

## Release blockers and material fixes

| ID | Priority | Outcome | Owner / regression gate |
|---|---|---|---|
| R01 | P1 | Updated compatible framework/runtime/tool packages; narrow patched transitive overrides; preserved seven-day dependency maturity policy | Platform; frozen install, peer check, registry audit, production build, migration generation |
| R02 | P1 | Windows paths use file URL conversion; CLI tests preserve POSIX checks on macOS/Linux | Platform; normal Windows build and complete test suite |
| R03 | P1 | Credential revision and conditional session insert prevent login completing against a rotated code, including A→B→A | Backend; chosen/generated/legacy rotation and migration regressions |
| R04 | P1 | Reconnect verifies account, Worker, D1 binding and public origin before mutations | Operations; mismatches cause zero mutations in actual CLI fixture |
| R05 | P2 | Terminal actions freeze elapsed clocks before saving results | Gameplay; both colors/resigners, draw, flag and mate tests; browser reload |
| R06 | P2 | Club/roster reads settle up to 64 abandoned expired games per read through versioned writes | Backend; seat release and exactly-once results; bounded progressive cleanup |
| R07 | P2 | Revoked/expired sockets are pruned before the eight-tab admission cap | Backend; actual Workers/WebSocket runtime |
| R08 | P2 | JSON limits enforced during streaming in UTF-8 bytes on all public mutation endpoints | Backend; malformed input, cancellation and bounded-byte regressions |
| R09 | P2 | Only documented serialized Message receipts with HTTP/status 200 confirm sends; accepted-only responses remain uncertain | Operations; synthetic receipt/timeout transport cases; actual Mac acceptance still required |
| R10 | P2 | Bridge status supports direct ID lookup, filtered review events and cursor pagination | Operations; 101-job fixture with timestamp ties |
| R11 | P2 | Explicit original/current destination retry, mark-sent and discard preserve confirmed journal parts | Operations; no sends during resolution, no silent retarget or resend |
| R12 | P2 | Startup distinguishes an unavailable service from an expired session and supports retry/recovery | Frontend; bounded transport tests and browser recovery gate |
| R13 | Retracted | Existing important CSS rules already preserve selected/premove colors; original cascade finding was incorrect | Preserve theme regression checks |
| R14 | P2 | One board tab stop, arrow navigation, Enter/Space moves, Escape, square/piece narration and read-only semantics | Frontend; keyboard geometry/rendering tests and browser keyboard play; native screen readers pending |
| R15 | P2 | Optional feature failure boundaries preserve the room and provide return/reload actions | Frontend; failed-chunk browser gate |
| R16 | P2 | Optional requests have deadlines, cancellation, sequencing and bounded Club refreshes | Frontend; transport and browser recovery gates |
| R17 | P2, scale-dependent | Participant indexes and split latest-game lookup eliminate the demonstrated history scan; aggregate/export redesign deferred pending volume/latency evidence | Backend; EXPLAIN query plan; production measurement before further schema changes |
| R18 | P2 | Malformed desktop Properties escapes become handled load errors | Desktop; invalid save regressions |
| R19 | P2 | AI can choose a draw claim or a better continuation; forced draws and checkmate retain precedence | Engine; current/intended claims and mate regressions |
| R20 | P2 | Desktop load/save uses background workers, detached snapshots, cancellation and stale-result guards | Desktop; slow/failing file operations preserve responsive controls |
| R21 | P2 | Lint is a zero-warning gate; generated engine/build/cache files excluded | Platform/frontend; npm run lint |
| R22 | P2 | Reproducible verification includes real engines, three-OS web/Java CI and browser regression harness | QA; remote matrix and physical-device gates must actually pass before release |
| R23 | P2, release control | Main was unprotected at audit time. Configure required checks and an explicit review policy before release; repository settings were not modified | Repository owner; require all new checks, no bypass of failing checks |
| R24 | P3 | Incoming challenges restore Play and dismiss stale optional dialogs | Frontend; browser challenge-arrival checks |
| R25 | P3 | Read-only boards permit native touch scrolling | Frontend; rendered semantics verified, physical touch test pending |
| R26 | P2, discovered during implementation | Review no longer mixes partial search depths into duplicate alternatives; final UCI best move stays first and alternatives come from a complete distinct exact iteration | Engine/QA; deterministic rank-swap fixture plus actual Lite/Full WASM, legal/distinct moves and final-best matching |
| R27 | P2, discovered in browser CI | Disable Vite JavaScript module preloads to avoid WebKit retaining failed preloads across reload. Native lazy imports and CSS loading remain; optional features may need extra network round trips on a cold load | Frontend/platform; real HTTP 503, preserved room, actual Reload room action, successful chunk response and restored Club in Chromium/WebKit. Matches open [WebKit bug 270357](https://bugs.webkit.org/show_bug.cgi?id=270357) |

## Minor changes and conditional backlog

| ID | Implementation or next action | Acceptance criterion / owner |
|---|---|---|
| M01 | Retention policy remains to be chosen. Do not implicitly purge game history or pending/uncertain delivery evidence | Backend + owner: define ages, bounded batches, dry-run counts and recovery |
| M02 | Actual rate-limit delay and Retry-After implemented | Backend regression checks remaining seconds and window reset |
| M03 | Spectator conditional insert must succeed before returning a session cookie | Rotation race regression |
| M04 | Practice keyset pagination/counts implemented; selected authorized active/finished spectator game can load beyond the initial 50 | Ownership, ties, >100 puzzles and pagination stability tests |
| M05 | Dynamic HTML/API framing, referrer, MIME and minimal CSP policy added without blocking engine Workers/WASM | Runtime headers verified; inspect actual CDN/production headers and test stricter script policy separately |
| M06 | Original desktop creation date survives save/reload/export; legacy files use unknown date | Desktop date round-trip tests; optional player metadata remains a separate product decision |
| M07 | Native Java painted-board accessibility needs a dedicated design and real screen-reader acceptance | Accessibility owner: square/piece/state children, keyboard focus and announcements |
| M08 | Desktop save and PGN export use temporary sibling files and atomic replacement where supported | Simulated failed writes preserve the existing file |
| M09 | Sender, setup, retry and reconnect share held process locks | Concurrent/stale-owner regression tests; crash during recovery fails closed |
| M10 | Release guide requires SHA, deployment identity, migration provenance, backups and bounded health checks | Operations; retain actual evidence at deployment, which has not been performed |
| M11 | Profile long games before optimizing replay/material/history work | Frontend: deterministic CPU/memory measurements and unchanged chess outputs |
| M12 | Apply the selected board style consistently in review/practice/watch portals | Frontend: portal theme regression and visual check |
| M13 | Further formatting/module extraction deferred to small behavior-preserving follow-ups | Frontend: avoid combining broad rewrites with these correctness changes |
| M14 | Shared request transport rejects invalid/proxy responses with safe errors and preserves HTTP status | Frontend regressions; full per-endpoint response schemas remain follow-up work |
| M15 | Reconnect jitter and privacy-conscious operational metrics remain follow-up work | Realtime: measure reconnect load, avoid identifying telemetry, preserve rapid game recovery |
| M16 | Full-engine memory/background behavior needs low-memory physical iOS/Android checks | QA: cancellation, resume, no lost game state, clear capability documentation |
| M17 | Header controls now have separate 44px touch targets; 320px/390px portrait and 844px landscape browser layouts checked. Text zoom, reduced motion and physical touch matrix still required | QA: no clipped controls, readable long names, usable focus/touch targets |
| M18 | Reproducible verification and release/operations documentation provided | New checkout can run documented commands without private services |
| M19 | Dependency removal remains conditional on import/runtime/license inventory | Platform: preserve Stockfish licenses/source offers and verified asset limits |
| M20 | CI has read-only permissions, cancellation and time limits; dependency refresh remains reviewable | Platform: consider immutable Action SHA pins in a focused maintenance change |

## Verification and rollout

Use Node 22.13+ and the pinned pnpm version. From `web`, run `npx pnpm@11.25.0 install --frozen-lockfile`, `npm run verify`, `npx playwright install chromium webkit`, then `npm run test:browser`. Linux hosts may need `npx playwright install --with-deps chromium webkit` for system dependencies. From the repository root, run `java Build.java test` and `java Build.java build` with JDK 17 or newer. Browser fixtures must use disposable local D1 state and synthetic codes; they do not send messages or call production APIs.

Migration `0008_auth_revision_and_indexes.sql` is additive. Rehearse it against an exported copy of the existing database, verify retained identities/games/series/sessions, then deploy it before the new Worker or PIN tooling. Existing valid sessions survive migration; a subsequent code rotation revokes the affected player's sessions. Do not run the new code against an unmigrated database. Old Workers do not provide the new login-race protection, so a code rollback does not establish equivalent security. Never delete the new columns/history as an improvised rollback.

Remote D1 rehearsal, physical-device and assistive-technology checks, actual Mac/BlueBubbles receipt behavior, production configuration and branch protection remain release requirements. No real messages, production migrations, deployment, or merge were performed as part of local implementation.
