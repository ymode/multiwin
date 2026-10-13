// Deterministic checks intercept YouTube. LIVE_YOUTUBE=1 opts into live diagnostics.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

// Models the documented API so controls and failures are deterministic offline.
// Live diagnostics below still use the actual YouTube player.
const fakePlayerAPI = `
window.__players = {};
window.YT = { Player: class {
  constructor(iframe, options) {
    this.iframe = iframe;
    this.events = options.events;
    this.muted = true;
    this.paused = false;
    window.__players[iframe.id] = this;
    setTimeout(() => this.events.onReady({ target: this }), 0);
  }
  mute() { this.muted = true; }
  unMute() { this.muted = false; }
  playVideo() { this.paused = false; this.events.onStateChange?.({ data: 1 }); }
  pauseVideo() { this.paused = true; }
  destroy() { this.destroyed = true; this.iframe.remove(); }
} };
window.onYouTubeIframeAPIReady?.();
`;

async function interceptYouTube(route, requests) {
  if (route.request().url().includes('/iframe_api')) {
    await route.fulfill({ contentType: 'application/javascript', body: fakePlayerAPI });
  } else {
    if (requests) requests.push({ url: route.request().url(), headers: await route.request().allHeaders() });
    await route.fulfill({ contentType: 'text/html', body: '<style>body{margin:0;background:#17202b;color:#dbe7f7;font:18px sans-serif;display:grid;place-items:center;height:100vh}</style><p>Test video player</p>' });
  }
}

const root = path.resolve(__dirname, '..');
let browser, server, localURL;

before(async () => {
  server = spawn(process.env.PYTHON || 'python3',
    [path.join(root, 'serve.py'), '--no-browser', '--port', '0']);
  localURL = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Launcher startup timed out')), 10000);
    let output = '';
    server.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/Multiwin: (http:\/\/127\.0\.0\.1:\d+\/)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    server.on('error', error => { clearTimeout(timer); reject(error); });
    server.on('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Launcher exited with code ${code}`));
    });
  });
  browser = await chromium.launch();
});

after(async () => {
  if (browser) await browser.close();
  if (server) server.kill();
});

test('local-file launch explains recovery and cannot create embeds', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    assert.equal(await page.locator('#launchNotice').isVisible(), true);
    assert.match(await page.locator('#launchNotice').innerText(), /python3 serve.py/);
    assert.equal(await page.locator('#urlInput').isDisabled(), true);
    assert.equal(await page.locator('#addBtn').isDisabled(), true);
    // Also guard programmatic calls / Enter handlers, not just the button.
    await page.evaluate(() => { urlInput.value = 'y0sF5xhGreA'; addVideo(); });
    assert.equal(await page.locator('iframe').count(), 0);
  } finally { await page.close(); }
});

for (const scheme of ['http', 'https']) {
  test(`${scheme} sends the hosting origin and preserves grid controls`, async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      const requests = [];
      await page.route('https://www.youtube.com/**', route => interceptYouTube(route, requests));
      let url = localURL;
      if (scheme === 'https') {
        url = 'https://multiwin.test/nested/index.html?private=value';
        await page.route('https://multiwin.test/**', async route => route.fulfill({
          contentType: 'text/html', body: await readFile(path.join(root, 'index.html'), 'utf8')
        }));
      }
      await page.goto(url);
      assert.equal(await page.locator('#launchNotice').isVisible(), false);
      assert.equal(await page.locator('#addBtn').isEnabled(), true);
      const videos = [
        'https://www.youtube.com/watch?v=y0sF5xhGreA',
        'https://youtu.be/M7lc1UVf-VE',
        'https://www.youtube.com/embed/M7lc1UVf-VE',
        'https://www.youtube.com/shorts/M7lc1UVf-VE',
        'M7lc1UVf-VE'
      ];
      await openControls(page);
      await page.locator('#urlInput').fill('invalid');
      await page.locator('#addBtn').click();
      assert.equal(await page.locator('iframe').count(), 0);
      for (const [index, video] of videos.entries()) {
        await openControls(page);
        await page.locator('#urlInput').fill(video);
        const loaded = page.waitForResponse(response => response.url().startsWith('https://www.youtube.com/embed/'));
        if (index % 2) await page.locator('#urlInput').press('Enter');
        else await page.locator('#addBtn').click();
        await loaded;
      }
      assert.equal(requests.length, videos.length);
      for (const request of requests) {
        assert.equal(request.headers.referer, new URL(url).origin + '/');
        assert.equal(new URL(request.url).searchParams.get('autoplay'), '1');
        assert.equal(new URL(request.url).searchParams.get('mute'), '1');
      }
      assert.equal(await page.locator('#urlInput').inputValue(), '');
      const first = page.locator('.video-wrapper').first();
      await first.hover();
      await first.getByRole('button', { name: 'Make video larger', exact: true }).click();
      assert.equal(await first.evaluate(el => el.style.getPropertyValue('--size')), '2');
      await first.getByRole('button', { name: 'Make video smaller', exact: true }).click();
      assert.equal(await first.evaluate(el => el.style.getPropertyValue('--size')), '1');
      // Shrinking the card can move it out from under the pointer.
      await first.hover();
      await first.getByRole('button', { name: 'Fullscreen video', exact: true }).click();
      await page.waitForFunction(() => document.fullscreenElement !== null);
      await page.evaluate(() => document.exitFullscreen());
      // Reorder via the browser's drag events using the existing handlers.
      const original = await first.locator('iframe').getAttribute('src');
      const transfer = await page.evaluateHandle(() => new DataTransfer());
      await first.dispatchEvent('dragstart', { dataTransfer: transfer });
      await page.locator('.video-wrapper').last().dispatchEvent('dragover',
        { dataTransfer: transfer, clientX: 10000, clientY: 10000 });
      await page.locator('.video-wrapper').last().dispatchEvent('drop',
        { dataTransfer: transfer, clientX: 10000, clientY: 10000 });
      await page.locator('.video-wrapper').last().dispatchEvent('dragend', { dataTransfer: transfer });
      assert.equal(await page.locator('.video-wrapper').last().locator('iframe').getAttribute('src'), original);
      while (await page.locator('.video-wrapper').count()) {
        const count = await page.locator('.video-wrapper').count();
        await page.locator('.video-wrapper').first().hover();
        await page.locator('.ctrl.close').first().click();
        await page.waitForFunction(n => document.querySelectorAll('.video-wrapper').length === n - 1, count);
      }
      assert.equal(await page.locator('.empty-state').count(), 1);
      assert.equal(await page.locator('#urlInput').isVisible(), true);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
}

for (const videoId of ['y0sF5xhGreA', 'M7lc1UVf-VE']) {
  test(`live playback diagnostic: ${videoId}`, { skip: !process.env.LIVE_YOUTUBE }, async t => {
    const page = await browser.newPage();
    let referer;
    page.on('request', request => {
      if (request.url().startsWith('https://www.youtube.com/embed/')) {
        referer = request.headers().referer;
      }
    });
    try {
      await page.goto(localURL);
      await openControls(page);
      await page.locator('#urlInput').fill(videoId);
      await page.locator('#addBtn').click();
      const video = page.frameLocator('iframe').locator('video').first();
      await video.waitFor({ timeout: 15000 });
      const start = await video.evaluate(element => element.currentTime);
      // Require actual media progress, not just a loaded iframe or thumbnail.
      await video.evaluate((element, startTime) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => { clearInterval(poll); reject(new Error('Media did not advance')); }, 15000);
        const poll = setInterval(() => {
          if (!element.paused && element.readyState >= 2 && element.currentTime > startTime + 1) {
            clearTimeout(timer);
            clearInterval(poll);
            resolve();
          }
        }, 250);
      }), start);
      t.diagnostic(JSON.stringify({ browser: browser.version(), url: localURL,
        videoId, referer, result: 'media time advanced by more than one second' }));
    } catch (error) {
      const frame = page.frames().find(frame => frame.url().startsWith('https://www.youtube.com/embed/'));
      const message = frame ? await frame.locator('body').innerText({ timeout: 2000 }).catch(() => '') : '';
      t.diagnostic(JSON.stringify({ browser: browser.version(), url: localURL,
        videoId, referer, error: error.message, playerText: message.slice(0, 1500) }));
      // Network/bot/video restrictions are not deterministic app test failures.
      t.skip('Live playback NOT verified; see diagnostic above.');
    } finally { await page.close(); }
  });
}

async function openApp(options = {}) {
  const page = await browser.newPage(options);
  await page.route('https://www.youtube.com/**', route => interceptYouTube(route));
  await page.goto(localURL);
  return page;
}

async function openControls(page) {
  if (!(await page.locator('#controlPanel').isVisible())) await page.locator('#togglePanel').click();
}

async function closeControls(page) {
  if (await page.locator('#controlPanel').isVisible()) await page.locator('#togglePanel').click();
}

async function addId(page, id) {
  await openControls(page);
  await page.locator('#urlInput').fill(id);
  await page.locator('#addBtn').click();
}

test('refresh restores order and size; named presets load and delete', async () => {
  const page = await openApp({ viewport: { width: 1440, height: 1000 } });
  try {
    await addId(page, 'M7lc1UVf-VE');
    await addId(page, 'y0sF5xhGreA');
    await page.evaluate(() => {
      const first = grid.querySelector('.video-wrapper');
      adjustSize(first, 1);
      grid.appendChild(first);
      saveSession();
    });
    const before = await page.evaluate(() => getSetup());
    await page.reload();
    assert.deepEqual(await page.evaluate(() => getSetup()), before);
    await openControls(page);
    await page.locator('#savedSetups summary').click();
    await page.locator('#presetName').fill('Race weekend');
    await page.locator('#savePreset').click();
    await addId(page, 'dQw4w9WgXcQ');
    await openControls(page);
    await page.locator('#loadPreset').click();
    assert.deepEqual(await page.evaluate(() => getSetup()), before);
    await page.locator('#deletePreset').click();
    assert.equal(await page.locator('#presetSelect option').count(), 1);
    assert.equal(await page.locator('.video-wrapper').count(), 2);
  } finally { await page.close(); }
});

test('share link opens the same setup; clipboard denial offers a selectable link', async () => {
  const page = await openApp();
  const other = await openApp();
  try {
    await addId(page, 'M7lc1UVf-VE');
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('Denied')) }
    }));
    await openControls(page);
    await page.locator('#savedSetups summary').click();
    await page.locator('#shareSetup').click();
    assert.equal(await page.locator('#shareFallback').isVisible(), true);
    const link = await page.locator('#shareURL').inputValue();
    await other.goto(link);
    await other.waitForFunction(() => document.querySelectorAll('.video-wrapper').length === 1);
    assert.deepEqual(await other.evaluate(() => getSetup()), await page.evaluate(() => getSetup()));
    assert.equal(new URL(other.url()).hash, '');
    await other.reload();
    assert.equal(await other.locator('.video-wrapper').count(), 1);
  } finally { await page.close(); await other.close(); }
});

test('corrupt data, malformed sharing and unavailable storage do not break adding', async () => {
  const page = await openApp();
  try {
    await page.evaluate(() => localStorage.setItem('multiwin.session.v1', '{bad'));
    await page.goto(localURL + '#setup=%invalid');
    await page.reload();
    assert.match(await page.locator('#setupStatus').innerText(), /invalid/);
    await page.evaluate(() => Object.defineProperty(window, 'localStorage', {
      get() { throw new Error('Storage blocked'); }
    }));
    await addId(page, 'M7lc1UVf-VE');
    assert.equal(await page.locator('.video-wrapper').count(), 1);
    assert.match(await page.locator('#setupStatus').innerText(), /storage is unavailable/);
  } finally { await page.close(); }
});

test('Listen selects one player; global pause, play and mute affect every player', async () => {
  const page = await openApp();
  try {
    await addId(page, 'M7lc1UVf-VE');
    await addId(page, 'y0sF5xhGreA');
    const audio = page.locator('.audio-btn');
    await page.locator('.video-wrapper').first().hover();
    await audio.first().click();
    assert.deepEqual(await page.evaluate(() => [...players.values()].map(r => r.player.muted)), [false, true]);
    await page.locator('.video-wrapper').last().hover();
    await audio.last().click();
    assert.deepEqual(await page.evaluate(() => [...players.values()].map(r => r.player.muted)), [true, false]);
    await openControls(page);
    await page.locator('#pauseAll').click();
    assert.deepEqual(await page.evaluate(() => [...players.values()].map(r => r.player.paused)), [true, true]);
    await addId(page, 'dQw4w9WgXcQ');
    await page.waitForFunction(() => [...players.values()].every(r => r.ready));
    assert.deepEqual(await page.evaluate(() => [...players.values()].map(r => r.player.paused)), [true, true, true]);
    await openControls(page);
    await page.locator('#playAll').click();
    assert.deepEqual(await page.evaluate(() => [...players.values()].map(r => r.player.paused)), [false, false, false]);
    await openControls(page);
    await page.locator('#muteAll').click();
    assert.deepEqual(await page.evaluate(() => [...players.values()].map(r => r.player.muted)), [true, true, true]);
    assert.equal(await page.locator('.audio-selected').count(), 0);
  } finally { await page.close(); }
});

test('audio choice restores muted and API failures offer recovery', async () => {
  const page = await openApp();
  try {
    await addId(page, 'M7lc1UVf-VE');
    await page.locator('.video-wrapper').hover();
    await page.locator('.audio-btn').click();
    await page.reload();
    await page.waitForFunction(() => [...players.values()].every(r => r.ready));
    assert.equal(await page.locator('.audio-btn').innerText(), 'Resume audio');
    assert.equal(await page.evaluate(() => [...players.values()][0].player.muted), true);
    await page.evaluate(() => [...players.values()][0].player.events.onAutoplayBlocked());
    assert.match(await page.locator('.player-status').innerText(), /Play button/);
    await page.evaluate(() => [...players.values()][0].player.events.onError({ data: 153 }));
    assert.match(await page.locator('.player-status').innerText(), /identify this site/);
    assert.match(await page.locator('.player-status a').getAttribute('href'), /youtube.com\/watch/);
    await page.locator('.video-wrapper').hover();
    await page.locator('.ctrl.close').click();
    await page.waitForFunction(() => players.size === 0);
    assert.equal(await page.evaluate(() => Object.values(window.__players)[0].destroyed), true);
  } finally { await page.close(); }
});

test('blocked player API leaves embeds usable and shows a fallback', async () => {
  const page = await openApp();
  try {
    await page.route('https://www.youtube.com/iframe_api', route => route.abort());
    await addId(page, 'M7lc1UVf-VE');
    await page.waitForFunction(() => document.querySelector('.player-status').textContent.includes('could not load'));
    assert.equal(await page.locator('iframe').count(), 1);
    assert.equal(await page.locator('.audio-btn').isDisabled(), true);
  } finally { await page.close(); }
});

test('loading a preset during a removal animation does not destroy its replacement player', async () => {
  const page = await openApp();
  try {
    await addId(page, 'M7lc1UVf-VE');
    await page.evaluate(() => {
      const setup = getSetup();
      removeVideo(grid.querySelector('.video-wrapper'));
      restoreSetup(setup);
    });
    const result = await page.evaluate(() => new Promise(resolve => setTimeout(() => {
      resolve({ count: players.size, frames: document.querySelectorAll('iframe').length });
    }, 400)));
    assert.deepEqual(result, { count: 1, frames: 1 });
  } finally { await page.close(); }
});

test('horizontal drops reorder within a row and preserve the iframe in supporting browsers', async () => {
  const page = await openApp({ viewport: { width: 1440, height: 1000 } });
  try {
    for (const id of ['M7lc1UVf-VE', 'y0sF5xhGreA', 'dQw4w9WgXcQ']) await addId(page, id);
    const first = page.locator('.video-wrapper').first();
    const key = await first.getAttribute('data-key');
    const second = page.locator('.video-wrapper').nth(1);
    const box = await second.boundingBox();
    const frame = page.frames().find(frame => frame.url().includes('/embed/M7lc1UVf-VE'));
    await frame.evaluate(() => window.moveMarker = 'preserved');
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await first.dispatchEvent('dragstart', { dataTransfer: transfer });
    await second.dispatchEvent('dragover', { dataTransfer: transfer, clientX: box.x + box.width - 5, clientY: box.y + 30 });
    await second.dispatchEvent('drop', { dataTransfer: transfer, clientX: box.x + box.width - 5, clientY: box.y + 30 });
    await page.locator(`[data-key="${key}"]`).dispatchEvent('dragend', { dataTransfer: transfer });
    assert.deepEqual(await page.evaluate(() => getSetup().videos.map(v => v.id)), ['y0sF5xhGreA', 'M7lc1UVf-VE', 'dQw4w9WgXcQ']);
    if (await page.evaluate(() => typeof grid.moveBefore === 'function')) {
      assert.equal(await frame.evaluate(() => window.moveMarker), 'preserved');
    }
    await page.reload();
    assert.equal(await page.locator('.video-wrapper').nth(1).getAttribute('data-key'), key);
  } finally { await page.close(); }
});

test('layout and focus restore; mobile sizing stays inside the viewport; whole grid can fullscreen', async () => {
  const page = await openApp({ viewport: { width: 1440, height: 1000 } });
  try {
    for (const id of ['M7lc1UVf-VE', 'y0sF5xhGreA', 'dQw4w9WgXcQ']) await addId(page, id);
    await openControls(page);
    await page.locator('#layoutMode').selectOption('two');
    assert.equal(await page.locator('#grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 2);
    const third = page.locator('.video-wrapper').nth(2);
    await closeControls(page);
    await third.hover();
    await third.locator('.focus-video').click();
    assert.equal(await page.locator('.video-wrapper').first().getAttribute('data-video-id'), 'dQw4w9WgXcQ');
    await page.reload();
    assert.equal(await page.locator('#layoutMode').inputValue(), 'focus');
    await page.waitForFunction(() => [...players.values()].every(r => r.ready));
    if (process.env.REVIEW_SCREENSHOTS) await page.screenshot({ path: '/tmp/multiwin-desktop.png', fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => adjustSize(grid.querySelector('.video-wrapper'), 2));
    await page.waitForFunction(() => getComputedStyle(grid).gridTemplateColumns.split(' ').length === 1);
    const bounds = await page.locator('.video-wrapper').first().boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth), true);
    if (process.env.REVIEW_SCREENSHOTS) await page.screenshot({ path: '/tmp/multiwin-mobile.png', fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openControls(page);
    await page.locator('#gridFullscreen').click();
    await page.waitForFunction(() => document.fullscreenElement?.id === 'viewer');
    assert.equal(await page.locator('#controlPanel').isVisible(), false);
    await openControls(page);
    assert.equal(await page.locator('#pauseAll').isVisible(), true);
    await page.evaluate(() => document.exitFullscreen());
  } finally { await page.close(); }
});

test('YouTube parsing accepts supported formats, preserves timestamps and rejects lookalike hosts', async () => {
  const page = await openApp();
  try {
    const cases = [
      ['https://www.youtube.com/live/M7lc1UVf-VE?t=1h2m3s', { id: 'M7lc1UVf-VE', start: 3723 }],
      ['https://youtu.be/M7lc1UVf-VE?t=90', { id: 'M7lc1UVf-VE', start: 90 }],
      ['https://m.youtube.com/watch?v=M7lc1UVf-VE#t=90', { id: 'M7lc1UVf-VE', start: 90 }],
      ['https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?start=40', { id: 'M7lc1UVf-VE', start: 40 }],
      ['youtube.com/shorts/M7lc1UVf-VE', { id: 'M7lc1UVf-VE', start: 0 }]
    ];
    for (const [input, expected] of cases) assert.deepEqual(await page.evaluate(input => parseYouTubeLink(input), input), expected);
    for (const input of [
      'https://example.com/?v=M7lc1UVf-VE', 'https://youtube.com.evil.test/watch?v=M7lc1UVf-VE',
      'https://youtu.be/M7lc1UVf-VEextra', 'https://www.youtube.com/playlist?list=PL123',
      'javascript:alert(1)', 'https://youtube.com/watch?v=M7lc1UVf-VE&t=oops'
    ]) assert.ok((await page.evaluate(input => parseYouTubeLink(input), input)).error, input);
  } finally { await page.close(); }
});

test('mixed batches preserve rejected input and timestamps survive refresh', async () => {
  const page = await openApp();
  try {
    await openControls(page);
    await page.locator('#urlInput').fill('https://youtube.com/live/M7lc1UVf-VE?t=1m30s\nbad-link\nhttps://youtu.be/y0sF5xhGreA?start=42');
    await page.locator('#urlInput').press('Enter');
    assert.equal(await page.locator('.video-wrapper').count(), 2);
    assert.equal(await page.locator('#urlInput').isVisible(), true);
    assert.equal(await page.locator('#urlInput').inputValue(), 'bad-link');
    assert.equal(await page.locator('#urlInput').getAttribute('aria-invalid'), 'true');
    assert.match(await page.locator('#inputFeedback').innerText(), /1 link/);
    assert.equal(new URL(await page.locator('iframe').first().getAttribute('src')).searchParams.get('start'), '90');
    await page.reload();
    assert.deepEqual(await page.evaluate(() => getSetup().videos.map(v => v.start)), [90, 42]);
    await openControls(page);
    await page.locator('#urlInput').fill('dQw4w9WgXcQ');
    await page.locator('#urlInput').press('Shift+Enter');
    assert.equal(await page.locator('.video-wrapper').count(), 2);
    await page.locator('#urlInput').press('Enter');
    assert.equal(await page.locator('.video-wrapper').count(), 3);
  } finally { await page.close(); }
});

test('keyboard reordering keeps focus and removal recovers to a neighboring card', async () => {
  const page = await openApp({ reducedMotion: 'reduce' });
  try {
    await addId(page, 'M7lc1UVf-VE');
    await addId(page, 'y0sF5xhGreA');
    const firstKey = await page.locator('.video-wrapper').first().getAttribute('data-key');
    await page.locator('.move-later').first().focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.video-wrapper').last().getAttribute('data-key'), firstKey);
    assert.equal(await page.locator('.move-earlier').last().evaluate(el => el === document.activeElement), true);
    assert.match(await page.locator('#setupStatus').innerText(), /position 2 of 2/);
    await page.locator('.ctrl.close').last().focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.video-wrapper').length === 1);
    assert.equal(await page.locator('.video-wrapper').evaluate(el => el.contains(document.activeElement)), true);
    await page.locator('.ctrl.close').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.video-wrapper').length === 0);
    assert.equal(await page.locator('#urlInput').evaluate(el => el === document.activeElement), true);
  } finally { await page.close(); }
});

test('touch users can show controls without adding borders or shifting videos', async () => {
  const page = await openApp({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  try {
    await addId(page, 'M7lc1UVf-VE');
    await addId(page, 'y0sF5xhGreA');
    const before = await page.locator('iframe').first().boundingBox();
    assert.equal(await page.locator('.card-tools').first().evaluate(el => getComputedStyle(el).opacity), '0');
    await openControls(page);
    await page.getByRole('button', { name: 'Show video controls', exact: true }).tap();
    await closeControls(page);
    assert.equal(await page.locator('#showVideoControls').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await page.locator('iframe').first().boundingBox(), before);
    for (const button of await page.locator('.video-wrapper').first().locator('button').all()) {
      assert.equal(await button.isVisible(), true);
      const box = await button.boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44);
    }
    assert.equal(await page.locator('.card-tools').first().evaluate(el => getComputedStyle(el).opacity), '1');
    assert.equal(await page.locator('h1').evaluate(el => getComputedStyle(el).animationName), 'none');
    assert.equal(await page.locator('.video-wrapper').first().evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    await page.locator('.move-later').first().tap();
    assert.equal(await page.locator('.video-wrapper').first().getAttribute('data-video-id'), 'y0sF5xhGreA');
    await openControls(page);
    await page.getByRole('button', { name: 'Hide video controls', exact: true }).tap();
    await closeControls(page);
    assert.equal(await page.locator('.card-tools').first().evaluate(el => getComputedStyle(el).opacity), '0');
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth), true);
  } finally { await page.close(); }
});

test('the populated interface has no detected WCAG A/AA violations', async () => {
  const page = await openApp({ reducedMotion: 'reduce' });
  try {
    await addId(page, 'M7lc1UVf-VE');
    await page.waitForFunction(() => [...players.values()].every(r => r.ready));
    await openControls(page);
    await page.locator('#savedSetups summary').click();
    await openControls(page);
    await page.locator('#showVideoControls').click();
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
    const violations = await page.evaluate(async () => (await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] }
    })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(n => n.target) })));
    assert.deepEqual(violations, []);
  } finally { await page.close(); }
});

test('the drag handle can drop over a video without the iframe swallowing pointer events', async () => {
  const page = await openApp({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  try {
    await addId(page, 'M7lc1UVf-VE');
    await addId(page, 'y0sF5xhGreA');
    const target = page.locator('.player-frame').last();
    const box = await target.boundingBox();
    await page.locator('.video-wrapper').first().hover();
    await page.locator('.drag-handle').first().dragTo(target, {
      targetPosition: { x: box.width - 30, y: box.height - 50 }
    });
    assert.deepEqual(await page.evaluate(() => getSetup().videos.map(v => v.id)), ['y0sF5xhGreA', 'M7lc1UVf-VE']);
    assert.equal(await page.locator('#grid').evaluate(el => el.classList.contains('is-dragging')), false);
  } finally { await page.close(); }
});

test('six streams form a compact 3 by 2 wall with controls revealed by hover and keyboard', async () => {
  const page = await openApp({ viewport: { width: 1920, height: 1080 } });
  try {
    await openControls(page);
    await page.locator('#urlInput').fill(Array(6).fill('M7lc1UVf-VE').join('\n'));
    await page.locator('#addBtn').click();
    await page.waitForFunction(() => players.size === 6 && [...players.values()].every(r => r.ready));
    const cards = await page.locator('.video-wrapper').all();
    const boxes = await Promise.all(cards.map(card => card.boundingBox()));
    assert.equal(boxes[0].y, 4);
    assert.equal(boxes[0].y, boxes[2].y);
    assert.equal(boxes[3].y, boxes[5].y);
    assert.equal(boxes[3].x, boxes[0].x);
    assert.ok(boxes[3].y > boxes[0].y);
    assert.equal(Math.round(boxes[1].x - boxes[0].x - boxes[0].width), 4);
    const frameBox = await cards[0].locator('iframe').boundingBox();
    assert.equal(Math.round(boxes[0].height - frameBox.height), 2);
    const tools = cards[0].locator('.card-tools');
    assert.equal(await tools.evaluate(el => getComputedStyle(el).opacity), '0');
    await cards[0].hover();
    assert.equal(await tools.evaluate(el => getComputedStyle(el).opacity), '1');
    await cards[0].locator('.audio-btn').click();
    await page.mouse.move(0, 0);
    assert.equal(await tools.evaluate(el => getComputedStyle(el).opacity), '0');
    // Tabbing past the floating button skips the closed panel.
    await page.locator('#togglePanel').focus();
    await page.keyboard.press('Tab');
    assert.equal(await cards[0].locator('.drag-handle').evaluate(el => el === document.activeElement), true);
    assert.equal(await tools.evaluate(el => getComputedStyle(el).opacity), '1');
    assert.deepEqual(await cards[0].locator('iframe').boundingBox(), frameBox);
    await openControls(page);
    await page.locator('#showVideoControls').click();
    await openControls(page);
    await page.locator('#gridFullscreen').click();
    await page.waitForFunction(() => document.fullscreenElement?.id === 'viewer');
    assert.equal(await tools.evaluate(el => getComputedStyle(el).opacity), '1');
    await page.evaluate(() => document.exitFullscreen());
  } finally { await page.close(); }
});


test('the floating panel keeps draft links and iframe state without shifting the wall', async () => {
  const page = await openApp({ viewport: { width: 1440, height: 900 } });
  try {
    assert.equal(await page.locator('#controlPanel').isVisible(), true);
    await addId(page, 'M7lc1UVf-VE');
    assert.equal(await page.locator('#controlPanel').isVisible(), false);
    assert.equal(await page.locator('#togglePanel').getAttribute('aria-expanded'), 'false');
    const video = page.locator('iframe');
    const bounds = await video.boundingBox();
    assert.equal(bounds.y, 5);
    const frame = page.frames().find(frame => frame.url().includes('/embed/'));
    await frame.evaluate(() => window.panelMarker = 'still playing');
    await openControls(page);
    await page.locator('#urlInput').fill('a draft I am still editing');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('setupStatus')).opacity === '0', null, { timeout: 8000 });
    assert.deepEqual(await video.boundingBox(), bounds);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#controlPanel').isVisible(), false);
    assert.equal(await page.locator('#togglePanel').evaluate(el => el === document.activeElement), true);
    await openControls(page);
    assert.equal(await page.locator('#urlInput').inputValue(), 'a draft I am still editing');
    await closeControls(page);
    assert.deepEqual(await video.boundingBox(), bounds);
    assert.equal(await frame.evaluate(() => window.panelMarker), 'still playing');
    await page.reload();
    assert.equal(await page.locator('iframe').count(), 1);
    assert.equal(await page.locator('#controlPanel').isVisible(), false);
  } finally { await page.close(); }
});

test('the panel is reachable on a small touchscreen and in grid fullscreen', async () => {
  const page = await openApp({ viewport: { width: 390, height: 640 }, hasTouch: true, isMobile: true });
  try {
    await addId(page, 'M7lc1UVf-VE');
    await page.locator('#togglePanel').tap();
    assert.equal(await page.locator('#urlInput').evaluate(el => el === document.activeElement), false);
    const panel = await page.locator('#controlPanel').boundingBox();
    assert.ok(panel.x >= 0 && panel.x + panel.width <= 390 && panel.y + panel.height <= 640);
    await page.locator('#savedSetups summary').tap();
    await page.locator('#presetName').fill('News wall');
    await page.locator('#savePreset').tap();
    assert.equal(await page.locator('#presetSelect option').count(), 2);
    await page.locator('#gridFullscreen').tap();
    await page.waitForFunction(() => document.fullscreenElement?.id === 'viewer');
    assert.equal(await page.locator('#controlPanel').isVisible(), false);
    await page.locator('#togglePanel').tap();
    await page.locator('#muteAll').tap();
    await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).tap();
    await page.waitForFunction(() => !document.fullscreenElement);
    assert.equal(await page.locator('#controlPanel').isVisible(), false);
  } finally { await page.close(); }
});
