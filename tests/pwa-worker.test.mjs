import test, {after, before} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFileSync, readdirSync} from 'node:fs';
import {randomBytes} from 'node:crypto';

const mf = new Miniflare({
  modules: true,
  modulesRules: [{type: 'ESModule', include: ['**/*.js']}],
  scriptPath: 'dist-standalone/server/index.js',
  compatibilityDate: '2026-05-22',
  compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'],
  serviceBindings: {ASSETS: async () => new Response('Not found', {status: 404})},
  bindings: {
    LIFEAPP_AUTH_MODE: 'google',
    BETTER_AUTH_URL: 'https://life.test',
    BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
    GOOGLE_CLIENT_ID: 'synthetic-install-client',
    GOOGLE_CLIENT_SECRET: 'synthetic-install-secret',
    LIFEAPP_BETA_EMAILS: 'owner@example.test',
  },
});
after(() => mf.dispose());
before(async () => {
  const db = await mf.getD1Database('DB');
  // Local isolated test database only; never applies production migrations.
  for (const file of readdirSync('drizzle').filter(file => file.endsWith('.sql')).sort()) {
    for (const sql of readFileSync('drizzle/' + file, 'utf8').split('--> statement-breakpoint')) await db.prepare(sql.trim()).run();
  }
});
test('compiled install route renders useful instructions and inherits the existing manifest', async () => {
  const response = await mf.dispatchFetch('https://life.test/install', {headers: {accept: 'text/html'}});
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Your day, one tap away/);
  assert.match(html, /Add to Home Screen/);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /href="\/"/);
  assert.doesNotMatch(html, /life-offline-account/);
  const db = await mf.getD1Database('DB');
  for (const table of ['life_profiles', 'life_entries', 'life_auth_session']) {
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM ' + table).first()).n, 0);
  }
});
test('install discovery leaves sign-in and private API protection intact', async () => {
  const signIn = await mf.dispatchFetch('https://life.test/sign-in');
  assert.equal(signIn.status, 200);
  const html = await signIn.text();
  assert.match(html, /Continue with Google/);
  assert.match(html, /href="\/install"/);
  const home = await mf.dispatchFetch('https://life.test/', {redirect: 'manual'});
  assert.ok([302, 303, 307, 308].includes(home.status));
  assert.equal(new URL(home.headers.get('location'), 'https://life.test').pathname, '/sign-in');
  assert.equal((await mf.dispatchFetch('https://life.test/api/life')).status, 401);
});
