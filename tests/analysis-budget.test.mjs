import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {handleLife} from '../lib/life/service.ts';
import {profileSchema,emptyEntry} from '../lib/life/domain.ts';
import {analysisWindow,lastClosedPeriod,duePeriod} from '../lib/life/analysis-periods.ts';
import {consumePeriodicAnalyses} from '../lib/life/periodic-analyses.ts';
import {budgetSchema,recurringSchema,recurringDate,budgetSummary,occurrenceId} from '../lib/life/modules.ts';
import {activityTotals,activityTrends} from '../lib/life/activity.ts';
import {validateBackup} from '../lib/life/migration-preview.ts';
import {buildPeriodContext} from '../lib/life/period-context.ts';
import {AI_MODEL} from '../lib/life/ai-provider.ts';
import {savedDayQuery} from '../lib/life/saved-day-link.ts';
const now=new Date('2026-09-14T10:00:00Z');
const profile=()=>profileSchema.parse({goal:'Synthetic goals',timezone:'UTC',modules:['reflection'],habits:[],version:0});
const output={text:'Synthetic analysis: steady progress.',inputTokens:80,outputTokens:20,thoughtTokens:0,costMicros:100,providerId:'synthetic',modelVersion:AI_MODEL,finishReason:'STOP'};
function fixture(){
 const raw=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+f,'utf8'));
 const state={calls:[],queries:0,beforeInsert:null};const settings={enabled:true,automaticEnabled:true,userCapMicros:10000000,globalCapMicros:20000000,provider:{generate:async snapshot=>{state.calls.push(JSON.parse(snapshot));return output;}}};
 const db={prepare(sql){return {bind(...params){return {async first(){state.queries++;if(sql.startsWith('INSERT INTO life_ai_reviews')&&state.beforeInsert){const fn=state.beforeInsert;state.beforeInsert=null;fn();}return raw.prepare(sql).get(...params)||null;},async all(){state.queries++;return {results:raw.prepare(sql).all(...params)};}};}};}};
 const call=(body,id='a',path='',at=now)=>handleLife(new Request('https://life.test/api/life'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json',Origin:'https://life.test'}:{},body:body?JSON.stringify(body):undefined}),id,db,at,settings);
 async function setup(id='a',date='2026-09-13'){assert.equal((await call({action:'profile',profile:profile()},id)).status,200);await addDay(date,id);}
 async function addDay(date,id='a'){assert.equal((await call({action:'entry',entry:{date,journal:'Synthetic daily activity',context:{},statuses:[],complete:true,version:0}},id)).status,200);}
 return {raw,db,state,settings,call,setup,addDay};
}
const ai=(cadence='daily',date='2026-09-13',extra={})=>({action:'ai',review:{cadence,date,sourceVersion:1,requestId:randomUUID(),predecessorId:null,critique:'',consent:true,...extra}});
test('core areas are included without adopting habits; custom schedules remain intact',()=>{
 const p=profile();assert.deepEqual(p.modules,['reflection','fitness','money']);assert.deepEqual(emptyEntry(p,'2026-09-13').habits,[]);assert.equal(p.reviewPreferences.daily.time,'04:00');
 p.reviewPreferences.daily.time='06:30';assert.equal(profileSchema.parse(p).reviewPreferences.daily.time,'06:30');
});
test('closed calendar periods handle year boundaries, leap years and local schedule gates',()=>{
 assert.deepEqual(analysisWindow('monthly','2024-02-29'),{from:'2024-02-01',through:'2024-02-29'});
 assert.equal(lastClosedPeriod('weekly','2026-01-01').through,'2025-12-28');assert.equal(lastClosedPeriod('annual','2026-09-14').through,'2025-12-31');
 assert.throws(()=>analysisWindow('weekly','2026-09-14'));assert.throws(()=>analysisWindow('monthly','2026-09-29'));
 const p=profile();p.timezone='America/New_York';assert.equal(duePeriod(p,'weekly',new Date('2026-09-14T07:59:00Z')),null);assert.equal(duePeriod(p,'weekly',new Date('2026-09-14T08:00:00Z')).through,'2026-09-13');
 assert.equal(duePeriod(p,'weekly',new Date('2026-11-02T08:59:00Z')),null);assert.equal(duePeriod(p,'weekly',new Date('2026-11-02T09:00:00Z')).through,'2026-11-01');
 p.reviewPreferences.monthDay=31;assert.equal(duePeriod(p,'monthly',new Date('2026-02-27T10:00:00Z')),null);assert.equal(duePeriod(p,'monthly',new Date('2026-02-28T10:00:00Z')).through,'2026-01-31');
});
test('monthly weekday schedules and required variable estimates survive old-plan normalization',()=>{
 const r=recurringSchema.parse({id:randomUUID(),title:'Electric bill',kind:'expense',amountCents:8000,categoryId:randomUUID(),day:31,variable:true,frequency:'monthly-weekday',week:'second',weekday:1});
 assert.equal(recurringDate('2026-09',r),'2026-09-14');assert.equal(recurringDate('2026-02',{...r,week:'last',weekday:5}),'2026-02-27');assert.equal(recurringDate('2024-02',{...r,week:'last',weekday:4}),'2024-02-29');assert.equal(recurringDate('2027-01',{...r,week:'first',weekday:1}),'2027-01-04');
 assert.equal(recurringDate('2026-02',{...r,frequency:'monthly-day'}),'2026-02-28');assert.equal(recurringSchema.safeParse({...r,amountCents:0}).success,false);const {amountCents,...missing}=r;assert.equal(recurringSchema.safeParse(missing).success,false);
 const old=recurringSchema.parse({id:r.id,title:r.title,kind:r.kind,amountCents:8000,categoryId:r.categoryId,day:31});assert.equal(old.variable,false);assert.equal(old.frequency,'monthly-day');
});
test('variable occurrence forecasts become actuals once, with inline-compatible exact retry and preserved references',async()=>{
 const f=fixture();try{await f.setup();const category=randomUUID(),recurring=randomUUID();
 const plan=budgetSchema.parse({currency:'USD',categories:[{id:category,name:'Bills',limitCents:20000}],recurring:[{id:recurring,title:'Electric',kind:'expense',amountCents:8000,categoryId:category,day:1,variable:true,frequency:'monthly-weekday',week:'second',weekday:1}],goals:{spending:'Reduce bills',saving:'',investing:''}});
 assert.equal((await f.call({action:'resource',record:{kind:'budget',id:'2026-09',version:0,data:plan}})).status,200);
 let summary=budgetSummary(plan,[],'2026-09');assert.equal(summary.expenses,0);assert.equal(summary.categories[0].scheduled,8000);assert.equal(summary.categories[0].afterScheduled,12000);
 const tx={action:'resource',record:{kind:'transaction',id:occurrenceId('2026-09',recurring),version:0,data:{date:'2026-09-14',kind:'expense',amountCents:9257,categoryId:category,note:'Electric actual',recurringId:recurring,voided:false}}};
 const first=await f.call(tx);assert.equal(first.status,200);const saved=(await first.json()).record;assert.equal((await (await f.call(tx)).json()).record.version,1);
 summary=budgetSummary(plan,[saved],'2026-09');assert.equal(summary.expenses,9257);assert.equal(summary.categories[0].scheduled,0);assert.equal(summary.due[0].recorded,true);
 assert.equal((await f.call({...tx,record:{...tx.record,id:randomUUID()}})).status,400);
 const changed=await f.call({...tx,record:{...tx.record,version:1,data:{...tx.record.data,amountCents:9500}}});assert.equal(changed.status,200);assert.equal((await f.call(tx)).status,409);
 assert.equal((await f.call({action:'resource',record:{kind:'budget',id:'2026-09',version:1,data:{...plan,categories:[],recurring:[]}}})).status,400);
 assert.equal((await f.call({action:'resource',record:{kind:'budget',id:'2026-09',version:1,data:{...plan,categories:plan.categories.map(c=>({...c,archived:true})),recurring:plan.recurring.map(r=>({...r,active:false}))}}})).status,200);
 const backup=validateBackup(JSON.stringify(await (await f.call(undefined,'a','?export=1')).json()));assert.equal(backup.resources.length,2);
 }finally{f.raw.close();}
});
test('feedback saves without AI, is idempotent and account-scoped, and guides future generations',async()=>{
 const f=fixture();try{await f.setup();await f.setup('b');const original=(await (await f.call(ai())).json()).report;
 const feedback={action:'analysis-feedback',feedback:{id:randomUUID(),text:'Keep suggestions practical.',reportId:original.id,date:original.date,cadence:'daily',profileVersion:1}};
 const saved=await f.call(feedback);assert.equal(saved.status,200);assert.equal((await saved.json()).profile.version,2);assert.equal(f.state.calls.length,1);
 assert.equal((await f.call(feedback)).status,200);assert.equal((await f.call(feedback,'b')).status,409);
 assert.equal((await f.call({...feedback,feedback:{...feedback.feedback,text:'Different'}})).status,409);
 await f.addDay('2026-09-12');assert.equal((await f.call(ai('daily','2026-09-12'))).status,200);assert.equal(f.state.calls.at(-1).context.savedGuidance[0].text,'Keep suggestions practical.');
 const p=(await (await f.call()).json()).profile;p.analysisGuidance[0].text='Focus on consistency.';assert.equal((await f.call({action:'profile',profile:p})).status,200);
 assert.equal(f.raw.prepare('SELECT report_text FROM life_ai_reviews WHERE request_id=?').get(original.id).report_text,original.text);
 }finally{f.raw.close();}
});
test('plain regeneration preserves originals and limits concurrent revisions to two per analysis per day',async()=>{
 const f=fixture();try{await f.setup();let last=(await (await f.call(ai())).json()).report;const original=last.id;
 for(let i=0;i<2;i++){const responses=await Promise.all([f.call(ai('daily','2026-09-13',{predecessorId:last.id})),f.call(ai('daily','2026-09-13',{predecessorId:last.id}))]);assert.equal(responses.filter(r=>r.status===200).length,1);last=(await (await f.call(undefined,'a','?ai=1&date=2026-09-13')).json()).reports[0];}
 assert.equal((await f.call(ai('daily','2026-09-13',{predecessorId:last.id}))).status,429);assert.equal(f.state.calls.length,3);assert.equal(f.raw.prepare('SELECT count(*) n FROM life_ai_reviews WHERE request_id=?').get(original).n,1);
 assert.equal((await (await f.call(undefined,'a','?ai=1&date=2026-09-13')).json()).regenerationsRemaining,0);
 }finally{f.raw.close();}
});
test('daily, weekly, monthly and annual analyses share accounting but have independent original identities',async()=>{
 const f=fixture();try{await f.setup();await f.addDay('2026-08-31');await f.addDay('2025-12-31');
 for(const [cadence,date] of [['daily','2026-09-13'],['weekly','2026-09-13'],['monthly','2026-08-31'],['annual','2025-12-31']]){const response=await f.call(ai(cadence,date));assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assert.equal((await response.json()).report.id,cadence+':'+date);}
 assert.equal(f.state.calls.length,4);assert.equal(f.raw.prepare('SELECT SUM(cost_micros) n FROM life_ai_usage').get().n,400);
 assert.equal((await (await f.call(undefined,'a','?ai=1&date=2026-09-13')).json()).reports.length,1);assert.equal((await (await f.call(undefined,'a','?ai=1&date=2026-09-13&cadence=weekly')).json()).reports.length,1);
 const backup=validateBackup(JSON.stringify(await (await f.call(undefined,'a','?export=1')).json()));assert.equal(backup.reviews.length,4);
 const dashboard=await (await f.call(undefined,'a','?dashboard=1')).json();assert.deepEqual(dashboard.periods.map(p=>p.available),[true,true,true]);
 assert.equal((await f.call(ai('monthly','2026-09-30'))).status,409);
 }finally{f.raw.close();}
});
test('period context aggregates all source days and labels excerpts without inventing missing activity',()=>{
 const entries=Array.from({length:31},(_,i)=>({date:'2026-08-'+String(i+1).padStart(2,'0'),journal:'Synthetic '.repeat(80),context:{},habits:[],complete:true,version:1}));
 const context=buildPeriodContext(profile(),'monthly','2026-08-01','2026-08-31',entries,{transactions:[],workouts:[],cardio:[]},[]);
 assert.equal(context.coverage.checkInDays,31);assert.equal(context.entries.length,24);assert.equal(context.entries[0].date,'2026-08-01');assert.equal(context.entries.at(-1).date,'2026-08-31');assert.equal(context.activity.cardioMinutes,0);assert.equal(context.sampling.journalTextMayBeTruncated,true);
});
test('period generation rechecks source entries and consent atomically before spending',async()=>{
 const f=fixture();try{await f.setup();f.state.beforeInsert=()=>f.raw.prepare('UPDATE life_entries SET version=version+1 WHERE user_id=?').run('a');assert.equal((await f.call(ai('weekly'))).status,429);assert.equal(f.state.calls.length,0);
 const enable={action:'period-consent',consent:{enabled:true,version:0,policyVersion:'periods-v1'}};assert.equal((await f.call(enable,'a','',new Date('2026-09-10T10:00:00Z'))).status,200);
 f.state.beforeInsert=()=>f.raw.prepare("UPDATE life_period_consent SET enabled=0,version=version+1 WHERE user_id='a'").run();const stats=await consumePeriodicAnalyses(f.db,f.settings,()=>now);assert.equal(stats.completed,0);assert.equal(f.state.calls.length,0);
 }finally{f.raw.close();}
});
test('period automation is separate, does not backfill before opt-in, and never duplicates completed or unknown attempts',async()=>{
 const f=fixture();try{await f.setup();assert.equal((await consumePeriodicAnalyses(f.db,f.settings,()=>now)).considered,0);
 const body={action:'period-consent',consent:{enabled:true,version:0,policyVersion:'periods-v1'}};assert.equal((await f.call(body)).status,200);assert.equal((await consumePeriodicAnalyses(f.db,f.settings,()=>now)).considered,0);
 assert.equal((await f.call(body)).status,409);f.raw.prepare("UPDATE life_period_consent SET start_date='2026-09-10' WHERE user_id='a'").run();
 f.state.queries=0;assert.equal((await consumePeriodicAnalyses(f.db,f.settings,()=>now)).completed,1);assert.ok(f.state.queries<25);assert.equal((await consumePeriodicAnalyses(f.db,f.settings,()=>now)).considered,0);assert.equal(f.state.calls.length,1);
 const backup=validateBackup(JSON.stringify(await (await f.call(undefined,'a','?export=1')).json()));assert.equal(backup.periodicConsent.enabled,1);
 f.raw.prepare("INSERT INTO life_account_deletions VALUES('a',?)").run(now.toISOString());assert.equal(f.raw.prepare('SELECT count(*) n FROM life_period_consent').get().n,0);assert.throws(()=>f.raw.exec("INSERT INTO life_period_consent VALUES('a',1,1,'periods-v1','2026-09-10','x','x',NULL)"),/deleted/);
 }finally{f.raw.close();}
});
test('cardio validation, retry, correction, voiding and trends are scoped and exact',async()=>{
 const f=fixture();try{await f.setup();const record={kind:'cardio',id:randomUUID(),version:0,data:{date:'2026-09-14',activity:'run',minutes:30,distance:3,unit:'mi',intensity:'moderate',note:'Synthetic run',voided:false}};
 assert.equal((await f.call({action:'resource',record:{...record,data:{...record.data,date:'2026-09-15'}}})).status,400);
 assert.equal((await f.call({action:'resource',record:{...record,data:{...record.data,minutes:0}}})).status,400);
 assert.equal((await f.call({action:'resource',record})).status,200);assert.equal((await (await f.call({action:'resource',record})).json()).record.version,1);
 let dashboard=await (await f.call(undefined,'a','?dashboard=1')).json();assert.equal(dashboard.trends.at(-1).cardioMinutes,30);assert.equal(dashboard.trends.at(-1).cardioKm,4.83);
 assert.equal((await (await f.call(undefined,'b','?kind=cardio')).json()).records.length,0);validateBackup(JSON.stringify(await (await f.call(undefined,'a','?export=1')).json()));
 assert.equal((await f.call({action:'resource',record:{...record,version:1,data:{...record.data,voided:true}}})).status,200);dashboard=await (await f.call(undefined,'a','?dashboard=1')).json();assert.equal(dashboard.trends.at(-1).cardioMinutes,0);
 }finally{f.raw.close();}
});
test('trend buckets separate transfers, voids, pending strength and prior weeks',()=>{
 const records={transactions:[{data:{date:'2026-09-14',kind:'expense',amountCents:1000,voided:false}},{data:{date:'2026-09-14',kind:'expense',amountCents:8000,voided:true}},{data:{date:'2026-09-14',kind:'saving',amountCents:5000,voided:false}}],workouts:[{data:{date:'2026-09-14',finishedAt:null,sets:[]}},{data:{date:'2026-09-01',finishedAt:now.toISOString(),sets:[{}]}}],cardio:[]};
 const totals=activityTotals(records,'2026-09-01','2026-09-14');assert.equal(totals.spendingCents,1000);assert.equal(totals.savingCents,5000);assert.equal(totals.strengthSessions,1);assert.equal(activityTrends(records,'2026-09-14').at(-1).strengthSessions,0);
});
test('0008 adds cadence and consent without rewriting old payloads, usage or daily eligibility',()=>{
 const raw=new DatabaseSync(':memory:');try{for(const f of readdirSync('drizzle').filter(f=>/^000[0-7]_.*sql$/.test(f)).sort())raw.exec(readFileSync('drizzle/'+f,'utf8'));
 raw.exec("INSERT INTO life_profiles VALUES('a','{\"goal\":\"preserved\"}',3,'2026-09-09'); INSERT INTO life_entries VALUES('a','2026-09-06','{\"journal\":\"preserved\",\"complete\":true,\"habits\":[]}',2,'2026-09-09'); INSERT INTO life_review_jobs VALUES('a','2026-09-06','2026-09-09','UTC','08:00',3,NULL);");
 raw.exec("INSERT INTO life_ai_reviews(user_id,request_id,entry_date,revision,source_version,critique,status,input_snapshot,report_text,model,price_version,reserved_micros,cost_micros,created_at) VALUES('a','daily:2026-09-06','2026-09-06',1,2,'','uncertain','private snapshot',NULL,'synthetic','synthetic',200000,NULL,'2026-09-09')");
 const old=raw.prepare('SELECT * FROM life_ai_reviews').get(),usage=raw.prepare('SELECT * FROM life_ai_usage').all(),entries=raw.prepare('SELECT * FROM life_entries').all(),view=raw.prepare('SELECT * FROM life_daily_job_status').all();
 raw.exec(readFileSync('drizzle/0008_analysis_periods.sql','utf8'));const after=raw.prepare('SELECT * FROM life_ai_reviews').get();assert.deepEqual(Object.fromEntries(Object.keys(old).map(k=>[k,after[k]])),{...old});assert.deepEqual(raw.prepare('SELECT * FROM life_ai_usage').all(),usage);assert.deepEqual(raw.prepare('SELECT * FROM life_entries').all(),entries);assert.deepEqual(raw.prepare('SELECT * FROM life_daily_job_status').all(),view);assert.equal(raw.prepare('SELECT count(*) n FROM life_period_consent').get().n,0);
 raw.exec("INSERT INTO life_ai_reviews(user_id,request_id,entry_date,cadence,window_start,revision,source_version,critique,status,input_snapshot,report_text,model,price_version,reserved_micros,cost_micros,created_at) VALUES('a','weekly:2026-09-06','2026-09-06','weekly','2026-08-31',1,3,'','complete','{}','weekly text','synthetic','synthetic',200000,100,'2026-09-09')");assert.deepEqual(raw.prepare('SELECT * FROM life_daily_job_status').all(),view);
 }finally{raw.close();}
});
test('period links retain safe cadence without arbitrary query parameters',()=>{
 assert.equal(savedDayQuery('2026-08-31','monthly'),'?date=2026-08-31&analysis=monthly');assert.equal(savedDayQuery('2026-08-31','bad'),'');assert.equal(savedDayQuery('2026-02-30','annual'),'');
});
