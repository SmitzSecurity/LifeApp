import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

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

test('0005 upgrades populated history without changing entries, reports, held usage or authentication', () => {
  // Historical schema fixture: do not run current application code against an
  // old migration level to manufacture its data.
  const raw = oldDatabase();
  try {
    raw.exec(`INSERT INTO life_profiles VALUES('synthetic-owner','{"timezone":"UTC","modules":["reflection"],"habits":[]}',1,'2026-09-09');
      INSERT INTO life_entries VALUES('synthetic-owner','2026-09-08','{"journal":"Synthetic saved check-in","complete":true,"habits":[]}',1,'2026-09-09');
      INSERT INTO life_resources VALUES('synthetic-owner','budget','2026-09','2026-09','{}',1,'2026-09-09',NULL);
      INSERT INTO life_review_jobs VALUES('synthetic-owner','2026-09-08','2026-09-09','UTC','08:00',1);
      INSERT INTO life_auth_user(id,name,email,created_at,updated_at) VALUES('synthetic-owner','Synthetic Owner','owner@example.test',1,1);
      INSERT INTO life_auth_account(id,account_id,provider_id,user_id,created_at,updated_at) VALUES('synthetic-account','synthetic-subject','google','synthetic-owner',1,1);
      INSERT INTO life_auth_session(id,expires_at,token,created_at,updated_at,user_id) VALUES('synthetic-session',9999999999,'synthetic-session-token',1,1,'synthetic-owner');`);
    const insert=raw.prepare("INSERT INTO life_ai_reviews(user_id,request_id,entry_date,revision,source_version,predecessor_id,critique,status,input_snapshot,report_text,model,price_version,reserved_micros,cost_micros,created_at) VALUES('synthetic-owner',?,?,?,1,?,'Synthetic critique',?,'Synthetic context',?,'synthetic','synthetic-price',200000,?,'2026-09-09')");
    insert.run('original','2026-09-07',1,null,'complete','Synthetic original',225);
    insert.run('revision','2026-09-07',2,'original','complete','Synthetic revision',225);
    insert.run('unknown','2026-09-08',1,null,'uncertain',null,null);
    const before = snapshot(raw), counts = rows(raw, sql('-counts'));
    assert.equal(counts[0].measured_micros,450);assert.equal(counts[0].held_micros,200000);
    assert.equal(rows(raw, sql('-preflight'))[0].migrations, 5);
    const trigger = rows(raw, "SELECT sql FROM sqlite_master WHERE name IN ('life_daily_reminder_intent','life_daily_job_status') ORDER BY name");
    raw.exec(sql(''));
    const after = snapshot(raw); assert.deepEqual(after.life_automatic_consent, []); delete after.life_automatic_consent;
    for (const row of after.life_review_jobs) { assert.equal(row.last_considered_at, null); delete row.last_considered_at; }
    assert.deepEqual(after, before);
    assert.deepEqual(rows(raw, sql('-counts')), counts);
    assert.deepEqual(rows(raw, "SELECT sql FROM sqlite_master WHERE name IN ('life_daily_reminder_intent','life_daily_job_status') ORDER BY name"), trigger);
    assert.deepEqual(rows(raw, 'PRAGMA foreign_key_check'), []);
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

test('0006 console bundle matches canonical schema and preserves populated accounts, consent and usage',()=>{
 const canonical=oldDatabase(),consoleDb=oldDatabase();
 try{
  for(const db of [canonical,consoleDb]){
   db.exec(sql(''));
   db.exec(`INSERT INTO life_auth_user(id,name,email,email_verified,created_at,updated_at) VALUES('a','Synthetic','a@example.test',1,1,1);
    INSERT INTO life_profiles VALUES('google:a','{"goal":"Synthetic preserved goal"}',1,'2026-09-09');
    INSERT INTO life_automatic_consent VALUES('google:a',1,1,'daily-v1','2026-09-09','2026-09-09','2026-09-09');
    INSERT INTO life_ai_reviews(user_id,request_id,entry_date,revision,source_version,critique,status,input_snapshot,model,price_version,reserved_micros,created_at) VALUES('google:a','pending','2026-09-09',1,1,'','uncertain','Synthetic context','synthetic','synthetic',200000,'2026-09-09');`);
  }
  const load=name=>readFileSync('docs/setup/d1-upgrade-0006'+name+'.sql','utf8');
  assert.deepEqual(rows(consoleDb,load('-preflight'))[0],{migrations:6,required_prior_migrations:6,app_tables:12,deletion_objects:0,reminder_trigger:1,status_view:1});
  const before=snapshot(consoleDb),counts=rows(consoleDb,load('-counts'));
  canonical.exec(readFileSync('drizzle/0006_account_deletion.sql','utf8'));consoleDb.exec(load(''));
  const schema=db=>rows(db,"SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name<>'d1_migrations' ORDER BY name").map(r=>({...r,sql:r.sql?.replace(/\s+/g,' ').trim()}));
  assert.deepEqual(schema(consoleDb),schema(canonical));
  const after=snapshot(consoleDb);assert.deepEqual(after.life_account_deletions,[]);assert.deepEqual(after.life_deleted_ai_usage,[]);
  delete after.life_account_deletions;delete after.life_deleted_ai_usage;assert.deepEqual(after,before);
  assert.deepEqual(rows(consoleDb,load('-counts')),counts);
  assert.deepEqual(rows(consoleDb,load('-verify'))[0],{migrations:7,migration_0006:1,app_tables:14,deletion_objects:4,stale_write_guards:20,deleted_accounts:0,archived_attempts:0,scheduler_objects:2});
  assert.equal(consoleDb.prepare('SELECT SUM(COALESCE(cost_micros,reserved_micros)) n FROM life_ai_usage').get().n,200000);
  const upgraded=snapshot(consoleDb);assert.throws(()=>consoleDb.exec(load('')),/already exists/);assert.deepEqual(snapshot(consoleDb),upgraded);
 }finally{canonical.close();consoleDb.close();}
});
