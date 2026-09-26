# Built application browser checks

This suite runs the built application through the installed Wrangler API on loopback, with a unique temporary local D1 database per Playwright worker. It applies repository migrations with `--local`, seeds two public synthetic codes, and disables notifications. It never reads `cloudflare.local.json`, inherits production bindings, or sends iMessages. Each project and failed-test replacement worker gets fresh state. No deployed URL can be supplied.

The suite uses the pinned `@playwright/test@1.63.0` development dependency and this package script:

```json
"test:browser": "playwright test"
```

After the frozen dependency install, run from `web`:

```sh
pnpm exec playwright install --with-deps chromium webkit
npm run build
npm run test:browser
```

For a local Chromium-only pass, add `--project=chromium`. The browser install command is provisioning, not part of the test server; the tests themselves require no external account or production service. The server child receives only OS paths and fixed local-runtime settings. Do not use a saved authenticated browser profile. No application secrets or environment file are required.

CI should run the normal build before this suite, set `CI=true`, and upload `.test-build/playwright/` when a test fails. One worker limits resource usage. A whole-test retry launches a fresh server/database rather than continuing a half-finished game. HTML reports, traces, screenshots and failure videos remain under the already ignored `.test-build/` directory.

Coverage:

- Independent player cookies and the real sign-in → challenge → acceptance → keyboard move → resignation → persisted result flow.
- Clock time is charged on resignation and remains frozen after reload.
- One board tab stop, arrow navigation, Enter selection/destination, Tab exit, and 390px active-board overflow.
- A single startup HTTP 503 with a valid session, recovered through the retry button and through an online event.
- A non-cacheable HTTP 503 for the optional Club JavaScript chunk, a contained error boundary, continued room access, and recovery through the actual Reload room button with a successful chunk response.

The suite targets current accessible names, existing square coordinates and player clock attributes. It deliberately does not introduce test-only endpoints or production UI hooks. The optional-chunk test uses a second loopback origin that forwards HTTP and WebSocket traffic to the same built Worker. Its outage is controlled only through child-process IPC; the other scenarios use the Worker directly. The browser receives real HTTP responses without inspector-protocol interception. The optional-chunk matcher targets the actual built `club-hub-*.js` filename; if bundling changes that name, update both matchers and retain the failed/healthy request counters and HTTP 200 assertion so the test cannot silently pass without injecting and recovering from failure. Run `node tests/e2e/fault-proxy.test.mjs` for the browser-independent proxy smoke check.

These tests do not certify physical iOS gestures, native assistive technology, engine memory behavior, or real Apple Messages delivery. Chromium/WebKit runs are complementary release evidence. Test code added by the audit agent was syntax-checked; runtime execution must be recorded on the integrated candidate SHA after dependency/build setup.
