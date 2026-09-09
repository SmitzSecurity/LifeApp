import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,createFetchMock} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {AI_MODEL} from '../lib/life/ai-provider.ts';
import {defaultReviewPreferences} from '../lib/life/reviews.ts';
const env={LIFEAPP_AUTH_MODE:'google',BETTER_AUTH_URL:'https://life.test',BETTER_AUTH_SECRET:randomBytes(48).toString('base64url'),GOOGLE_CLIENT_ID:'synthetic-worker-client',GOOGLE_CLIENT_SECRET:'synthetic-worker-secret',LIFEAPP_BETA_EMAILS:'owner@example.test'};
const config={modules:true,modulesRules:[{type:'ESModule',include:['**/*.js']}],scriptPath:'dist-standalone/server/index.js',compatibilityDate:'2026-05-22',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],serviceBindings:{ASSETS:async()=>new Response('Not found',{status:404})}};
const mf=new Miniflare({...config,bindings:env});after(()=>mf.dispose());
before(async()=>{const db=await mf.getD1Database('DB');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+f,'utf8').split('--> statement-breakpoint'))await db.prepare(sql.trim()).run();});
test('standalone Worker uses Google sign-in and rejects forged Sites identity',async()=>{
 const headers={'oai-authenticated-user-id':'forged-owner','oai-authenticated-user-email':'owner@example.test',accept:'text/html'};
 const home=await mf.dispatchFetch('https://life.test/',{headers,redirect:'manual'});assert.ok([302,303,307,308].includes(home.status));assert.equal(new URL(home.headers.get('location'),'https://life.test').pathname,'/sign-in');
 const r=await mf.dispatchFetch('https://life.test/api/life',{headers});assert.equal(r.status,401);
 const signIn=await mf.dispatchFetch('https://life.test/sign-in',{headers});assert.equal(signIn.status,200);assert.match(await signIn.text(),/Continue with Google/);
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
