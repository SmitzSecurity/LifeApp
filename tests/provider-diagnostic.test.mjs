import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {handleLife} from '../lib/life/service.ts';
import {geminiProvider,AIRequestRejected} from '../lib/life/ai-provider.ts';
import {settingsForAI} from '../lib/life/ai-configuration.ts';

const now=new Date('2026-09-16T20:00:00.000Z'),owner='google:synthetic-owner';
const exactKey='synthetic-private-provider-key',otherKey='AIzaSyntheticOther_Key-123';
const canary='PROVIDER_DIAGNOSTIC_CANARY';
const upstream=()=>Response.json({error:{code:400,status:'INVALID_ARGUMENT',message:`Schema ${canary}; ${exactKey}; ${otherKey}`}}, {status:400});

test('temporary provider diagnostic redacts both the configured key and other Google keys and stays bounded',async()=>{
 const provider=geminiProvider(exactKey,async()=>upstream());
 await assert.rejects(provider.generate('Synthetic budget','budget'),error=>{
  assert.ok(error instanceof AIRequestRejected);
  assert.match(error.message,/\(schema\)/);assert.ok(!error.message.includes(canary));
  assert.ok(error.diagnostic.includes(canary));assert.ok(error.diagnostic.includes('[redacted]'));
  assert.ok(!error.diagnostic.includes(exactKey));assert.ok(!error.diagnostic.includes(otherKey));assert.ok(!error.diagnostic.includes('AIza'));
  return true;
 });
 const oversized=geminiProvider(exactKey,async()=>Response.json({error:{code:400,status:'INVALID_ARGUMENT',message:'Schema '+('x'.repeat(10000))}},{status:400}));
 await assert.rejects(oversized.generate('Synthetic budget','budget'),error=>{
  assert.ok(error instanceof AIRequestRejected);assert.ok(error.diagnostic.length<=4000);return true;
 });
});

function fixture(t,{configuredOwner=owner,expiry='2026-10-14T23:59:59.000Z',at=now}={}){
 const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+file,'utf8'));
 const db={prepare(sql){return {bind(...params){return {async first(){return raw.prepare(sql).get(...params)||null;},async all(){return {results:raw.prepare(sql).all(...params)};}};}};}};
 let calls=0;
 const settings={...settingsForAI({LIFEAPP_AUTH_MODE:'google',LIFEAPP_AI_ENABLED:'true',LIFEAPP_AI_PAID_PROJECT:'true',LIFEAPP_AI_OWNER_USER_ID:configuredOwner,LIFEAPP_AI_OWNER_LIMITS_UNTIL:expiry}),provider:geminiProvider(exactKey,async()=>{calls++;return upstream();})};
 const call=(body,user=owner,query='')=>handleLife(new Request('https://life.test/api/life'+query,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:'https://life.test'},body:body?JSON.stringify(body):undefined}),user,db,at,settings);
 const setup=async user=>assert.equal((await call({action:'profile',profile:{goal:'Synthetic goal',timezone:'UTC',modules:['money'],habits:[],version:0}},user)).status,200);
 const build=(purpose='budget')=>({action:purpose+'-build',build:{requestId:randomUUID(),text:'Synthetic groceries allowance $300.',consent:true,...(purpose==='budget'?{month:'2026-09'}:{})}});
 return {raw,call,setup,build,calls:()=>calls};
}

test('only an authenticated active owner budget request receives the temporary diagnostic; no receipt is stored',async t=>{
 for(const scenario of [
  {label:'owner',user:owner,allowed:true},
  {label:'other account',user:'google:other',allowed:false},
  {label:'no owner binding',user:owner,configuredOwner:'',allowed:false},
  {label:'expired owner',user:owner,expiry:now.toISOString(),allowed:false},
  {label:'temporary window ended',user:owner,at:new Date('2026-09-17T00:00:00.000Z'),allowed:false},
  {label:'routine purpose',user:owner,purpose:'routine',allowed:false}
 ]){
  const f=fixture(t,scenario);await f.setup(scenario.user);
  const body=f.build(scenario.purpose),response=await f.call(body,scenario.user),text=await response.text();
  assert.equal(response.status,422,scenario.label);assert.match(text,/\(schema\)/,scenario.label);
  assert.equal(text.includes('Owner diagnostic:'),scenario.allowed,scenario.label);
  assert.equal(text.includes(canary),scenario.allowed,scenario.label);
  assert.ok(!text.includes(exactKey),scenario.label);assert.ok(!text.includes(otherKey),scenario.label);
  const job=f.raw.prepare('SELECT * FROM life_routine_builds').get();
  assert.equal(job.status,'failed');assert.equal(job.error_code,'provider_request_rejected');assert.equal(job.cost_micros,0);assert.equal(job.result_json,null);assert.equal(job.provider_id,null);
  assert.ok(!JSON.stringify(job).includes(canary),scenario.label);
  assert.ok(!JSON.stringify(f.raw.prepare('SELECT * FROM life_ai_usage').all()).includes(canary),scenario.label);
  const listed=await f.call(null,scenario.user,scenario.purpose==='routine'?'?routine-builds':'?budget-builds');
  assert.ok(!(await listed.text()).includes(canary),scenario.label);
  const exported=await f.call(null,scenario.user,'?export');assert.ok(!(await exported.text()).includes(canary),scenario.label);
  const replay=await f.call(body,scenario.user);assert.equal(replay.status,200);assert.ok(!(await replay.text()).includes(canary));assert.equal(f.calls(),1);
 }
});

test('unauthenticated requests cannot obtain the provider diagnostic or dispatch an AI request',async t=>{
 const f=fixture(t);const response=await f.call(f.build(),null);
 assert.equal(response.status,401);assert.ok(!(await response.text()).includes(canary));assert.equal(f.calls(),0);
 assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM life_routine_builds').get().n,0);
});
