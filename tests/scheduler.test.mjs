import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {profileSchema} from '../lib/life/domain.ts';
import {defaultReviewPreferences} from '../lib/life/reviews.ts';
import {dueDailyDate,planDailyReviews,dailyJobStatus,scheduledReviewPlanning} from '../lib/life/scheduler.ts';
import {handleLife} from '../lib/life/service.ts';

const now=new Date('2026-09-09T12:00:00Z'),date='2026-09-08';
const base={goal:'Synthetic reading goal',timezone:'America/New_York',modules:['reflection'],habits:[],version:0};
function fixture(){
 const raw=new DatabaseSync(':memory:');
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+file,'utf8'));
 const db={prepare(sql){return {bind(...params){const q=raw.prepare(sql);return {async first(){return q.get(...params)||null;},async all(){return {results:q.all(...params)};}};}};}};
 let providerCalls=0;
 const ai={enabled:true,userCapMicros:1000000,globalCapMicros:5000000,provider:{generate:async()=>{providerCalls++;return {text:'Synthetic dated review',inputTokens:10,outputTokens:10,thoughtTokens:0,costMicros:45,providerId:'synthetic',modelVersion:'synthetic',finishReason:'STOP'};}}};
 const call=(body,id='a',path='')=>handleLife(new Request('https://life.test/api/life'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:'https://life.test'},body:body?JSON.stringify(body):undefined}),id,db,now,ai);
 async function setup(id='a',overrides={}){const r=await call({action:'profile',profile:{...base,...overrides}},id);assert.equal(r.status,200);return (await r.json()).profile;}
 async function entry(complete,version=0,id='a',overrides={}){const r=await call({action:'entry',entry:{date,journal:'Synthetic reading entry',statuses:[],context:{},version,complete,...overrides}},id);assert.equal(r.status,200);return (await r.json()).entry;}
 return {db,raw,call,setup,entry,ai,calls:()=>providerCalls};
}
function profileAt(timezone,time){const p=profileSchema.parse({...base,timezone});p.reviewPreferences.daily.time=time;return p;}

test('schedule follows local date/time, spring gaps, autumn repeats and half-hour zones',()=>{
 const ny=profileAt('America/New_York','08:00');
 assert.equal(dueDailyDate(ny,new Date('2026-09-09T11:59:00Z')),null);
 assert.equal(dueDailyDate(ny,now),date);
 assert.equal(dueDailyDate(profileAt('Asia/Kolkata','00:00'),new Date('2026-09-08T18:30:00Z')),date);
 assert.equal(dueDailyDate(profileAt('America/New_York','02:30'),new Date('2026-03-08T07:00:00Z')),'2026-03-07');
 const fall=profileAt('America/New_York','01:30');
 assert.equal(dueDailyDate(fall,new Date('2026-11-01T05:30:00Z')),'2026-10-31');
 assert.equal(dueDailyDate(fall,new Date('2026-11-01T06:30:00Z')),'2026-10-31');
 ny.reviewPreferences.daily.enabled=false;assert.equal(dueDailyDate(ny,now),null);
 assert.throws(()=>dueDailyDate(ny,new Date('invalid')));
});

test('overlapping ticks persist one job and reminder intent per account/day without spending',async()=>{
 const f=fixture();await f.setup('a');await f.setup('b');
 const ticks=await Promise.all([planDailyReviews(f.db,now),planDailyReviews(f.db,now),planDailyReviews(f.db,now)]);
 assert.equal(ticks.reduce((sum,r)=>sum+r.discovered,0),2);
 for(const table of ['life_review_jobs','life_reminder_outbox'])assert.equal(f.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,2);
 assert.equal((await dailyJobStatus(f.db,'a',date)).state,'missing');
 assert.equal((await dailyJobStatus(f.db,'a',date)).reminderPending,true);
 assert.equal(f.calls(),0);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM life_ai_reviews').get().n,0);f.raw.close();
});

test('late completion, reopen and idempotent save change live eligibility without another tick',async()=>{
 const f=fixture();await f.setup();await planDailyReviews(f.db,now);
 await f.entry(false);assert.equal((await dailyJobStatus(f.db,'a',date)).state,'incomplete');
 const mutationId=randomUUID();await f.entry(true,1,'a',{mutationId});
 assert.equal((await dailyJobStatus(f.db,'a',date)).state,'ready');
 assert.equal((await dailyJobStatus(f.db,'a',date)).sourceVersion,2);
 assert.equal((await dailyJobStatus(f.db,'a',date)).reminderPending,false);
 await f.entry(true,1,'a',{mutationId});assert.equal((await dailyJobStatus(f.db,'a',date)).sourceVersion,2);
 await f.entry(false,2);assert.equal((await dailyJobStatus(f.db,'a',date)).state,'incomplete');
 assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM life_review_jobs').get().n,1);
 assert.equal(f.calls(),0);f.raw.close();
});

test('manual original and ambiguous attempts suppress scheduled generation without overwrites',async()=>{
 const f=fixture();await f.setup();await f.entry(true);await planDailyReviews(f.db,now);
 const request={action:'ai',review:{date,requestId:randomUUID(),sourceVersion:1,predecessorId:null,critique:'',consent:true}};
 assert.equal((await f.call(request)).status,200);assert.equal(f.calls(),1);
 assert.equal((await dailyJobStatus(f.db,'a',date)).state,'already-generated');
 await planDailyReviews(f.db,now);assert.equal(f.calls(),1);
 const original=f.raw.prepare('SELECT report_text FROM life_ai_reviews').get().report_text;
 for(const status of ['generating','uncertain','failed']){
  f.raw.prepare('UPDATE life_ai_reviews SET status=?').run(status);
  assert.equal((await dailyJobStatus(f.db,'a',date)).state,'attention');
  assert.equal((await dailyJobStatus(f.db,'a',date)).reminderPending,false);
 }
 assert.equal(f.raw.prepare('SELECT report_text FROM life_ai_reviews').get().report_text,original);f.raw.close();
});

test('preferences immediately suppress jobs/reminders and clock changes cannot duplicate a discovered day',async()=>{
 const f=fixture();const p=await f.setup();await planDailyReviews(f.db,now);
 p.reviewPreferences.remindersEnabled=false;
 const save=async()=>{const r=await f.call({action:'profile',profile:p});assert.equal(r.status,200);p.version=(await r.json()).profile.version;};
 await save();assert.equal((await dailyJobStatus(f.db,'a',date)).reminderPending,false);
 p.reviewPreferences.daily.enabled=false;await save();assert.equal((await dailyJobStatus(f.db,'a',date)).state,'disabled');
 p.reviewPreferences.daily.enabled=true;p.timezone='UTC';p.reviewPreferences.daily.time='09:00';await save();
 await planDailyReviews(f.db,now);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM life_review_jobs').get().n,1);f.raw.close();
});

test('job and outbox insert roll back together when the outbox write fails',async()=>{
 const f=fixture();await f.setup();
 f.raw.exec("CREATE TRIGGER reject_reminder BEFORE INSERT ON life_reminder_outbox BEGIN SELECT RAISE(ABORT,'synthetic fault'); END;");
 await assert.rejects(planDailyReviews(f.db,now));
 assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM life_review_jobs').get().n,0);
 f.raw.exec('DROP TRIGGER reject_reminder');assert.equal((await planDailyReviews(f.db,now)).discovered,1);f.raw.close();
});

test('status API is private, contains no journal and cannot be used to run the planner',async()=>{
 const f=fixture();await f.setup('a');await f.setup('b');await planDailyReviews(f.db,now);await f.entry(true);
 const a=await (await f.call(undefined,'a','?ai=1&date='+date)).json();
 const b=await (await f.call(undefined,'b','?ai=1&date='+date+'&userId=a')).json();
 assert.equal(a.schedule.state,'ready');assert.equal(b.schedule.state,'missing');
 assert.equal(a.automaticExecutionEnabled,false);assert.equal(a.emailDeliveryEnabled,false);
 assert.doesNotMatch(JSON.stringify(a.schedule),/Synthetic reading|user_id/);
 assert.equal((await f.call(undefined,null,'?ai=1&date='+date)).status,401);
 assert.equal((await f.call({action:'schedule'})).status,400);f.raw.close();
});

test('invalid records are reported, stale preference scans are guarded and oversized scans fail explicitly',async()=>{
 const f=fixture();await f.setup();
 const racing={prepare(sql){const original=f.db.prepare(sql);return {bind(...args){const bound=original.bind(...args);if(sql.startsWith('INSERT INTO life_review_jobs'))f.raw.prepare('UPDATE life_profiles SET version=version+1').run();return bound;}};}};
 assert.equal((await planDailyReviews(racing,now)).discovered,0);
 f.raw.prepare('UPDATE life_profiles SET payload=?').run('{}');assert.equal((await planDailyReviews(f.db,now)).invalidProfiles,1);
 const payload=JSON.stringify(profileSchema.parse(base));
 for(let i=0;i<501;i++)f.raw.prepare('INSERT OR IGNORE INTO life_profiles VALUES(?,?,1,?)').run('synthetic-'+i,payload,now.toISOString());
 await assert.rejects(planDailyReviews(f.db,now),/capacity/);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM life_review_jobs').get().n,0);f.raw.close();
});

test('scheduled handler fails closed and never interprets AI activation as planner authorization',async()=>{
 const noDb={prepare(){throw new Error('must not read');}};
 await scheduledReviewPlanning({DB:noDb,LIFEAPP_AUTH_MODE:'google'},now.valueOf());
 await scheduledReviewPlanning({DB:noDb,LIFEAPP_REVIEW_PLANNER_ENABLED:'true'},now.valueOf());
 const f=fixture();await f.setup();
 await scheduledReviewPlanning({DB:f.db,LIFEAPP_AUTH_MODE:'google',LIFEAPP_REVIEW_PLANNER_ENABLED:'true'},now.valueOf());
 assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM life_review_jobs').get().n,1);assert.equal(f.calls(),0);f.raw.close();
});
