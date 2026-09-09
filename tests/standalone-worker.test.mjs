import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,createFetchMock} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {serializeSignedCookie} from 'better-call';
import {AI_MODEL} from '../lib/life/ai-provider.ts';
import {defaultReviewPreferences} from '../lib/life/reviews.ts';
const env={LIFEAPP_AUTH_MODE:'google',BETTER_AUTH_URL:'https://life.test',BETTER_AUTH_SECRET:randomBytes(48).toString('base64url'),GOOGLE_CLIENT_ID:'synthetic-worker-client',GOOGLE_CLIENT_SECRET:'synthetic-worker-secret',LIFEAPP_BETA_EMAILS:'owner@example.test'};
const config={modules:true,modulesRules:[{type:'ESModule',include:['**/*.js']}],scriptPath:'dist-standalone/server/index.js',compatibilityDate:'2026-05-22',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],serviceBindings:{ASSETS:async()=>new Response('Not found',{status:404})}};
const mf=new Miniflare({...config,bindings:env});after(()=>mf.dispose());
before(async()=>{const db=await mf.getD1Database('DB');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+f,'utf8').split('--> statement-breakpoint'))await db.prepare(sql.trim()).run();});
test('compiled email-only Cron uses the native local binding and records one acceptance across ticks',async t=>{
 const mail=new Miniflare({...config,bindings:{...env,LIFEAPP_EMAIL_ENABLED:'true',LIFEAPP_EMAIL_FROM:'reports@lifeapp.smitzgroup.com'},email:{send_email:[{name:'REPORT_EMAILS',allowed_sender_addresses:['reports@lifeapp.smitzgroup.com'],destination_address:'owner@example.test'}]}});t.after(()=>mail.dispose());
 const db=await mail.getD1Database('DB');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+f,'utf8').split('--> statement-breakpoint'))await db.prepare(sql.trim()).run();
 const stamp=new Date(Date.now()-60000).toISOString();
 await db.prepare("INSERT INTO life_auth_user VALUES('mail-owner','Synthetic','owner@example.test',1,NULL,1,1)").run();
 await db.prepare("INSERT INTO life_auth_account(id,account_id,provider_id,user_id,created_at,updated_at) VALUES('mail-account','mail-google-sub','google','mail-owner',1,1)").run();
 await db.prepare("INSERT INTO life_profiles VALUES('google:mail-owner','{}',1,?1)").bind(stamp).run();
 await db.prepare("INSERT INTO life_email_consent VALUES('google:mail-owner',1,1,'full-report-v1','owner@example.test',?1,?1,?2)").bind(stamp,'a'.repeat(64)).run();
 await db.prepare("INSERT INTO life_ai_reviews(user_id,request_id,entry_date,revision,source_version,critique,status,input_snapshot,model,price_version,reserved_micros,created_at) VALUES('google:mail-owner','daily:2026-09-08','2026-09-08',1,1,'','generating','{}','synthetic','synthetic',0,?1)").bind(stamp).run();
 await db.prepare("UPDATE life_ai_reviews SET status='complete',report_text='Synthetic local email fixture. No real recipient.',finished_at=?1 WHERE user_id='google:mail-owner'").bind(stamp).run();
 const worker=await mail.getWorker();for(let n=0;n<2;n++)assert.equal((await worker.scheduled({scheduledTime:Date.now(),cron:'*/5 * * * *'})).outcome,'ok');
 const row=await db.prepare('SELECT state,attempts,message_id FROM life_email_outbox').first();assert.equal(row.state,'sent');assert.equal(row.attempts,1);assert.ok(row.message_id);
});
test('standalone Worker uses Google sign-in and rejects forged Sites identity',async()=>{
 const headers={'oai-authenticated-user-id':'forged-owner','oai-authenticated-user-email':'owner@example.test',accept:'text/html'};
 const home=await mf.dispatchFetch('https://life.test/',{headers,redirect:'manual'});assert.ok([302,303,307,308].includes(home.status));assert.equal(new URL(home.headers.get('location'),'https://life.test').pathname,'/sign-in');
 const r=await mf.dispatchFetch('https://life.test/api/life',{headers});assert.equal(r.status,401);
 const signIn=await mf.dispatchFetch('https://life.test/sign-in',{headers});assert.equal(signIn.status,200);assert.match(await signIn.text(),/Continue with Google/);
 const linked=await mf.dispatchFetch('https://life.test/?date=2025-08-05',{headers,redirect:'manual'});assert.equal(new URL(linked.headers.get('location'),'https://life.test').pathname+new URL(linked.headers.get('location'),'https://life.test').search,'/sign-in?date=2025-08-05');
 const invalid=await mf.dispatchFetch('https://life.test/?date=https://evil.test',{headers,redirect:'manual'});assert.equal(new URL(invalid.headers.get('location'),'https://life.test').search,'');
});
test('compiled standalone Google initiation persists state through D1 and enforces origin',async()=>{
 const body=JSON.stringify({provider:'google',callbackURL:'/'});
 const r=await mf.dispatchFetch('https://life.test/api/auth/sign-in/social',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://life.test','cf-connecting-ip':'192.0.2.12'},body});assert.equal(r.status,200,await r.clone().text());
 assert.equal(new URL((await r.json()).url).hostname,'accounts.google.com');assert.match(r.headers.get('set-cookie'),/Secure/);
 const cross=await mf.dispatchFetch('https://life.test/api/auth/sign-in/social',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.test'},body});assert.equal(cross.status,403);
 const anonymousExport=await mf.dispatchFetch('https://life.test/api/life?export=1');assert.equal(anonymousExport.status,401);
});
test('standalone Worker cannot fall back to Sites headers when auth mode is missing',async()=>{
 const unset=new Miniflare(config);try{const r=await unset.dispatchFetch('https://life.test/api/life',{headers:{'oai-authenticated-user-id':'forged','oai-authenticated-user-email':'owner@example.test'}});assert.equal(r.status,503);}finally{await unset.dispose();}
});

test('initial hosting without Google secrets stays closed before database/auth access',async()=>{
 const unconfigured=new Miniflare({...config,bindings:{LIFEAPP_AUTH_MODE:'google'}});
 try{
  for(const path of ['/','/sign-in','/api/life','/api/life?export=1','/api/auth/get-session']){
   const response=await unconfigured.dispatchFetch('https://life.test'+path,{headers:{'oai-authenticated-user-id':'forged'}});
   assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');
   assert.match(await response.text(),/Sign-in setup is still in progress/);
  }
  // No migrations were installed; the closed response does not depend on tables.
  const db=await unconfigured.getD1Database('DB');
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name LIKE 'life_%'").first()).n,0);
 }finally{await unconfigured.dispose();}
});

test('signed compiled history and export reads preserve records and isolate another account',async t=>{
 const isolated=new Miniflare({...config,bindings:env});t.after(()=>isolated.dispose());
 const db=await isolated.getD1Database('DB');
 for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+f,'utf8').split('--> statement-breakpoint'))await db.prepare(sql.trim()).run();
 const stamp=Date.now(),id='synthetic-export-owner',userId='google:'+id;
 await db.prepare('INSERT INTO life_auth_user VALUES(?1,?2,?3,1,NULL,?4,?4)').bind(id,'Synthetic Export Owner','owner@example.test',stamp).run();
 await db.prepare('INSERT INTO life_auth_session VALUES(?1,?2,?3,?4,?4,NULL,NULL,?5)').bind('synthetic-export-session',stamp+86400000,'synthetic-export-token',stamp,id).run();
 await db.prepare('INSERT INTO life_auth_account(id,account_id,provider_id,user_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?5)').bind('synthetic-export-account','synthetic-export-google-sub','google',id,stamp).run();
 const cookie=(await serializeSignedCookie('__Secure-lifeapp.session_token','synthetic-export-token',env.BETTER_AUTH_SECRET,{path:'/',secure:true,httpOnly:true})).split(';')[0];
 const call=(path,body)=>isolated.dispatchFetch('https://life.test'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:'https://life.test','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const date=new Date(stamp-86400000).toISOString().slice(0,10);
 assert.equal((await call('/api/life',{action:'profile',profile:{goal:'Synthetic export goal',timezone:'UTC',modules:['reflection'],habits:[],version:0}})).status,200);
 assert.equal((await call('/api/life',{action:'entry',entry:{date,journal:'Synthetic preserved journal',context:{},statuses:[],complete:true,version:0}})).status,200);
 await db.prepare('INSERT INTO life_entries VALUES(?1,?2,?3,1,?4)').bind('google:another-synthetic-owner',date,JSON.stringify({date,journal:'OTHER ACCOUNT PRIVATE MARKER',habits:[],context:{}}),new Date(stamp).toISOString()).run();
 await db.prepare("INSERT INTO life_ai_reviews(user_id,request_id,entry_date,revision,source_version,critique,status,input_snapshot,report_text,model,price_version,reserved_micros,cost_micros,created_at) VALUES(?1,'synthetic-export-review',?2,1,1,'','complete','{}','Synthetic preserved review','synthetic','synthetic-price',200000,225,?3)").bind(userId,date,new Date(stamp).toISOString()).run();
 const snapshot=async()=>{
  const result={};
  for(const table of ['life_profiles','life_entries','life_ai_reviews'])result[table]=(await db.prepare('SELECT * FROM '+table+' WHERE user_id=?1').bind(userId).all()).results;
  return result;
 };
 const before=await snapshot();
 const home=await call('/');assert.equal(home.status,200);assert.match(await home.text(),/Sign out/);
 const history=await call('/api/life');assert.equal(history.status,200);
 assert.equal((await history.json()).entries[0].journal,'Synthetic preserved journal');
 const searched=await call('/api/life',{action:'history',filters:{query:'preserved',from:date,through:date,status:'complete'},userId:'google:another-synthetic-owner'});
 assert.equal(searched.status,200);assert.equal(searched.headers.get('cache-control'),'private, no-store');
 const page=await searched.json();assert.equal(page.entries.length,1);assert.equal(page.entries[0].journal,'Synthetic preserved journal');assert.equal(page.nextCursor,null);
 const otherSearch=await call('/api/life',{action:'history',filters:{query:'OTHER ACCOUNT PRIVATE MARKER'}});
 assert.deepEqual(await otherSearch.json(),{entries:[],nextCursor:null});
 const anonymousSearch=await isolated.dispatchFetch('https://life.test/api/life',{method:'POST',headers:{Origin:'https://life.test','Content-Type':'application/json'},body:JSON.stringify({action:'history',filters:{}})});
 assert.equal(anonymousSearch.status,401);
 const entry=await (await call('/api/life?date='+date+'&userId=google:another-synthetic-owner')).json();
 assert.equal(entry.entry.journal,'Synthetic preserved journal');
 const response=await call('/api/life?export=1&userId=google:another-synthetic-owner');
 assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/attachment/);
 assert.equal(response.headers.get('cache-control'),'private, no-store');
 const backup=await response.json();assert.equal(backup.format,'lifeapp-portable-v1');
 assert.equal(backup.entries.length,1);assert.equal(JSON.parse(backup.entries[0].payload).journal,'Synthetic preserved journal');
 assert.match(JSON.stringify(backup),/Synthetic preserved review/);
 assert.doesNotMatch(JSON.stringify(backup),/OTHER ACCOUNT PRIVATE MARKER|synthetic-export-token|synthetic-export-google-sub|user_id|life_auth/);
 assert.deepEqual(await snapshot(),before);
 // Exercise the compiled email endpoint with the real signed session and D1.
 const email=await call('/api/life/email');assert.equal(email.status,200);
 const emailState=await email.json();assert.equal(emailState.available,false);assert.equal(emailState.consent.enabled,false);assert.equal(emailState.consent.recipient,'owner@example.test');
 const choice={enabled:true,version:0,policyVersion:'full-report-v1'};
 assert.equal((await call('/api/life/email',choice)).status,503);
 assert.equal((await isolated.dispatchFetch('https://life.test/api/life/email')).status,401);
 const blocked=await isolated.dispatchFetch('https://life.test/api/life/email',{method:'POST',headers:{Cookie:cookie,Origin:'https://evil.test','Content-Type':'application/json'},body:JSON.stringify(choice)});assert.equal(blocked.status,403);
 assert.equal((await call('/api/life/email',{...choice,enabled:false})).status,200);
 const token=(await db.prepare('SELECT unsubscribe_token FROM life_email_consent WHERE user_id=?1').bind(userId).first()).unsubscribe_token;
 await db.prepare('UPDATE life_email_consent SET enabled=1 WHERE user_id=?1').bind(userId).run();
 const url='https://life.test/email/unsubscribe?token='+token;
 assert.equal((await isolated.dispatchFetch(url)).status,200);
 assert.equal((await db.prepare('SELECT enabled FROM life_email_consent WHERE user_id=?1').bind(userId).first()).enabled,1);
 assert.equal((await isolated.dispatchFetch(url,{method:'POST',body:'List-Unsubscribe=One-Click'})).status,200);
 assert.equal((await db.prepare('SELECT enabled FROM life_email_consent WHERE user_id=?1').bind(userId).first()).enabled,0);
 const emailBackup=await (await call('/api/life?export=1')).json();assert.equal(emailBackup.email.consent.enabled,0);assert.ok(!JSON.stringify(emailBackup).includes(token));
 // The reusable runtime verification SQL must also execute on real local D1.
 await db.prepare('CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY,name TEXT)').run();
 for(const sql of readFileSync('docs/setup/d1-runtime-verify.sql','utf8').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).all();
 assert.deepEqual(await snapshot(),before);
});

test('compiled scheduled handler persists D1 jobs and observes late completion atomically',async()=>{
 const enabled=new Miniflare({...config,bindings:{...env,LIFEAPP_REVIEW_PLANNER_ENABLED:'true'}});
 try{
  const db=await enabled.getD1Database('DB');
  for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+f,'utf8').split('--> statement-breakpoint'))await db.prepare(sql.trim()).run();
  const profile={goal:'Synthetic scheduled goal',timezone:'America/New_York',modules:['reflection'],habits:[],version:1};
  await db.prepare('INSERT INTO life_profiles VALUES(?1,?2,1,?3)').bind('synthetic-scheduled-owner',JSON.stringify(profile),'2026-09-08T12:00:00Z').run();
  const worker=await enabled.getWorker();
  for(let i=0;i<2;i++)assert.equal((await worker.scheduled({scheduledTime:Date.parse('2026-09-09T12:00:00Z'),cron:'*/5 * * * *'})).outcome,'ok');
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM life_review_jobs').first()).n,1);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM life_reminder_outbox').first()).n,1);
  assert.equal((await db.prepare('SELECT state FROM life_daily_job_status').first()).state,'missing');
  await db.prepare('INSERT INTO life_entries VALUES(?1,?2,?3,1,?4)').bind('synthetic-scheduled-owner','2026-09-08',JSON.stringify({date:'2026-09-08',complete:true,journal:'Synthetic complete entry',habits:[],context:{}}),'2026-09-09T12:01:00Z').run();
  const status=await db.prepare('SELECT state,reminder_pending FROM life_daily_job_status').first();
  assert.equal(status.state,'ready');assert.equal(status.reminder_pending,0);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM life_ai_reviews').first()).n,0);
 }finally{await enabled.dispose();}
});

test('compiled automatic handler uses explicit consent and stores one mocked Gemini result across ticks',async()=>{
 const fetchMock=createFetchMock();fetchMock.disableNetConnect();let calls=0;
 fetchMock.get('https://generativelanguage.googleapis.com').intercept({path:`/v1beta/models/${AI_MODEL}:generateContent`,method:'POST'}).reply(200,()=>{
  calls++;return JSON.stringify({responseId:'synthetic-worker-review',modelVersion:AI_MODEL,candidates:[{content:{parts:[{text:'Synthetic compiled scheduled review'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:30,thoughtsTokenCount:10,totalTokenCount:140}});
 });
 const enabled=new Miniflare({...config,fetchMock,bindings:{...env,LIFEAPP_REVIEW_PLANNER_ENABLED:'true',LIFEAPP_AUTOMATIC_REVIEWS_ENABLED:'true',LIFEAPP_AI_ENABLED:'true',LIFEAPP_AI_PAID_PROJECT:'true',GEMINI_API_KEY:'synthetic-gemini-key'}});
 try{
  const db=await enabled.getD1Database('DB');
  for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+f,'utf8').split('--> statement-breakpoint'))await db.prepare(sql.trim()).run();
  const now=new Date(),date=new Date(now.valueOf()-86400000).toISOString().slice(0,10),id='synthetic-consented-owner';
  const preferences=defaultReviewPreferences();preferences.daily.time='00:00';
  const profile={goal:'Synthetic goal',timezone:'UTC',modules:['reflection'],habits:[],reviewPreferences:preferences};
  await db.prepare('INSERT INTO life_profiles VALUES(?1,?2,1,?3)').bind(id,JSON.stringify(profile),now.toISOString()).run();
  await db.prepare('INSERT INTO life_entries VALUES(?1,?2,?3,1,?4)').bind(id,date,JSON.stringify({date,complete:true,journal:'Synthetic check-in',habits:[],context:{}}),now.toISOString()).run();
  const worker=await enabled.getWorker();
  assert.equal((await worker.scheduled({scheduledTime:now.valueOf(),cron:'*/5 * * * *'})).outcome,'ok');
  assert.equal(calls,0);
  await db.prepare('INSERT INTO life_automatic_consent VALUES(?1,1,1,?2,?3,?4,?4)').bind(id,'daily-v1',date,new Date(now.valueOf()-86400000).toISOString()).run();
  for(let i=0;i<2;i++)assert.equal((await worker.scheduled({scheduledTime:now.valueOf(),cron:'*/5 * * * *'})).outcome,'ok');
  const result=await db.prepare('SELECT status,cost_micros,output_tokens,input_snapshot FROM life_ai_reviews').first();
  assert.equal(calls,1);assert.equal(result.status,'complete');assert.equal(result.cost_micros,225);assert.equal(result.output_tokens,40);
  assert.equal(JSON.parse(result.input_snapshot).automaticConsent.version,1);
  fetchMock.assertNoPendingInterceptors();
 }finally{await enabled.dispose();await fetchMock.close();}
});

test('prepared upgrade and verification queries run on local D1 without granting automatic consent',async()=>{
 const upgrade=new Miniflare({...config,bindings:env});
 try{
  const db=await upgrade.getD1Database('DB');
  await db.prepare('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)').run();
  for(const f of readdirSync('drizzle').filter(f=>/^000[0-4]_.*\.sql$/.test(f)).sort()){
   for(const sql of readFileSync('drizzle/'+f,'utf8').split('--> statement-breakpoint'))await db.prepare(sql.trim()).run();
   await db.prepare('INSERT INTO d1_migrations(name) VALUES(?1)').bind(f).run();
  }
  const load=name=>readFileSync('docs/setup/d1-upgrade-0005'+name+'.sql','utf8');
  assert.deepEqual(await db.prepare(load('-preflight')).first(),{migrations:5,required_prior_migrations:5,app_tables:11,consent_table:0,consideration_column:0,job_date_index:0,reminder_trigger:1,status_view:1});
  await db.prepare('INSERT INTO life_profiles VALUES(?1,?2,1,?3)').bind('synthetic-upgrade-owner',JSON.stringify({goal:'Synthetic upgrade',timezone:'UTC',modules:['reflection'],habits:[]}),new Date().toISOString()).run();
  const before=await db.prepare(load('-counts')).first();
  await db.exec(load(''));
  assert.deepEqual(await db.prepare(load('-verify')).first(),{migrations:6,migration_0005:1,app_tables:12,consent_table:1,consideration_column:1,job_date_index:1,reminder_trigger:1,status_view:1,consent_rows:0});
  assert.deepEqual(await db.prepare(load('-counts')).first(),before);
  const worker=await upgrade.getWorker();
  assert.equal((await worker.scheduled({scheduledTime:Date.now(),cron:'*/5 * * * *'})).outcome,'ok');
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM life_review_jobs').first()).n,0);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM life_automatic_consent').first()).n,0);
 }finally{await upgrade.dispose();}
});


test('compiled account deletion revokes signed cookies, removes content and preserves usage on D1',async()=>{
 const db=await mf.getD1Database('DB'),stamp=Date.now(),id='synthetic-deletion-owner',userId='google:'+id;
 await db.prepare('INSERT INTO life_auth_user VALUES(?1,?2,?3,1,NULL,?4,?4)').bind(id,'Synthetic Owner','owner@example.test',stamp).run();
 await db.prepare('INSERT INTO life_auth_session VALUES(?1,?2,?3,?4,?4,NULL,NULL,?5)').bind('synthetic-delete-session',stamp+86400000,'synthetic-delete-token',stamp,id).run();
 await db.prepare('INSERT INTO life_auth_account(id,account_id,provider_id,user_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?5)').bind('synthetic-delete-account','synthetic-delete-google-sub','google',id,stamp).run();
 const cookie=(await serializeSignedCookie('__Secure-lifeapp.session_token','synthetic-delete-token',env.BETTER_AUTH_SECRET,{path:'/',secure:true,httpOnly:true})).split(';')[0];
 const headers={Cookie:cookie,Origin:'https://life.test','Content-Type':'application/json'};
 const call=(path,body)=>mf.dispatchFetch('https://life.test'+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,redirect:'manual'});
 assert.equal((await call('/api/life',{action:'profile',profile:{goal:'Synthetic private goal',timezone:'UTC',modules:['reflection'],habits:[],version:0}})).status,200);
 const home=await call('/');assert.equal(home.status,200);assert.match(await home.text(),/LifeApp/);
 await db.prepare("INSERT INTO life_ai_reviews(user_id,request_id,entry_date,revision,source_version,critique,status,input_snapshot,report_text,model,price_version,reserved_micros,cost_micros,created_at) VALUES(?1,'synthetic-attempt','2026-09-09',1,1,'private critique','complete','private snapshot','private report','synthetic','synthetic-price',200000,225,?2)").bind(userId,new Date(stamp).toISOString()).run();
 const before=await db.prepare('SELECT SUM(COALESCE(cost_micros,reserved_micros)) n FROM life_ai_usage').first();
 assert.equal((await call('/api/auth/delete-account',{confirmation:'DELETE',userId:'someone-else'})).status,400);
 const response=await call('/api/auth/delete-account',{confirmation:'DELETE'});assert.equal(response.status,200,await response.clone().text());assert.deepEqual(await response.json(),{deleted:true});
 for(const path of ['/api/life','/api/life?export=1','/api/life?ai=1'])assert.equal((await call(path)).status,401,path);
 assert.equal(await (await call('/api/auth/get-session')).json(),null);
 for(const table of ['life_profiles','life_ai_reviews','life_automatic_consent','life_review_jobs'])assert.equal((await db.prepare('SELECT COUNT(*) n FROM '+table+' WHERE user_id=?1').bind(userId).first()).n,0);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM life_auth_user WHERE id=?1').bind(id).first()).n,0);
 assert.deepEqual(await db.prepare('SELECT SUM(COALESCE(cost_micros,reserved_micros)) n FROM life_ai_usage').first(),before);
 const ledger=await db.prepare('SELECT * FROM life_deleted_ai_usage WHERE user_id=?1').bind(userId).first();assert.equal(ledger.cost_micros,225);assert.doesNotMatch(JSON.stringify(ledger),/private/);
 assert.equal((await call('/api/auth/delete-account',{confirmation:'DELETE'})).status,401);
});

test('0006 console bundle and verification execute on local D1 while preserving existing consent',async()=>{
 const upgrade=new Miniflare({...config,bindings:env});
 try{
  const db=await upgrade.getD1Database('DB');
  await db.prepare('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)').run();
  for(const f of readdirSync('drizzle').filter(f=>/^000[0-5]_.*\.sql$/.test(f)).sort()){
   for(const sql of readFileSync('drizzle/'+f,'utf8').split('--> statement-breakpoint'))await db.prepare(sql.trim()).run();
   await db.prepare('INSERT INTO d1_migrations(name) VALUES(?1)').bind(f).run();
  }
  await db.prepare("INSERT INTO life_automatic_consent VALUES('synthetic-owner',1,1,'daily-v1','2026-09-09','2026-09-09','2026-09-09')").run();
  const load=name=>readFileSync('docs/setup/d1-upgrade-0006'+name+'.sql','utf8');
  assert.deepEqual(await db.prepare(load('-preflight')).first(),{migrations:6,required_prior_migrations:6,app_tables:12,deletion_objects:0,reminder_trigger:1,status_view:1});
  const before=await db.prepare(load('-counts')).first();
  await db.exec(load(''));
  assert.deepEqual(await db.prepare(load('-verify')).first(),{migrations:7,migration_0006:1,app_tables:14,deletion_objects:4,stale_write_guards:20,deleted_accounts:0,archived_attempts:0,scheduler_objects:2});
  assert.deepEqual(await db.prepare(load('-counts')).first(),before);
 }finally{await upgrade.dispose();}
});
