import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { handleLife } from '../lib/life/service.ts';
import { DraftSync } from '../lib/life/draft-sync.ts';
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
 assert.equal((await f.call(review({sourceVersion:2,predecessorId:original.id}))).status,409);
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
