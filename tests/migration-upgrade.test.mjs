import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { handleLife } from '../lib/life/service.ts';
import { planDailyReviews } from '../lib/life/scheduler.ts';

const sql = name => readFileSync('docs/setup/d1-upgrade-0005' + name + '.sql', 'utf8');
const beforeNames = readdirSync('drizzle').filter(n => /^000[0-4]_.*\.sql$/.test(n)).sort();
function oldDatabase() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys=ON; CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);');
  for (const name of beforeNames) {
    raw.exec(readFileSync('drizzle/' + name, 'utf8'));
    raw.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(name);
  }
  return raw;
}
const rows = (db, query) => db.prepare(query).all().map(row => ({ ...row }));
function snapshot(raw) {
  return Object.fromEntries(rows(raw, "SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'life_*' ORDER BY name")
    .map(({ name }) => [name, rows(raw, `SELECT * FROM "${name}" ORDER BY rowid`)]));
}

test('0005 upgrades populated history without changing entries, reports, held usage or authentication', async () => {
  const raw = oldDatabase(), now = new Date('2026-09-09T12:00:00Z');
  try {
    const db = { prepare(query) { return { bind(...args) { const q = raw.prepare(query); return { async first() { return q.get(...args) || null; }, async all() { return { results: q.all(...args) }; } }; } }; } };
    let calls = 0;
    const settings = { enabled: true, automaticEnabled: false, userCapMicros: 1000000, globalCapMicros: 5000000,
      provider: { async generate() { calls++; if (calls === 3) throw Error('Synthetic unconfirmed call'); return { text: 'Synthetic review', inputTokens: 100, outputTokens: 40, thoughtTokens: 10, costMicros: 225, providerId: 'synthetic', modelVersion: 'synthetic', finishReason: 'STOP' }; } } };
    const call = (body, query = '') => handleLife(new Request('https://life.test/api/life' + query, { method: body ? 'POST' : 'GET', headers: { Origin: 'https://life.test', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), 'synthetic-owner', db, now, settings);
    assert.equal((await call({ action: 'profile', profile: { goal: 'Synthetic upgrade goal', timezone: 'UTC', modules: ['reflection'], habits: [], version: 0 } })).status, 200);
    for (const date of ['2026-09-07', '2026-09-08']) assert.equal((await call({ action: 'entry', entry: { date, journal: 'Synthetic saved check-in', context: {}, statuses: [], version: 0, complete: true } })).status, 200);
    const review = (date, predecessorId = null) => ({ action: 'ai', review: { date, requestId: randomUUID(), sourceVersion: 1, predecessorId, critique: predecessorId ? 'Synthetic revision request' : '', consent: true } });
    const first = await call(review('2026-09-07')); assert.equal(first.status, 200);
    const id = (await first.json()).report.id;
    assert.equal((await call(review('2026-09-07', id))).status, 200);
    assert.equal((await call(review('2026-09-08'))).status, 502);
    await planDailyReviews(db, now);
    raw.exec(`INSERT INTO life_resources VALUES('synthetic-owner','budget','2026-09','2026-09','{}',1,'2026-09-09',NULL);
      INSERT INTO life_auth_user(id,name,email,created_at,updated_at) VALUES('synthetic-owner','Synthetic Owner','owner@example.test',1,1);
      INSERT INTO life_auth_account(id,account_id,provider_id,user_id,created_at,updated_at) VALUES('synthetic-account','synthetic-subject','google','synthetic-owner',1,1);
      INSERT INTO life_auth_session(id,expires_at,token,created_at,updated_at,user_id) VALUES('synthetic-session',9999999999,'synthetic-session-token',1,1,'synthetic-owner');`);
    const before = snapshot(raw), counts = rows(raw, sql('-counts')), listed = await (await call(null, '?ai=1')).json();
    assert.equal(listed.automaticExecutionEnabled, false);
    assert.equal(listed.reports.length, 3);
    assert.equal(listed.usage.measuredMicros, 450);
    assert.equal(listed.usage.allocatedMicros - listed.usage.measuredMicros, 200000);
    assert.equal(rows(raw, sql('-preflight'))[0].migrations, 5);
    const trigger = rows(raw, "SELECT sql FROM sqlite_master WHERE name IN ('life_daily_reminder_intent','life_daily_job_status') ORDER BY name");

    raw.exec(sql(''));
    const after = snapshot(raw); assert.deepEqual(after.life_automatic_consent, []); delete after.life_automatic_consent;
    for (const row of after.life_review_jobs) { assert.equal(row.last_considered_at, null); delete row.last_considered_at; }
    assert.deepEqual(after, before);
    assert.deepEqual(rows(raw, sql('-counts')), counts);
    assert.deepEqual(rows(raw, "SELECT sql FROM sqlite_master WHERE name IN ('life_daily_reminder_intent','life_daily_job_status') ORDER BY name"), trigger);
    assert.deepEqual(rows(raw, 'PRAGMA foreign_key_check'), []);
    assert.deepEqual(await (await call(null, '?ai=1')).json(), listed);
    const consent = await (await call(null, '?automatic=1')).json();
    assert.equal(consent.available, false); assert.equal(consent.consent.enabled, false);
    await call(review('2026-09-07')); await call(review('2026-09-08')); assert.equal(calls, 3);
    assert.equal(rows(raw, sql('-verify'))[0].migrations, 6);
    const upgraded = snapshot(raw);
    assert.throws(() => raw.exec(sql('')), /already exists/);
    assert.deepEqual(snapshot(raw), upgraded);
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM d1_migrations WHERE name='0005_automatic_daily_consent.sql'").get().n, 1);
  } finally { raw.close(); }
});

test('console upgrade schema exactly matches the canonical migration and does not reapply earlier migrations', () => {
  const canonical = oldDatabase(), consoleDb = oldDatabase();
  try {
    canonical.exec(readFileSync('drizzle/0005_automatic_daily_consent.sql', 'utf8'));
    consoleDb.exec(sql(''));
    const schema = db => rows(db, "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name<>'d1_migrations' ORDER BY name")
      .map(row => ({ ...row, sql: row.sql?.replace(/\s+/g, ' ').trim() }));
    assert.deepEqual(schema(consoleDb), schema(canonical));
    assert.deepEqual(rows(consoleDb, 'SELECT name FROM d1_migrations ORDER BY id').map(x => x.name), [...beforeNames, '0005_automatic_daily_consent.sql']);
  } finally { canonical.close(); consoleDb.close(); }
});
