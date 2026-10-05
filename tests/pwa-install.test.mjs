import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInstallController, installPlatform} from '../lib/life/pwa-install.ts';

function fixture(overrides = {}) {
  const browser = new EventTarget();
  const media = new EventTarget();
  media.matches = false;
  browser.navigator = {userAgent: 'Chrome Android', platform: 'Linux', maxTouchPoints: 1};
  browser.isSecureContext = true;
  browser.matchMedia = query => {assert.equal(query, '(display-mode: standalone)'); return media;};
  Object.assign(browser, overrides);
  const controller = createInstallController(browser);
  const unsubscribe = controller.subscribe(() => {});
  return {browser, media, controller, unsubscribe};
}
function promptEvent(prompt, userChoice) {
  const event = new Event('beforeinstallprompt', {cancelable: true});
  event.prompt = prompt;
  if (userChoice) event.userChoice = userChoice;
  return event;
}

test('server rendering has a stable browser-free snapshot', () => {
  const controller = createInstallController();
  assert.equal(controller.getServerSnapshot(), controller.getSnapshot());
  const unsubscribe = controller.subscribe(() => {});
  assert.equal(controller.getSnapshot().platform, 'unknown');
  unsubscribe();
});
test('recognizes iPhone, iPad desktop mode, Android and actual Mac', () => {
  assert.equal(installPlatform({userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5}), 'ios');
  assert.equal(installPlatform({userAgent: 'Safari Macintosh', platform: 'MacIntel', maxTouchPoints: 5}), 'ios');
  assert.equal(installPlatform({userAgent: 'Android', platform: 'Linux', maxTouchPoints: 5}), 'android');
  assert.equal(installPlatform({userAgent: 'Safari Macintosh', platform: 'MacIntel', maxTouchPoints: 0}), 'desktop');
});
test('installation is not prompted automatically', () => {
  const {browser, controller} = fixture();
  let calls = 0;
  const event = promptEvent(async () => {calls++; return {outcome: 'accepted'};});
  browser.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(calls, 0);
  assert.equal(controller.getSnapshot().canPrompt, true);
});
test('a prompt is consumed once; acceptance is not installation proof', async () => {
  const {browser, controller} = fixture();
  let calls = 0;
  browser.dispatchEvent(promptEvent(async () => {calls++; return {outcome: 'accepted'};}));
  assert.equal(await controller.requestInstall(), true);
  assert.equal(await controller.requestInstall(), false);
  assert.equal(calls, 1);
  assert.equal(controller.getSnapshot().installed, false);
  assert.equal(controller.getSnapshot().status, 'accepted');
});
test('duplicate clicks cannot issue concurrent prompts', async () => {
  const {browser, controller} = fixture();
  let resolve;
  const result = new Promise(done => {resolve = done;});
  browser.dispatchEvent(promptEvent(() => result));
  const first = controller.requestInstall();
  assert.equal(await controller.requestInstall(), false);
  resolve({outcome: 'accepted'});
  assert.equal(await first, true);
});
test('dismissal returns to manual help without a prompt loop', async () => {
  const {browser, controller} = fixture();
  browser.dispatchEvent(promptEvent(async () => ({outcome: 'dismissed'})));
  assert.equal(await controller.requestInstall(), false);
  assert.equal(controller.getSnapshot().status, 'dismissed');
  assert.equal(controller.getSnapshot().canPrompt, false);
});
test('older prompt implementations can return their userChoice promise', async () => {
  const {browser, controller} = fixture();
  browser.dispatchEvent(promptEvent(async () => {}, Promise.resolve({outcome: 'accepted'})));
  assert.equal(await controller.requestInstall(), true);
});
test('a prompt without a reported outcome does not invent success', async () => {
  const {browser, controller} = fixture();
  browser.dispatchEvent(promptEvent(async () => {}));
  assert.equal(await controller.requestInstall(), false);
  assert.equal(controller.getSnapshot().status, 'idle');
});
test('prompt exceptions produce recoverable browser-menu guidance', async () => {
  const {browser, controller} = fixture();
  browser.dispatchEvent(promptEvent(async () => {throw Error('activation expired');}));
  assert.equal(await controller.requestInstall(), false);
  assert.equal(controller.getSnapshot().status, 'error');
});
test('appinstalled wins over a late prompt result', async () => {
  const {browser, controller} = fixture();
  browser.dispatchEvent(promptEvent(async () => {browser.dispatchEvent(new Event('appinstalled')); return {outcome: 'accepted'};}));
  await controller.requestInstall();
  assert.equal(controller.getSnapshot().installed, true);
  assert.equal(controller.getSnapshot().status, 'idle');
  assert.equal(controller.getSnapshot().canPrompt, false);
});
test('iOS standalone detection does not depend on Chromium events', () => {
  const {controller} = fixture({navigator: {userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5, standalone: true}});
  assert.equal(controller.getSnapshot().installed, true);
});
test('display mode changes clear an obsolete install prompt', () => {
  const {browser, media, controller} = fixture();
  browser.dispatchEvent(promptEvent(async () => ({outcome: 'accepted'})));
  media.matches = true;
  media.dispatchEvent(new Event('change'));
  assert.equal(controller.getSnapshot().installed, true);
  assert.equal(controller.getSnapshot().canPrompt, false);
});
test('insecure pages cannot consume an installation prompt', async () => {
  const {browser, controller} = fixture({isSecureContext: false});
  const event = promptEvent(async () => ({outcome: 'accepted'}));
  browser.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  assert.equal(await controller.requestInstall(), false);
});
test('unsubscribing detaches browser and display-mode handlers', () => {
  const {browser, media, controller, unsubscribe} = fixture();
  unsubscribe();
  const snapshot = controller.getSnapshot();
  browser.dispatchEvent(promptEvent(async () => ({outcome: 'accepted'})));
  browser.dispatchEvent(new Event('appinstalled'));
  media.matches = true;
  media.dispatchEvent(new Event('change'));
  assert.equal(controller.getSnapshot(), snapshot);
});
test('the existing manifest keeps its identity, launch route and icons', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  for (const size of ['192x192', '512x512']) assert.ok(manifest.icons.some(icon => icon.sizes === size && icon.type === 'image/png' && icon.src.startsWith('/')));
});
test('installation links open separately without discarding current drafts or saved-day sign-in links', () => {
  for (const path of ['../app/life/settings.tsx', '../app/sign-in/sign-in-card.tsx']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /href="\/install" target="_blank" rel="noopener noreferrer"/);
  }
});
test('the install page contains no consent, service-worker, reload or account mutations', () => {
  const source = readFileSync(new URL('../app/install/install-card.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fetch\(|localStorage|indexedDB|serviceWorker|Notification\.requestPermission|location\.(assign|reload)/);
  assert.match(source, /role="status"/);
  assert.match(source, /Add to Home Screen/);
  assert.match(source, /saved on this device is different from synced/);
});
