import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { handleLife } from '../lib/life/service.ts';
import { DraftSync } from '../lib/life/draft-sync.ts';
import {settingsForAI} from '../lib/life/ai-configuration.ts';
import {limitsForAI} from '../lib/life/ai-limits.ts';
import { geminiProvider,tokenCostMicros,AI_MODEL,MAX_OUTPUT_TOKENS,RESERVATION_MICROS } from '../lib/life/ai-provider.ts';
const now=new Date('2026-09-09T12:00:00Z');
const profile={goal:'Synthetic goal: read consistently',timezone:'UTC',modules:['reflection'],habits:[],version:0};
const entry=(date='2026-09-08')=>({date,journal:'Synthetic journal: read a chapter.',context:{},statuses:[],version:0,complete:true});
const result={text:'2026-09-08: You made time for your reading goal.',inputTokens:100,outputTokens:40,thoughtTokens:10,costMicros:225,providerId:'synthetic-response',modelVersion:AI_MODEL,finishReason:'STOP'};
function fixture(provider={generate:async()=>result},caps={}){
 const raw=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+f,'utf8'));
 const db={prepare(sql){return {bind(...params){const q=raw.prepare(sql);return {async first(){return q.get(...params)||null;},async all(){return {results:q.all(...params)};}};}};}};
 const settings={provider,enabled:true,userCapMicros:1000000,globalCapMicros:5000000,...caps};
 async function call(body,id='a',path='',at=now){return handleLife(new Request('https://life.test/api/life'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json',Origin:'https://life.test'}:{},body:body?JSON.stringify(body):undefined}),id,db,at,settings);}
 async function setup(id='a',date='2026-09-08',complete=true){assert.equal((await call({action:'profile',profile},id)).status,200);assert.equal((await call({action:'entry',entry:{...entry(date),complete}},id)).status,200);}
 return {raw,db,call,setup,settings};
}
const review=(overrides={})=>({action:'ai',review:{date:'2026-09-08',requestId:randomUUID(),sourceVersion:1,predecessorId:null,critique:'',consent:true,...overrides}});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}

const ownerPrototype={userId:'google:synthetic-owner',expiresAt:'2026-10-14T23:59:59.000Z'};
function archivedUsage(f,id,n,{cost=100,at=now.toISOString(),error=null}={}){for(let i=0;i<n;i++)f.raw.prepare("INSERT INTO life_deleted_ai_usage(user_id,request_id,status,model,price_version,reserved_micros,cost_micros,created_at,error_code) VALUES(?,?,'failed','synthetic','synthetic',200000,?,?,?)").run(id,randomUUID(),cost,at,error);}
test('prototype limits require the exact server-configured identity and expire without changing global settings',()=>{
 const env={LIFEAPP_AUTH_MODE:'google',LIFEAPP_AI_OWNER_USER_ID:ownerPrototype.userId,LIFEAPP_AI_OWNER_LIMITS_UNTIL:ownerPrototype.expiresAt};
 const settings=settingsForAI(env);
 assert.deepEqual(limitsForAI(settings,ownerPrototype.userId,now),{userCapMicros:5000000,dailyAttempts:25,builderAttempts:10,regenerations:5});
 for(const id of ['google:other','synthetic-owner','owner@example.test'])assert.equal(limitsForAI(settings,id,now).dailyAttempts,5);
 for(const override of [{LIFEAPP_AUTH_MODE:'sites'},{LIFEAPP_AI_OWNER_USER_ID:''},{LIFEAPP_AI_OWNER_LIMITS_UNTIL:'invalid'}])assert.equal(limitsForAI(settingsForAI({...env,...override}),ownerPrototype.userId,now).dailyAttempts,5);
 assert.equal(limitsForAI(settings,ownerPrototype.userId,new Date(ownerPrototype.expiresAt)).dailyAttempts,5);
 assert.equal(settings.globalCapMicros,5000000);assert.equal(settings.userCapMicros,1000000);assert.equal(settings.enabled,false);
});
test('owner daily analysis admission includes archived attempts and keeps other accounts at five',async()=>{
 const f=fixture(undefined,{ownerPrototype});try{await f.setup(ownerPrototype.userId);await f.setup('google:other');
 archivedUsage(f,ownerPrototype.userId,24);archivedUsage(f,'google:other',5);
 assert.equal((await f.call(review(),'google:other')).status,429);
 assert.equal((await f.call(review(),ownerPrototype.userId)).status,200);
 const original=(await (await f.call(undefined,ownerPrototype.userId,'?ai=1&date=2026-09-08')).json()).reports[0];
 assert.equal((await f.call(review({predecessorId:original.id}),ownerPrototype.userId)).status,429);
 assert.equal(f.raw.prepare('SELECT count(*) n FROM life_ai_usage WHERE user_id=?').get(ownerPrototype.userId).n,25);
 }finally{f.raw.close();}
});
test('owner regeneration allowance is five, expires, and cannot bypass the shared spending cap or breaker',async()=>{
 const f=fixture(undefined,{ownerPrototype});try{await f.setup(ownerPrototype.userId);
 let response=await (await f.call(review(),ownerPrototype.userId)).json();
 for(let i=0;i<5;i++){const r=await f.call(review({predecessorId:response.report.id}),ownerPrototype.userId);assert.equal(r.status,200);response=await r.json();}
 assert.equal((await f.call(review({predecessorId:response.report.id}),ownerPrototype.userId)).status,429);
 const status=await (await f.call(undefined,ownerPrototype.userId,'?ai=1&date=2026-09-08')).json();assert.equal(status.regenerationsRemaining,0);assert.equal(status.usage.capMicros,5000000);assert.equal(status.ownerPrototype,undefined);
 }finally{f.raw.close();}
 const g=fixture(undefined,{ownerPrototype});try{await g.setup(ownerPrototype.userId);
 archivedUsage(g,ownerPrototype.userId,1,{cost:1100000,at:'2026-09-01T00:00:00.000Z'});
 assert.equal((await g.call(review(),ownerPrototype.userId)).status,200);
 assert.equal((await g.call({action:'entry',entry:entry('2026-09-07')},ownerPrototype.userId)).status,200);
 g.settings.globalCapMicros=1200000;assert.equal((await g.call(review({date:'2026-09-07'}),ownerPrototype.userId)).status,429);
 g.settings.globalCapMicros=5000000;archivedUsage(g,'google:retired',1,{error:'cost_bound_exceeded'});assert.equal((await g.call(review({date:'2026-09-07'}),ownerPrototype.userId)).status,429);
 }finally{g.raw.close();}
});

test('draft writer serializes saves and keeps typing that arrives during a request',async()=>{
 const first=deferred(),second=deferred(),sent=[];
 const initial={...entry(),habits:[],version:1,complete:false};
 const writer=new DraftSync(initial,async(e,id)=>{sent.push({e,id});return await (sent.length===1?first:second).promise;},()=>{});
 writer.edit({...initial,journal:'First edit'});const flushing=writer.flush();
 writer.edit({...writer.entry,journal:'Newer typing'});assert.equal(writer.status,'saving');
 assert.equal(writer.flush(),flushing);assert.equal(sent.length,1);
 first.resolve({...sent[0].e,version:2});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(sent.length,2);assert.equal(sent[1].e.journal,'Newer typing');assert.equal(sent[1].e.version,2);
 second.resolve({...sent[1].e,version:3});await flushing;
 assert.equal(writer.entry.journal,'Newer typing');assert.equal(writer.entry.version,3);assert.equal(writer.dirty,false);
});
test('ambiguous draft failure keeps edits and retries the identical mutation before new typing',async()=>{
 const sent=[];let fail=true;const initial={...entry(),habits:[],version:0};
 const writer=new DraftSync(initial,async(e,id)=>{sent.push({e,id});if(fail){fail=false;throw Error('Connection lost');}return {...e,version:e.version+1};},()=>{});
 writer.edit({...initial,journal:'Saved but response lost'});await assert.rejects(writer.flush());assert.equal(writer.dirty,true);assert.equal(writer.status,'error');
 writer.edit({...writer.entry,journal:'Typed while offline'});await writer.flush();
 assert.equal(sent[0].id,sent[1].id);assert.deepEqual(sent[0].e,sent[1].e);assert.notEqual(sent[1].id,sent[2].id);
 assert.equal(writer.entry.journal,'Typed while offline');assert.equal(writer.entry.version,2);assert.equal(writer.dirty,false);
});
test('server acknowledges a lost draft response without a second write; rejects reused ID with new text',async()=>{
 const f=fixture();await f.setup();const mutationId=randomUUID();
 const body={action:'entry',entry:{...entry(),version:1,mutationId,journal:'Autosaved synthetic text',complete:false}};
 assert.equal((await f.call(body)).status,200);const retry=await f.call(body);assert.equal(retry.status,200);assert.equal((await retry.json()).entry.version,2);
 assert.equal(f.raw.prepare('SELECT version FROM life_entries').get().version,2);
 assert.equal((await f.call({...body,entry:{...body.entry,journal:'Different'}})).status,409);
 assert.equal((await f.call({...body,entry:{...body.entry,mutationId:randomUUID()}})).status,409);f.raw.close();
});
test('explicit Save commits completion and text together; unchanged Save does not create a revision',async()=>{
 const sent=[],initial={...entry(),habits:[],complete:false};
 const writer=new DraftSync(initial,async(e,id)=>{sent.push({e,id});return {...e,version:e.version+1};},()=>{});
 writer.edit({...initial,journal:'Only saved when requested'});
 assert.equal(sent.length,0);assert.equal(writer.status,'waiting');
 await writer.commit(true);
 assert.equal(sent.length,1);assert.equal(sent[0].e.complete,true);assert.equal(sent[0].e.journal,'Only saved when requested');
 await writer.commit(true);assert.equal(sent.length,1);assert.equal(writer.entry.version,1);
 writer.edit({...writer.entry,journal:'',complete:false});await writer.commit(false);
 assert.equal(sent.length,2);assert.equal(writer.entry.complete,false);
});
test('explicit Save retries the exact unconfirmed mutation before committing newer edits',async()=>{
 const sent=[];let fail=true;const initial={...entry(),habits:[],complete:false};
 const writer=new DraftSync(initial,async(e,id)=>{sent.push({e,id});if(fail){fail=false;throw Error('Lost acknowledgement');}return {...e,version:e.version+1};},()=>{});
 writer.edit({...initial,journal:'First saved text'});await assert.rejects(writer.commit(true));
 writer.edit({...writer.entry,journal:'New text after failure',complete:false});await writer.commit(false);
 assert.equal(sent[0].id,sent[1].id);assert.deepEqual(sent[0].e,sent[1].e);
 assert.equal(sent.length,3);assert.equal(sent[2].e.journal,'New text after failure');assert.equal(sent[2].e.complete,false);assert.equal(writer.dirty,false);
});
test('AI rejects incomplete, stale, unconsented and unconfigured requests without spending',async()=>{
 let calls=0;const f=fixture({generate:async()=>{calls++;return result;}});await f.setup('a','2026-09-08',false);
 assert.equal((await f.call(review())).status,409);
 assert.equal((await f.call({action:'entry',entry:{...entry(),version:1}})).status,200);
 assert.equal((await f.call(review())).status,409);
 assert.equal((await f.call(review({sourceVersion:2,consent:false}))).status,400);
 f.settings.enabled=false;assert.equal((await f.call(review({sourceVersion:2}))).status,503);
 assert.equal(calls,0);assert.equal(f.raw.prepare('SELECT count(*) n FROM life_ai_reviews').get().n,0);f.raw.close();
});
test('concurrent daily requests call provider once and saved originals survive revised entries/reviews',async()=>{
 const pending=deferred();let calls=0;const f=fixture({generate:async()=>{calls++;return pending.promise;}});await f.setup();
 const a=f.call(review()),b=f.call(review());await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
 pending.resolve(result);const responses=await Promise.all([a,b]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,202]);
 const original=(await (await f.call(review())).json()).report;assert.equal(calls,1);
 assert.equal((await f.call({action:'entry',entry:{...entry(),version:1,journal:'Updated synthetic day'}})).status,200);
 const preserved=(await (await f.call(review({sourceVersion:2}))).json()).report;assert.equal(preserved.sourceVersion,1);
 assert.equal((await f.call(review({sourceVersion:2,predecessorId:"not-the-latest-analysis"}))).status,409);
 const revision=review({sourceVersion:2,predecessorId:original.id,critique:'Focus more on reading.'});
 assert.equal((await f.call(revision)).status,200);assert.equal((await f.call(revision)).status,200);assert.equal(calls,2);
 const history=await (await f.call(undefined,'a','?ai=1')).json();assert.equal(history.reports.length,2);assert.equal(history.usage.measuredMicros,450);
 const other=await (await f.call(undefined,'b','?ai=1')).json();assert.deepEqual(other.reports,[]);assert.equal(other.usage.allocatedMicros,0);
 assert.equal((await f.call(review(),'b')).status,400);f.raw.close();
});
test('atomic global cap admits only one concurrent account and retains uncertain reservations',async()=>{
 const pending=deferred();let calls=0;const f=fixture({generate:async()=>{calls++;return pending.promise;}},{globalCapMicros:RESERVATION_MICROS});await f.setup('a');await f.setup('b');
 const tasks=[f.call(review(),'a'),f.call(review(),'b')];await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
 pending.reject(Error('Synthetic timeout'));const responses=await Promise.all(tasks);assert.deepEqual(responses.map(r=>r.status).sort(),[429,502]);
 const held=f.raw.prepare('SELECT * FROM life_ai_reviews').get();assert.equal(held.status,'uncertain');assert.equal(held.cost_micros,null);assert.equal(held.reserved_micros,RESERVATION_MICROS);
 assert.equal((await f.call(review(),held.user_id)).status,200);assert.equal(calls,1);f.raw.close();
});
test('account cap and pricing expiry block new calls; incomplete outputs retain measured cost',async()=>{
 let calls=0;const f=fixture({generate:async()=>{calls++;return {...result,finishReason:'MAX_TOKENS'};}},{userCapMicros:RESERVATION_MICROS-1});await f.setup();
 assert.equal((await f.call(review())).status,429);f.settings.userCapMicros=1000000;
 assert.equal((await f.call(review(),'a','',new Date('2027-01-01T00:00:00Z'))).status,503);assert.equal(calls,0);
 const report=(await (await f.call(review())).json()).report;assert.equal(report.status,'failed');assert.equal(report.costMicros,result.costMicros);assert.equal(calls,1);f.raw.close();
});
test('unexpected provider cost opens circuit breaker before subsequent attempts',async()=>{
 let calls=0;const f=fixture({generate:async()=>{calls++;return {...result,costMicros:RESERVATION_MICROS+1};}});await f.setup('a');await f.setup('b');
 const report=(await (await f.call(review(),'a')).json()).report;assert.equal(report.errorCode,'cost_bound_exceeded');
 assert.equal((await f.call(review(),'b')).status,429);assert.equal(calls,1);f.raw.close();
});
test('Gemini REST adapter keeps key in server header and includes thinking in measured usage',async()=>{
 let calls=0;const provider=geminiProvider('synthetic-secret',async(url,init)=>{
  calls++;assert.equal(url,`https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent`);assert.equal(init.headers['x-goog-api-key'],'synthetic-secret');
  const body=JSON.parse(init.body);assert.equal(body.generationConfig.maxOutputTokens,MAX_OUTPUT_TOKENS);assert.equal(body.generationConfig.candidateCount,1);assert.equal(body.tools,undefined);assert.doesNotMatch(init.body,/synthetic-secret/);
  return Response.json({responseId:'test-response',modelVersion:AI_MODEL,candidates:[{content:{parts:[{text:'hidden internal thought',thought:true},{text:'Visible review'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:20,thoughtsTokenCount:30,totalTokenCount:150}});
 });
 const response=await provider.generate('{"synthetic":true}');assert.equal(response.text,'Visible review');assert.equal(response.outputTokens,50);assert.equal(response.costMicros,tokenCostMicros(100,50));assert.equal(calls,1);
});
test('provider failures and unverified usage never trigger implicit retry',async()=>{
 let calls=0;const provider=geminiProvider('synthetic-secret',async()=>{calls++;return new Response('Synthetic unavailable',{status:503});});
 await assert.rejects(provider.generate('{}'),/503/);assert.equal(calls,1);
 await assert.rejects(geminiProvider('synthetic-secret',async()=>Response.json({candidates:[]})).generate('{}'),/usage/);
});
