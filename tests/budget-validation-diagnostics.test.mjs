import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {handleLife} from '../lib/life/service.ts';
import {settingsForAI} from '../lib/life/ai-configuration.ts';
import {AI_MODEL} from '../lib/life/ai-provider.ts';

const now=new Date('2026-09-18T12:00:00.000Z'),owner='google:synthetic-owner';
const canary='PRIVATE_PROVIDER_OUTPUT_CANARY';
const badDraft={notes:canary,categories:[{name:'Bills',limitCents:canary,[canary]:canary}],recurring:[],[canary]:canary};
const result={text:JSON.stringify(badDraft),inputTokens:123,outputTokens:234,thoughtTokens:45,costMicros:1234,providerId:'synthetic-receipt',modelVersion:AI_MODEL,finishReason:'STOP'};
function fixture(t,{configuredOwner=owner,expiry='2026-10-14T23:59:59.000Z',at=now}={}){
 const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+file,'utf8'));
 const db={prepare(sql){return {bind(...params){return {async first(){return raw.prepare(sql).get(...params)||null;},async all(){return {results:raw.prepare(sql).all(...params)};}};}};}};
 const state={calls:0,result,hook:null};
 const settings={...settingsForAI({LIFEAPP_AUTH_MODE:'google',LIFEAPP_AI_ENABLED:'true',LIFEAPP_AI_PAID_PROJECT:'true',LIFEAPP_AI_OWNER_USER_ID:configuredOwner,LIFEAPP_AI_OWNER_LIMITS_UNTIL:expiry}),provider:{async generate(){state.calls++;if(state.hook)await state.hook();return state.result;}}};
 const call=(body,user=owner,query='')=>handleLife(new Request('https://life.test/api/life'+query,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:'https://life.test'},body:body?JSON.stringify(body):undefined}),user,db,at,settings);
 const setup=async(user=owner)=>assert.equal((await call({action:'profile',profile:{goal:'Synthetic goal',timezone:'UTC',modules:['money'],habits:[],version:0}},user)).status,200);
 const build=(purpose='budget')=>({action:purpose+'-build',build:{requestId:randomUUID(),text:'Synthetic groceries allowance $300.',consent:true,...(purpose==='budget'?{month:'2026-09'}:{})}});
 return {raw,call,setup,build,state};
}

test('budget validation diagnostics contain fixed schema paths and codes, never unknown keys, values or messages',async t=>{
 const f=fixture(t);await f.setup();const body=f.build(),response=await f.call(body),data=await response.json();
 assert.equal(response.status,422);assert.match(data.error,/categories\.0\.limitCents \(invalid_type\)/);
 assert.match(data.error,/categories\.0 \(unrecognized_keys\)/);assert.match(data.error,/draft \(unrecognized_keys\)/);
 assert.ok(!data.error.includes(canary));assert.doesNotMatch(data.error,/Expected number|Unrecognized key|received string/);
 const row=f.raw.prepare('SELECT * FROM life_routine_builds').get();assert.equal(row.status,'failed');assert.equal(row.error_code,'invalid_budget_output');assert.equal(row.result_json,null);
 assert.equal(row.cost_micros,1234);assert.equal(row.input_tokens,123);assert.equal(row.output_tokens,234);assert.equal(row.thought_tokens,45);
 assert.ok(!JSON.stringify(row).includes(canary));assert.ok(!JSON.stringify(row).includes('invalid_type'));
 const ledger=f.raw.prepare('SELECT * FROM life_ai_usage').all();assert.equal(ledger.length,1);assert.equal(ledger[0].cost_micros,1234);
 for(const query of ['?budget-builds','?export']){const text=await (await f.call(null,owner,query)).text();assert.ok(!text.includes(canary));assert.ok(!text.includes('failed validation'));}
 const replay=await f.call(body);assert.equal(replay.status,200);assert.ok(!(await replay.text()).includes('failed validation'));assert.equal(f.state.calls,1);
});

test('owner field diagnostics are limited to eight issues and syntax/reference failures use fixed categories',async t=>{
 for(const item of [
  {text:JSON.stringify({notes:canary,categories:Array.from({length:12},(_,i)=>({name:'Category '+i,limitCents:canary})),recurring:[]}),issues:8},
  {text:'{'+canary,match:/failed validation: JSON format\./},
  {text:JSON.stringify({notes:canary,categories:[{name:canary,limitCents:100},{name:canary,limitCents:200}],recurring:[]}),match:/failed validation: category references\./}
 ]){
  const f=fixture(t);await f.setup();f.state.result={...result,text:item.text};
  const response=await f.call(f.build()),data=await response.json();assert.equal(response.status,422);assert.ok(!data.error.includes(canary));
  if(item.issues){assert.equal((data.error.match(/\(invalid_type\)/g)||[]).length,item.issues);assert.ok(!data.error.includes('categories.8'));}
  else assert.match(data.error,item.match);
 }
});

test('field diagnostics are owner-only; other accounts, missing/expired config and other purposes retain failed-build behavior',async t=>{
 for(const scenario of [
  {user:'google:other'},
  {user:owner,configuredOwner:''},
  {user:owner,expiry:now.toISOString()},
  {user:owner,expiry:'invalid'},
  {user:owner,purpose:'routine'}
 ]){
  const f=fixture(t,scenario);await f.setup(scenario.user);
  const response=await f.call(f.build(scenario.purpose),scenario.user),data=await response.json();assert.equal(response.status,200);
  assert.equal(data.build.status,'failed');assert.equal(data.build.result,null);assert.equal(data.error,undefined);
  assert.ok(!JSON.stringify(data).includes(canary));assert.ok(!JSON.stringify(data).includes('invalid_type'));assert.equal(f.state.calls,1);
 }
});

test('successful or truncated budget outputs do not return field diagnostics',async t=>{
 for(const item of [
  {...result,text:JSON.stringify({notes:'Check synthetic amounts.',categories:[],recurring:[]})},
  {...result,finishReason:'MAX_TOKENS'}
 ]){
  const f=fixture(t);await f.setup();f.state.result=item;const response=await f.call(f.build()),data=await response.json();
  assert.equal(response.status,200);assert.equal(data.error,undefined);assert.equal(data.build.status,item.finishReason==='STOP'?'complete':'failed');assert.ok(!JSON.stringify(data).includes(canary));
 }
});

test('signed-out/deleted accounts and purged/hidden builds never expose private generated values through diagnostics',async t=>{
 const unauthenticated=fixture(t);assert.equal((await unauthenticated.call(unauthenticated.build(),null)).status,401);assert.equal(unauthenticated.state.calls,0);
 for(const action of ['account','purge','trash']){
  const f=fixture(t);await f.setup();const body=f.build();
  f.state.hook=async()=>{
   if(action==='account')f.raw.prepare('INSERT INTO life_account_deletions VALUES(?,?)').run(owner,now.toISOString());
   else if(action==='purge')f.raw.prepare('UPDATE life_routine_builds SET input_snapshot=?').run(JSON.stringify({purged:true}));
   else assert.equal((await f.call({action:'record-deletion',change:{kind:'build',id:'budget:'+body.build.requestId,deleted:true}})).status,200);
  };
  const response=await f.call(body),text=await response.text();assert.ok(!text.includes(canary));
  assert.equal(response.status,action==='account'?410:422);
  const ledger=f.raw.prepare('SELECT * FROM life_ai_usage').all();assert.equal(ledger.length,1);assert.equal(ledger[0].cost_micros,1234);assert.ok(!JSON.stringify(ledger).includes(canary));
  const rows=f.raw.prepare('SELECT * FROM life_routine_builds').all();assert.ok(!JSON.stringify(rows).includes(canary));
 }
});
