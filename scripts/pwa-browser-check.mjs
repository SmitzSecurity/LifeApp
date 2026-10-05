// Compiled-app browser checks against the existing disposable, read-only fixture.
// No production account, Google login, provider request, or real installation.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';

const require = createRequire(resolve(process.env.LIFEAPP_BROWSER_TOOLS || '.', 'package.json'));
const {chromium} = require('playwright');
const fixture = spawn(process.execPath, ['scripts/browser-smoke.mjs'], {stdio: ['ignore', 'pipe', 'pipe']});
let fixtureLog = '';
fixture.stderr.on('data', data => {fixtureLog += data.toString();});
let browser;
try {
  const origin = await new Promise((done, reject) => {
    const timeout = setTimeout(() => reject(Error('Fixture startup timed out: ' + fixtureLog)), 30000);
    fixture.once('error', error => {clearTimeout(timeout); reject(error);});
    fixture.once('exit', code => {clearTimeout(timeout); reject(Error('Fixture stopped: ' + code + '\n' + fixtureLog));});
    fixture.stdout.on('data', data => {
      fixtureLog += data.toString();
      const match = fixtureLog.match(/Synthetic read-only browser fixture: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {clearTimeout(timeout); done(match[1]);}
    });
  });
  browser = await chromium.launch({headless: true});
  const android = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36';
  const context = await browser.newContext({viewport: {width: 390, height: 844}, userAgent: android, isMobile: true, hasTouch: true});
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/install');
  await page.waitForFunction(() => [...document.querySelectorAll('details')].some(element => element.open && element.textContent.includes('Android')));
  assert.equal(await page.locator('link[rel="manifest"]').count(), 1);
  assert.equal((await (await page.request.get(origin + '/manifest.webmanifest')).json()).start_url, '/');
  assert.equal(await page.evaluate(async () => {
    const image = new Image(); image.src = '/app-icon-192.png'; await image.decode(); return image.naturalWidth;
  }), 192);

  // A synthetic browser offer verifies the actual hydrated React handlers.
  await page.evaluate(() => {
    window.__installPromptCalls = 0;
    const event = new Event('beforeinstallprompt', {cancelable: true});
    event.prompt = async () => {window.__installPromptCalls++; return {outcome: 'dismissed'};};
    window.dispatchEvent(event);
  });
  const button = page.getByRole('button', {name: 'Install LifeApp', exact: true});
  await button.waitFor();
  assert.equal(await page.evaluate(() => window.__installPromptCalls), 0);
  for (const [width, height] of [[320, 568], [390, 844], [430, 932], [844, 390], [1440, 900]]) {
    await page.setViewportSize({width, height});
    const metrics = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      targets: [...document.querySelectorAll('main button, main a, main summary')].map(element => element.getBoundingClientRect().height),
      viewport: document.querySelector('meta[name="viewport"]')?.content || '',
    }));
    assert.ok(metrics.overflow <= 1, 'Horizontal overflow at ' + width + ': ' + metrics.overflow);
    assert.ok(metrics.targets.every(height => height >= 44), 'Touch target below 44px at ' + width);
    assert.doesNotMatch(metrics.viewport, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\D|$)/);
  }
  await page.setViewportSize({width: 390, height: 844});
  await button.click();
  await page.waitForFunction(() => document.querySelector('[role="status"]').textContent.includes('cancelled'));
  assert.equal(await page.evaluate(() => window.__installPromptCalls), 1);
  assert.equal(await button.count(), 0);
  await page.getByRole('link', {name: 'Open LifeApp', exact: true}).click();
  await page.getByRole('button', {name: 'Open menu', exact: true}).waitFor();
  assert.equal(new URL(page.url()).pathname, '/');
  assert.deepEqual(errors, [], 'Uncaught browser errors');
  console.log('PASS: compiled install page hydrates; five viewport sizes fit; touch targets and zoom preserved; explicit install cancellation works; router returns to signed-in app.');
  await context.close();

  const ios = await browser.newContext({viewport: {width: 390, height: 844}, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', isMobile: true, hasTouch: true});
  await ios.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const phone = await ios.newPage();
  await phone.goto(origin + '/install');
  await phone.waitForFunction(() => [...document.querySelectorAll('details')].some(element => element.open && element.textContent.includes('iPhone or iPad')));
  assert.equal(await phone.getByRole('button', {name: 'Install LifeApp', exact: true}).count(), 0);
  await phone.addInitScript(() => {Object.defineProperty(navigator, 'standalone', {get: () => true});});
  await phone.reload();
  await phone.waitForFunction(() => document.querySelector('[role="status"]').textContent.includes('app window'));
  assert.equal(await phone.locator('details').count(), 0);
  console.log('PASS: iPhone manual instructions and simulated standalone state; this is Chromium emulation, not physical iOS installation.');
  await ios.close();
} finally {
  await browser?.close();
  fixture.kill('SIGTERM');
}
