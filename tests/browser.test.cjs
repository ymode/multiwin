// YouTube is intercepted: these check browser behaviour, NOT live playback.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

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
      await page.route('https://www.youtube.com/**', async route => {
        requests.push({ url: route.request().url(), headers: await route.request().allHeaders() });
        await route.fulfill({ contentType: 'text/html', body: '<p>Intercepted test embed</p>' });
      });
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
      await page.locator('#urlInput').fill('invalid');
      await page.locator('#addBtn').click();
      assert.equal(await page.locator('iframe').count(), 0);
      for (const [index, video] of videos.entries()) {
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
      await first.getByRole('button', { name: '+', exact: true }).click();
      assert.equal(await first.evaluate(el => el.style.getPropertyValue('--size')), '2');
      await first.getByRole('button', { name: '−', exact: true }).click();
      assert.equal(await first.evaluate(el => el.style.getPropertyValue('--size')), '1');
      await first.getByRole('button', { name: '⛶', exact: true }).click();
      await page.waitForFunction(() => document.fullscreenElement !== null);
      await page.evaluate(() => document.exitFullscreen());
      // Reorder via the browser's drag events using the existing handlers.
      const original = await first.locator('iframe').getAttribute('src');
      const transfer = await page.evaluateHandle(() => new DataTransfer());
      await first.dispatchEvent('dragstart', { dataTransfer: transfer });
      await page.locator('.video-wrapper').last().dispatchEvent('dragover',
        { dataTransfer: transfer, clientY: 10000 });
      await page.locator('.video-wrapper').last().dispatchEvent('dragend', { dataTransfer: transfer });
      assert.equal(await page.locator('.video-wrapper').last().locator('iframe').getAttribute('src'), original);
      while (await page.locator('.video-wrapper').count()) {
        const count = await page.locator('.video-wrapper').count();
        await page.locator('.video-wrapper').first().hover();
        await page.locator('.ctrl.close').first().click();
        await page.waitForFunction(n => document.querySelectorAll('.video-wrapper').length === n - 1, count);
      }
      assert.equal(await page.locator('.empty-state').isVisible(), true);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
}
