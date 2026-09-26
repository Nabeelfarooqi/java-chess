import { test, expect, signIn, actionResponse } from './fixtures.mjs';

test('two private sessions play with keyboard input; resignation freezes clocks across reload', async ({ page: one, browser, app }) => {
  await one.setViewportSize({ width: 390, height: 844 });
  const other = await browser.newContext({ baseURL: app.origin, serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const two = await other.newPage();
  const errors = [];
  one.on('pageerror', error => errors.push(error.message));
  two.on('pageerror', error => errors.push(error.message));
  try {
    await signIn(one, 'one');
    await signIn(two, 'two');
    const oneToken = (await one.context().cookies()).find(c => c.name === 'rr_session')?.value;
    const twoToken = (await other.cookies()).find(c => c.name === 'rr_session')?.value;
    expect(oneToken).toBeTruthy(); expect(twoToken).toBeTruthy(); expect(oneToken).not.toBe(twoToken);
    await one.getByRole('button', { name: 'Challenge Browser Two', exact: true }).click();
    await two.getByRole('button', { name: 'Accept & start clocks', exact: true }).click();
    const board = one.getByRole('grid', { name: 'Chess board', exact: true });
    const rivalBoard = two.getByRole('grid', { name: 'Chess board', exact: true });
    await expect(board).toHaveAttribute('aria-readonly', 'false');
    await expect(rivalBoard).toHaveAttribute('aria-readonly', 'false');
    await expect(board.locator('[role="gridcell"][tabindex="0"]')).toHaveCount(1);
    expect(await one.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    const source = board.locator('[data-square="e2"]');
    await source.focus();
    await one.keyboard.press('Enter');
    await expect(source).toHaveAttribute('aria-selected', 'true');
    await one.keyboard.press('ArrowUp');
    await expect(board.locator('[data-square="e3"]')).toBeFocused();
    await one.keyboard.press('ArrowUp');
    const destination = board.locator('[data-square="e4"]');
    await expect(destination).toBeFocused();
    await expect(destination).toHaveAttribute('aria-label', /legal destination/);
    const moveResponse = actionResponse(one, 'move');
    await one.keyboard.press('Enter');
    const moved = await (await moveResponse).json();
    expect(moved.game.moves).toEqual(['e4']);
    await expect(rivalBoard.locator('[data-square="e4"]')).toHaveAttribute('aria-label', /white pawn/);
    await expect(rivalBoard.locator('[data-square="e2"]')).toHaveAttribute('aria-label', /empty/);
    await expect(board.locator('[role="gridcell"][tabindex="0"]')).toHaveCount(1);
    await one.keyboard.press('Tab');
    expect(await board.evaluate(el => el.contains(document.activeElement))).toBe(false);

    const blackClock = one.locator('.player-row[data-color="b"] .clock');
    const atMove = await blackClock.textContent();
    // Wait for observable elapsed clock time, not a blind sleep.
    await expect(blackClock).not.toHaveText(atMove);
    await one.getByRole('button', { name: 'Resign', exact: true }).click();
    const finishResponse = actionResponse(one, 'resign');
    await one.getByRole('dialog', { name: 'Concede this game?' }).getByRole('button', { name: 'Resign game', exact: true }).click();
    const finished = (await (await finishResponse).json()).game;
    expect(finished.status).toBe('finished'); expect(finished.reason).toBe('Resignation');
    expect(finished.blackMs).toBeLessThan(moved.game.blackMs - 500);
    await expect(one.getByRole('region', { name: 'Game result' })).toContainText('Browser Two wins.');
    await expect(two.getByRole('region', { name: 'Game result' })).toContainText('Browser Two wins.');
    const frozen = await one.locator('.player-row .clock').allTextContents();
    await one.reload();
    await expect(one.getByRole('region', { name: 'Game result' })).toBeVisible();
    expect(await one.locator('.player-row .clock').allTextContents()).toEqual(frozen);
    // Read the same authenticated API used by the app, without replacing a UI action.
    const saved = await (await one.request.get('/api/room?live=1')).json();
    expect(saved.game.whiteMs).toBe(finished.whiteMs);
    expect(saved.game.blackMs).toBe(finished.blackMs);
    expect(saved.game.moves).toEqual(['e4']);
    expect(errors).toEqual([]);
  } finally { await other.close(); }
});

for (const recovery of ['Try again', 'online event']) {
  test(`a one-request startup 503 recovers the existing session through ${recovery}`, async ({ page }) => {
    await signIn(page);
    let failed = false;
    await page.route('**/api/room*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (!failed && request.method() === 'GET' && url.pathname === '/api/room' && !url.search) {
        failed = true;
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic startup outage' }) });
      } else await route.continue();
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Reconnecting to your room.' })).toBeVisible();
    await expect(page.getByLabel('Your personal access code')).toHaveCount(0);
    if (recovery === 'Try again') await page.getByRole('button', { name: 'Try again', exact: true }).click();
    else await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.locator('.signed-in-player')).toContainText('Browser One');
    expect(failed).toBe(true);
    await expect(page.getByRole('button', { name: 'Room settings' })).toBeEnabled();
  });
}

test('an optional chunk 503 stays inside its feature boundary and recovers through reload', async ({ page, app }) => {
  const chunkPattern = /\/club-hub-[^/]+\.js(?:\?.*)?$/;
  // Use a real loopback HTTP outage so failure and recovery exercise the
  // browser's network behavior without inspector-protocol interception.
  await app.setChunkOutage(true);
  try {
    await signIn(page, 'one', app.faultOrigin);
    await page.getByRole('tab', { name: 'Club', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'The club could not open.' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to game', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Play', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('grid', { name: 'Chess board', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Room settings' })).toBeEnabled();
    expect((await app.setChunkOutage(false)).failedRequests).toBeGreaterThan(0);
    // The rejected lazy import stays failed in this document. Use the recovery
    // action offered to the player, then require a real successful chunk fetch.
    await page.getByRole('tab', { name: 'Club', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'The club could not open.' })).toBeVisible();
    const recoveredChunk = page.waitForResponse(response => chunkPattern.test(response.url()), { timeout: 10_000 });
    await Promise.all([
      recoveredChunk.then(response => expect(response.status()).toBe(200)),
      (async () => {
        await Promise.all([
          page.waitForEvent('load'),
          page.getByRole('button', { name: 'Reload room', exact: true }).click(),
        ]);
        await expect(page.locator('.signed-in-player')).toContainText('Browser One');
        await page.getByRole('tab', { name: 'Club', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'The usual suspects.' })).toBeVisible();
      })(),
    ]);
    expect((await app.setChunkOutage(false)).healthyRequests).toBeGreaterThan(0);
  } finally { await app.setChunkOutage(false); }
});
