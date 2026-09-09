import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { handleLife } from '../lib/life/service.ts';
import { planDailyReviews } from '../lib/life/scheduler.ts';
import { consumeDailyReviews, AUTOMATIC_BATCH_SIZE, scheduledDailyReviews } from '../lib/life/automatic-reviews.ts';
import { validateBackup } from '../lib/life/migration-preview.ts';

const now = new Date('2026-09-09T12:00:00Z'), date = '2026-09-08', optedAt = new Date('2026-09-08T12:00:00Z');
const providerResult = { text: 'Synthetic daily review', inputTokens: 100, outputTokens: 40, thoughtTokens: 10, costMicros: 225, providerId: 'synthetic', modelVersion: 'synthetic', finishReason: 'STOP' };
const review = () => ({ action: 'ai', review: { date, requestId: randomUUID(), sourceVersion: 1, predecessorId: null, critique: '', consent: true } });
function fixture(generate = async () => providerResult) {
  const raw = new DatabaseSync(':memory:');
  for (const file of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) raw.exec(readFileSync('drizzle/' + file, 'utf8'));
  const db = { prepare(sql) { return { bind(...params) { const q = raw.prepare(sql); return { async first() { return q.get(...params) || null; }, async all() { return { results: q.all(...params) }; } }; } }; } };
  let calls = 0;
  const settings = { enabled: true, automaticEnabled: true, provider: { generate: async input => { calls++; return generate(input); } }, userCapMicros: 1000000, globalCapMicros: 5000000 };
  const call = (body, id = 'a', path = '', at = now, origin = 'https://life.test') => handleLife(new Request('https://life.test/api/life' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Origin: origin }, body: body ? JSON.stringify(body) : undefined }), id, db, at, settings);
  const consent = (enabled = true, version = 0, id = 'a', at = optedAt) => call({ action: 'automatic-consent', consent: { enabled, version, policyVersion: 'daily-v1' } }, id, '', at);
  async function setup(id = 'a', complete = true) {
    assert.equal((await call({ action: 'profile', profile: { goal: 'Synthetic goal', timezone: 'UTC', modules: ['reflection'], habits: [], version: 0 } }, id)).status, 200);
    assert.equal((await call({ action: 'entry', entry: { date, journal: 'Synthetic check-in', context: {}, statuses: [], version: 0, complete } }, id)).status, 200);
  }
  async function ready(id = 'a') { await setup(id); assert.equal((await consent(true, 0, id)).status, 200); await planDailyReviews(db, now); }
  return { raw, db, settings, call, consent, setup, ready, calls: () => calls };
}

test('automatic consent is separate, off by default, private, versioned and origin-protected', async () => {
  const f = fixture(); await f.setup(); await f.setup('b'); await planDailyReviews(f.db, now);
  assert.equal((await (await f.call(undefined, 'a', '?automatic=1')).json()).consent.enabled, false);
  await consumeDailyReviews(f.db, f.settings, () => now); assert.equal(f.calls(), 0);
  const body = { action: 'automatic-consent', consent: { enabled: true, version: 0, policyVersion: 'daily-v1' } };
  assert.equal((await f.call(body, null)).status, 401);
  assert.equal((await f.call(body, 'a', '', now, 'https://evil.test')).status, 403);
  assert.equal((await f.call({ ...body, consent: { ...body.consent, userId: 'b' } })).status, 400);
  f.settings.automaticEnabled = false; assert.equal((await f.consent()).status, 503);
  f.settings.automaticEnabled = true;
  const accepted = await f.consent(); assert.equal(accepted.status, 200); assert.equal(accepted.headers.get('cache-control'), 'private, no-store');
  assert.equal((await accepted.json()).consent.startDate, date);
  assert.equal((await (await f.call(undefined, 'b', '?automatic=1&userId=a')).json()).consent.enabled, false);
  assert.equal((await f.consent(false, 1)).status, 200);
  assert.equal((await f.consent(true, 1)).status, 409); // Old enable cannot undo opt-out.
  f.settings.enabled = false; assert.equal((await f.consent(false, 2)).status, 200);
  assert.equal((await (await f.call(undefined, 'a', '?automatic=1')).json()).consent.enabled, false);
  f.raw.close();
});

test('automatic and manual original requests share one admission even across overlapping ticks', async () => {
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  const f = fixture(async () => pending); await f.ready();
  const runs = [consumeDailyReviews(f.db, f.settings, () => now), consumeDailyReviews(f.db, f.settings, () => now), f.call(review())];
  await new Promise(r => setImmediate(r)); assert.equal(f.calls(), 1);
  resolve(providerResult); await Promise.all(runs);
  await consumeDailyReviews(f.db, f.settings, () => now);
  assert.equal(f.calls(), 1); assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM life_ai_reviews').get().n, 1);
  assert.equal(f.raw.prepare('SELECT cost_micros FROM life_ai_reviews').get().cost_micros, 225);
  f.raw.close();
});

test('atomic admission rejects opt-out, preference, entry and consent-policy races', async () => {
  for (const mutation of [
    raw => raw.exec('UPDATE life_automatic_consent SET enabled=0,version=version+1'),
    raw => raw.exec("UPDATE life_automatic_consent SET policy_version='obsolete'"),
    raw => raw.exec('UPDATE life_automatic_consent SET version=version+1'),
    raw => raw.exec("UPDATE life_profiles SET payload=json_set(payload,'$.reviewPreferences.daily.enabled',0),version=version+1"),
    raw => raw.exec("UPDATE life_entries SET payload=json_set(payload,'$.complete',0),version=version+1")
  ]) {
    const f = fixture(); await f.ready(); let changed = false;
    const racing = { prepare(sql) { return { bind(...args) { const bound = f.db.prepare(sql).bind(...args); return { ...bound, async first() { if (sql.startsWith('INSERT INTO life_ai_reviews') && !changed) { changed = true; mutation(f.raw); } return bound.first(); } }; } }; } };
    await consumeDailyReviews(racing, f.settings, () => now);
    assert.equal(changed, true); assert.equal(f.calls(), 0);
    assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM life_ai_reviews').get().n, 0); f.raw.close();
  }
});

test('start day, current local schedule and late completion gate automatic context use', async () => {
  const f = fixture(); await f.setup('a', false);
  await f.consent(true, 0, 'a', now); await planDailyReviews(f.db, now);
  await consumeDailyReviews(f.db, f.settings, () => now); assert.equal(f.calls(), 0);
  // Reconstruct an earlier synthetic opt-in, then finish a previously held day.
  f.raw.prepare('UPDATE life_automatic_consent SET start_date=?,accepted_at=?').run(date, optedAt.toISOString());
  await consumeDailyReviews(f.db, f.settings, () => now); assert.equal(f.calls(), 0);
  assert.equal((await f.call({ action: 'entry', entry: { date, journal: 'Synthetic late completion', context: {}, statuses: [], version: 1, complete: true } })).status, 200);
  f.raw.exec("UPDATE life_profiles SET payload=json_set(payload,'$.reviewPreferences.daily.time','23:00'),version=version+1");
  await consumeDailyReviews(f.db, f.settings, () => now); assert.equal(f.calls(), 0);
  f.raw.exec("UPDATE life_profiles SET payload=json_set(payload,'$.reviewPreferences.daily.time','08:00'),version=version+1");
  await consumeDailyReviews(f.db, f.settings, () => now); assert.equal(f.calls(), 1);
  const row = f.raw.prepare('SELECT * FROM life_ai_reviews').get(); assert.equal(row.source_version, 2);
  assert.equal(JSON.parse(row.input_snapshot).automaticConsent.policyVersion, 'daily-v1');
  const backup = await (await f.call(undefined, 'a', '?export=1')).text();
  assert.equal(validateBackup(backup).reviews.length, 1);
  assert.equal(JSON.parse(backup).automaticConsent, undefined); // Evidence is not an active grant on import.
  f.raw.close();
});

test('uncertain automatic attempts keep holds and are never repeated after opt-out/re-enable', async () => {
  const f = fixture(async () => { throw Error('Synthetic ambiguous response'); }); await f.ready();
  const stats = await consumeDailyReviews(f.db, f.settings, () => now); assert.equal(stats.attention, 1);
  const held = f.raw.prepare('SELECT * FROM life_ai_reviews').get();
  assert.equal(held.status, 'uncertain'); assert.equal(held.cost_micros, null); assert.equal(held.reserved_micros, 200000);
  await f.consent(false, 1); await f.consent(true, 2);
  await consumeDailyReviews(f.db, f.settings, () => now); await f.call(review());
  assert.equal(f.calls(), 1); assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM life_ai_reviews').get().n, 1); f.raw.close();
});

test('bounded consumer rotates capped jobs and checks pricing at execution time', async () => {
  const f = fixture();
  for (let i = 0; i < AUTOMATIC_BATCH_SIZE + 1; i++) await f.ready('synthetic-' + i);
  f.settings.userCapMicros = 0;
  const first = await consumeDailyReviews(f.db, f.settings, () => now);
  assert.equal(first.considered, AUTOMATIC_BATCH_SIZE); assert.equal(first.deferred, AUTOMATIC_BATCH_SIZE); assert.equal(f.calls(), 0);
  await consumeDailyReviews(f.db, f.settings, () => new Date(now.valueOf() + 60000));
  assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM life_review_jobs WHERE last_considered_at IS NOT NULL').get().n, AUTOMATIC_BATCH_SIZE + 1);
  const noDb = { prepare() { throw Error('must not read'); } };
  assert.equal((await consumeDailyReviews(noDb, f.settings, () => new Date('2027-01-01T00:00:00Z'))).considered, 0);
  await scheduledDailyReviews({ DB: noDb, LIFEAPP_AUTH_MODE: 'google', LIFEAPP_AI_ENABLED: 'true', LIFEAPP_AI_PAID_PROJECT: 'true', LIFEAPP_AUTOMATIC_REVIEWS_ENABLED: 'true' }, now.valueOf());
  f.raw.close();
});

test('automatic provider costs share the same global cap and circuit breaker as manual reviews', async () => {
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  const f = fixture(async () => pending); await f.ready('a'); await f.ready('b');
  f.settings.globalCapMicros = 200000;
  const runs = [consumeDailyReviews(f.db, f.settings, () => now), f.call(review(), 'b')];
  await new Promise(r => setImmediate(r)); assert.equal(f.calls(), 1);
  resolve({ ...providerResult, costMicros: 200001 }); await Promise.all(runs);
  await consumeDailyReviews(f.db, f.settings, () => now); assert.equal(f.calls(), 1);
  assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM life_ai_reviews WHERE error_code='cost_bound_exceeded'").get().n, 1); f.raw.close();
});

test('planner backlog progresses within the D1 budget while two module-rich reviews settle', async () => {
  const f = fixture();
  for(let i=0;i<23;i++) {
    const id='synthetic-'+String(i).padStart(2,'0'); await f.setup(id); await f.consent(true,0,id);
    f.raw.prepare("UPDATE life_profiles SET payload=json_set(payload,'$.modules',json(?)) WHERE user_id=?").run(JSON.stringify(['reflection','money','fitness']),id);
    f.raw.prepare('INSERT INTO life_resources VALUES(?,?,?,?,?,1,?,NULL)').run(id,'budget','2026-09','2026-09',JSON.stringify({currency:'USD',categories:[],recurring:[],goals:{spending:'',saving:'',investing:''}}),now.toISOString());
  }
  let queries=0;
  const counted={prepare(sql){queries++;return f.db.prepare(sql);}};
  assert.equal((await planDailyReviews(counted,now)).discovered,20);
  assert.equal((await consumeDailyReviews(counted,f.settings,()=>now)).completed,2);
  assert.ok(queries<=50,`Used ${queries} D1 queries`);
  assert.equal((await planDailyReviews(f.db,new Date(now.valueOf()+300000))).discovered,3);
  assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM life_review_jobs').get().n,23);
  assert.equal(f.calls(),2);f.raw.close();
});
