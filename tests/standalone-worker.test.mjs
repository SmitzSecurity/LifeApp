import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
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
