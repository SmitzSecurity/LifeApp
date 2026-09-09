import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {defaultReviewPreferences} from '../lib/life/reviews.ts';
import {handleLife} from '../lib/life/service.ts';
import {consumeDailyReviews} from '../lib/life/automatic-reviews.ts';
import {planDailyReviews} from '../lib/life/scheduler.ts';
import {handleEmailSettings,consumeReportEmails,reportEmail,unsubscribeReportEmails} from '../lib/life/email-service.ts';
import {settingsForEmail} from '../lib/life/email-configuration.ts';
import {validateBackup,previewMigration} from '../lib/life/migration-preview.ts';

const deliveryNow=new Date('2026-09-10T12:00:00.000Z');
const now=new Date('2026-09-09T12:00:00.000Z'),before=new Date('2026-09-08T12:00:00.000Z'),date='2026-09-08';
const providerResult={text:'Synthetic full report <script>alert("no")</script> & reflection',inputTokens:100,outputTokens:40,thoughtTokens:10,costMicros:225,providerId:'synthetic',modelVersion:'synthetic',finishReason:'STOP'};
function fixture(t,send=async()=>({messageId:'synthetic-mail-id'})){
 const raw=new DatabaseSync(':memory:');raw.exec('PRAGMA foreign_keys=ON');t.after(()=>raw.close());
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+file,'utf8'));
 const db={prepare(sql){return {bind(...params){return {async first(){return raw.prepare(sql).get(...params)||null;},async all(){return {results:raw.prepare(sql).all(...params)};}};}};}};
 let aiCalls=0;const messages=[];
 const ai={enabled:true,automaticEnabled:true,provider:{generate:async()=>{aiCalls++;return providerResult;}},userCapMicros:1000000,globalCapMicros:5000000};
 const settings={enabled:true,from:'reports@lifeapp.smitzgroup.com',origin:'https://life.test',allowedEmails:[],send:async message=>{messages.push(message);return send(message);}};
 const life=(body,id='google:a',path='',at=now)=>handleLife(new Request('https://life.test/api/life'+path,{method:body?'POST':'GET',headers:{Origin:'https://life.test','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),id,db,at,ai);
 const mail=(body,id='google:a',origin='https://life.test',at=before)=>handleEmailSettings(new Request('https://life.test/api/life/email',{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),id,db,settings,at);
 const consent=(enabled=true,version=0,id='google:a',at=before)=>mail({enabled,version,policyVersion:'full-report-v1'},id,undefined,at);
 async function setup(id='a'){
  raw.prepare('INSERT INTO life_auth_user VALUES(?,?,?,1,NULL,?,?)').run(id,'Synthetic',id+'@example.test',now.valueOf(),now.valueOf());
  raw.prepare('INSERT INTO life_auth_account(id,account_id,provider_id,user_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('account-'+id,'subject-'+id,'google',id,now.valueOf(),now.valueOf());
  settings.allowedEmails.push(id+'@example.test');
  assert.equal((await life({action:'profile',profile:{goal:'Synthetic goal',timezone:'UTC',modules:['reflection'],habits:[],version:0}},'google:'+id)).status,200);
  assert.equal((await life({action:'entry',entry:{date,journal:'Raw private journal excluded from email',context:{},statuses:[],complete:true,version:0}},'google:'+id)).status,200);
 }
 const generate=(id='google:a')=>life({action:'ai',review:{date,requestId:randomUUID(),sourceVersion:1,predecessorId:null,critique:'',consent:true}},id);
 async function queued(){await setup();assert.equal((await consent()).status,200);assert.equal((await generate()).status,200);}
 const rows=()=>raw.prepare('SELECT * FROM life_email_outbox').all();
 return {raw,db,ai,settings,life,mail,consent,setup,generate,queued,rows,messages,aiCalls:()=>aiCalls};
}

test('email is off by default; legacy preference and old completed reports never grant consent or backfill',async t=>{
 const f=fixture(t);await f.setup();f.raw.prepare("UPDATE life_profiles SET payload=json_set(payload,'$.reviewPreferences',json(?))").run(JSON.stringify({...defaultReviewPreferences(),emailEnabled:true}));
 assert.equal((await (await f.mail()).json()).consent.enabled,false);
 assert.equal((await f.generate()).status,200);assert.equal(f.rows().length,0);
 assert.equal((await f.consent()).status,200);await consumeReportEmails(f.db,f.settings,()=>deliveryNow);
 assert.equal(f.rows().length,0);assert.equal(f.messages.length,0);assert.equal(f.aiCalls(),1);
});
test('email opt-in is verified, account-scoped, same-origin, versioned and independently disabled',async t=>{
 const f=fixture(t);await f.setup();await f.setup('b');
 const body={enabled:true,version:0,policyVersion:'full-report-v1'};
 assert.equal((await f.mail(body,null)).status,401);assert.equal((await f.mail(body,'google:a','https://evil.test')).status,403);
 assert.equal((await f.mail({...body,recipient:'b@example.test'})).status,400);
 f.settings.enabled=false;assert.equal((await f.consent()).status,503);f.settings.enabled=true;
 f.raw.exec("UPDATE life_auth_user SET email_verified=0 WHERE id='a'");assert.equal((await f.consent()).status,401);
 f.raw.exec("UPDATE life_auth_user SET email_verified=1 WHERE id='a'");
 assert.equal((await f.consent()).status,200);assert.equal((await (await f.mail(undefined,'google:b')).json()).consent.enabled,false);
 assert.equal((await f.consent(false,1)).status,200);assert.equal((await f.consent(true,1)).status,409);
 f.settings.enabled=false;assert.equal((await f.consent(false,2)).status,200);
 assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM life_automatic_consent').get().n,0);
});
test('new report completion queues once; overlapping ticks send one full report without changing AI usage',async t=>{
 let resolve;const pending=new Promise(r=>resolve=r);const f=fixture(t,()=>pending);await f.queued();
 const usage=f.raw.prepare('SELECT * FROM life_ai_usage').all();
 assert.equal(f.rows()[0].state,'pending');
 const runs=[consumeReportEmails(f.db,f.settings,()=>deliveryNow),consumeReportEmails(f.db,f.settings,()=>deliveryNow)];
 await new Promise(r=>setImmediate(r));assert.equal(f.messages.length,1);resolve({messageId:'receipt-1'});await Promise.all(runs);
 await consumeReportEmails(f.db,f.settings,()=>deliveryNow);assert.equal(f.rows()[0].state,'sent');assert.equal(f.rows()[0].attempts,1);
 assert.equal(f.aiCalls(),1);assert.deepEqual(f.raw.prepare('SELECT * FROM life_ai_usage').all(),usage);
 assert.equal(f.messages[0].to,'a@example.test');assert.ok(f.messages[0].text.includes(providerResult.text));
 assert.doesNotMatch(f.messages[0].text,/Raw private journal/);assert.doesNotMatch(f.messages[0].html,/<script>/);assert.match(f.messages[0].html,/&lt;script&gt;/);
 assert.match(f.messages[0].text,/https:\/\/life.test\/\?date=2026-09-08/);
});
test('delivery admission rechecks opt-out, recipient changes, Google linkage, policy and deletion races',async t=>{
 for(const mutate of [
  raw=>raw.exec('UPDATE life_email_consent SET enabled=0,version=version+1'),
  raw=>raw.exec("UPDATE life_auth_user SET email='changed@example.test' WHERE id='a'"),
  raw=>raw.exec('UPDATE life_auth_user SET email_verified=0'),
  raw=>raw.exec('DELETE FROM life_auth_account'),
  raw=>raw.exec("UPDATE life_email_consent SET policy_version='obsolete'"),
  raw=>raw.exec("INSERT INTO life_account_deletions VALUES('google:a','2026-09-09T12:00:00.000Z')")
 ]){
  const f=fixture(t);await f.queued();let changed=false;
  const racing={prepare(sql){return {bind(...params){const q=f.db.prepare(sql).bind(...params);return {...q,async first(){if(!changed&&sql.startsWith("UPDATE life_email_outbox SET state='sending'")){changed=true;mutate(f.raw);}return q.first();}};}};}};
  await consumeReportEmails(racing,f.settings,()=>deliveryNow);assert.equal(changed,true);assert.equal(f.messages.length,0);assert.equal(f.aiCalls(),1);
 }
});
test('disabling email cancels pending delivery and re-enabling never resurrects it',async t=>{
 const f=fixture(t);await f.queued();await f.consent(false,1);assert.equal(f.rows()[0].state,'cancelled');
 await f.consent(true,2);await consumeReportEmails(f.db,f.settings,()=>deliveryNow);assert.equal(f.messages.length,0);
});
test('only explicit sending limits retry; retries never regenerate reports and beta removal prevents send',async t=>{
 let attempt=0;const f=fixture(t,async()=>{if(attempt++===0)throw Object.assign(Error('limit'),{code:'E_DAILY_LIMIT_EXCEEDED'});return {messageId:'retry-receipt'};});await f.queued();
 await consumeReportEmails(f.db,f.settings,()=>deliveryNow);assert.equal(f.rows()[0].state,'retry');
 await consumeReportEmails(f.db,f.settings,()=>deliveryNow);assert.equal(f.messages.length,1);
 await consumeReportEmails(f.db,f.settings,()=>new Date(deliveryNow.valueOf()+3600000));assert.equal(f.rows()[0].state,'sent');assert.equal(f.aiCalls(),1);
 const g=fixture(t);await g.queued();g.settings.allowedEmails=[];await consumeReportEmails(g.db,g.settings,()=>deliveryNow);assert.equal(g.messages.length,0);assert.equal(g.rows()[0].state,'failed');
});
test('unknown send results and crashed claims are held without automatic resend',async t=>{
 for(const send of [async()=>{throw Error('transport failed');},async()=>undefined]){
  const f=fixture(t,send);await f.queued();await consumeReportEmails(f.db,f.settings,()=>deliveryNow);await consumeReportEmails(f.db,f.settings,()=>new Date(now.valueOf()+86400000));
  assert.equal(f.rows()[0].state,'uncertain');assert.equal(f.messages.length,1);
 }
 const f=fixture(t);await f.queued();f.raw.prepare("UPDATE life_email_outbox SET state='sending',attempts=1,last_attempt_at=?").run(before.toISOString());
 await consumeReportEmails(f.db,f.settings,()=>deliveryNow);assert.equal(f.rows()[0].state,'uncertain');assert.equal(f.messages.length,0);
});
test('unsubscribe preview never mutates; capability POST opts out without login and is idempotent',async t=>{
 const f=fixture(t);await f.queued();const token=f.raw.prepare('SELECT unsubscribe_token FROM life_email_consent').get().unsubscribe_token;
 const url='https://life.test/email/unsubscribe?token='+token;
 const page=await unsubscribeReportEmails(new Request(url),f.db,now);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/default-src 'none'/);assert.equal(f.rows()[0].state,'pending');
 assert.equal((await unsubscribeReportEmails(new Request(url,{method:'POST',body:'List-Unsubscribe=One-Click'}),f.db,now)).status,200);
 assert.equal((await unsubscribeReportEmails(new Request(url,{method:'POST'}),f.db,now)).status,200);
 assert.equal(f.raw.prepare('SELECT enabled,version FROM life_email_consent').get().enabled,0);assert.equal(f.rows()[0].state,'cancelled');
 assert.equal((await unsubscribeReportEmails(new Request('https://life.test/email/unsubscribe?token=bad'),f.db,now)).status,400);
});
test('export preserves email history while excluding unsubscribe tokens and other accounts; old backup remains valid',async t=>{
 const f=fixture(t);await f.queued();await f.setup('b');await f.consent(true,0,'google:b');
 await consumeReportEmails(f.db,f.settings,()=>deliveryNow);
 const text=await (await f.life(undefined,'google:a','?export=1')).text(),backup=validateBackup(text);
 assert.equal(backup.email.deliveries.length,1);assert.equal(backup.email.consent.enabled,1);assert.doesNotMatch(text,/unsubscribe_token|b@example.test|subject-a/);
 const old={...backup};delete old.email;assert.equal(validateBackup(JSON.stringify(old)).reviews.length,1);
 const preview=await previewMigration(text,JSON.stringify(old));assert.equal(preview.canApply,false);assert.equal(preview.comparison.insert,2);
});
test('account deletion removes email records, prevents stale writes and preserves minimal AI accounting',async t=>{
 const f=fixture(t);await f.queued();await f.setup('b');await f.consent(true,0,'google:b');
 f.raw.exec("INSERT INTO life_account_deletions VALUES('google:a','2026-09-09T12:00:00.000Z')");
 assert.equal(f.rows().length,0);assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM life_email_consent WHERE user_id='google:a'").get().n,0);
 assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM life_email_consent WHERE user_id='google:b'").get().n,1);
 assert.equal(f.raw.prepare('SELECT SUM(cost_micros) n FROM life_ai_usage').get().n,225);
 assert.throws(()=>f.raw.exec("INSERT INTO life_email_outbox(user_id,request_id,consent_version,state,created_at,next_attempt_at) VALUES('google:a','stale',1,'pending','now','now')"),/deleted/);
});
test('combined tick has D1 headroom for discovery, two module-rich AI reports and two email deliveries',async t=>{
 const f=fixture(t);
 for(let n=0;n<12;n++){
  const id='synthetic-'+n;await f.setup(id);await f.consent(true,0,'google:'+id);
  assert.equal((await f.life({action:'automatic-consent',consent:{enabled:true,version:0,policyVersion:'daily-v1'}},'google:'+id,'',before)).status,200);
  f.raw.prepare("UPDATE life_profiles SET payload=json_set(payload,'$.modules',json(?)) WHERE user_id=?").run(JSON.stringify(['reflection','money','fitness']),'google:'+id);
  f.raw.prepare('INSERT INTO life_resources VALUES(?,?,?,?,?,1,?,NULL)').run('google:'+id,'budget','2026-09','2026-09',JSON.stringify({currency:'USD',categories:[],recurring:[],goals:{spending:'',saving:'',investing:''}}),now.toISOString());
 }
 let queries=0;const counted={prepare(sql){queries++;return f.db.prepare(sql);}};
 assert.equal((await planDailyReviews(counted,now,10)).discovered,10);
 assert.equal((await consumeDailyReviews(counted,f.ai,()=>now)).completed,2);
 assert.equal((await consumeReportEmails(counted,f.settings,()=>deliveryNow)).sent,2);
 assert.ok(queries<=50,`${queries} queries exceeds the Workers free D1 limit`);assert.equal(f.aiCalls(),2);
});
test('sender configuration fails closed and only native binding is used',()=>{
 const env={LIFEAPP_AUTH_MODE:'google',LIFEAPP_EMAIL_ENABLED:'true',LIFEAPP_EMAIL_FROM:'reports@lifeapp.smitzgroup.com',BETTER_AUTH_URL:'https://life.test',LIFEAPP_BETA_EMAILS:' A@EXAMPLE.TEST ',REPORT_EMAILS:{send:async()=>({messageId:'synthetic'})}};
 const s=settingsForEmail(env);assert.equal(s.enabled,true);assert.deepEqual(s.allowedEmails,['a@example.test']);
 assert.equal(settingsForEmail({...env,LIFEAPP_AUTH_MODE:'sites'}).enabled,false);
 assert.equal(settingsForEmail({...env,LIFEAPP_EMAIL_FROM:'bad\r\nBcc:x@example.test'}).from,'');
 assert.equal(settingsForEmail({...env,BETTER_AUTH_URL:'http://life.test'}).origin,'');
 assert.equal(settingsForEmail({...env,REPORT_EMAILS:undefined}).send,null);
 const email=reportEmail({date,revision:2,text:'full report',recipient:'a@example.test',unsubscribeToken:'a'.repeat(64)},s);assert.match(email.subject,/revision 2/);assert.equal(email.headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');
});
test('0007 preserves every pre-existing row and creates no grants or retrospective email jobs',()=>{
 const raw=new DatabaseSync(':memory:');try{
  for(const file of readdirSync('drizzle').filter(f=>/^000[0-6]_.*\.sql$/.test(f)).sort())raw.exec(readFileSync('drizzle/'+file,'utf8'));
  raw.exec(`INSERT INTO life_profiles VALUES('synthetic','{"goal":"Preserved","reviewPreferences":{"emailEnabled":true}}',7,'2026-09-09T12:00:00.000Z');`);
  const snapshot=()=>raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'life_%' AND name NOT LIKE 'life_email_%'").all().map(({name})=>[name,raw.prepare('SELECT * FROM '+name).all()]);
  const before=snapshot();raw.exec(readFileSync('drizzle/0007_report_email.sql','utf8'));assert.deepEqual(snapshot(),before);
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM life_email_consent').get().n,0);assert.equal(raw.prepare('SELECT COUNT(*) n FROM life_email_outbox').get().n,0);
 }finally{raw.close();}
});
