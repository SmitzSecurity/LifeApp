import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {handleLife} from '../lib/life/service.ts';
import {settingsForAI} from '../lib/life/ai-configuration.ts';
import {AI_MODEL} from '../lib/life/ai-provider.ts';

const now=new Date('2026-09-16T20:00:00.000Z'),owner='google:synthetic-owner';
const canary='UNSAVED_PROVIDER_FORMAT_CANARY';
const text=canary+'x'.repeat(6500)+'BEYOND_DIAGNOSTIC_BOUNDARY';
const result={text,inputTokens:123,outputTokens:234,thoughtTokens:45,costMicros:1234,providerId:'synthetic-receipt',modelVersion:AI_MODEL,finishReason:'STOP'};
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

test('temporary format output is bounded and restricted to active authenticated owner budget requests',async t=>{
 for(const scenario of [
  {label:'owner',user:owner,allowed:true},
  {label:'other account',user:'google:other',allowed:false},
  {label:'missing owner config',user:owner,configuredOwner:'',allowed:false},
  {label:'owner expiry',user:owner,expiry:now.toISOString(),allowed:false},
  {label:'diagnostic cutoff',user:owner,at:new Date('2026-09-17T00:00:00.000Z'),allowed:false},
  {label:'routine purpose',user:owner,purpose:'routine',allowed:false}
 ]){
  const f=fixture(t,scenario);await f.setup(scenario.user);const body=f.build(scenario.purpose);
  const response=await f.call(body,scenario.user),data=await response.json();
  assert.equal(response.status,scenario.allowed?422:200,scenario.label);
  assert.equal(JSON.stringify(data).includes(canary),scenario.allowed,scenario.label);
  if(scenario.allowed)assert.equal(data.error,'Owner format diagnostic: '+text.slice(0,6000));
  else {assert.equal(data.build.status,'failed');assert.equal(data.build.result,null);}
  assert.ok(!JSON.stringify(data).includes('BEYOND_DIAGNOSTIC_BOUNDARY'));
  const row=f.raw.prepare('SELECT * FROM life_routine_builds').get();
  assert.equal(row.status,'failed');assert.equal(row.result_json,null);
  assert.equal(row.error_code,scenario.purpose==='routine'?'invalid_routine_output':'invalid_budget_output');
  assert.equal(row.cost_micros,1234);assert.equal(row.input_tokens,123);assert.equal(row.output_tokens,234);assert.equal(row.thought_tokens,45);
  assert.ok(!JSON.stringify(row).includes(canary));
  assert.ok(!JSON.stringify(f.raw.prepare('SELECT * FROM life_ai_usage').all()).includes(canary));
  assert.ok(!(await (await f.call(null,scenario.user,'?export')).text()).includes(canary));
  assert.ok(!(await (await f.call(null,scenario.user,scenario.purpose==='routine'?'?routine-builds':'?budget-builds')).text()).includes(canary));
  const replay=await f.call(body,scenario.user);assert.equal(replay.status,200);assert.ok(!(await replay.text()).includes(canary));assert.equal(f.state.calls,1);
 }
});

test('successful budget drafts retain the normal reviewed-draft response rather than a diagnostic',async t=>{
 const f=fixture(t);await f.setup();f.state.result={...result,text:JSON.stringify({notes:'Check synthetic amounts.',categories:[],recurring:[]})};
 const response=await f.call(f.build()),data=await response.json();assert.equal(response.status,200);
 assert.equal(data.build.status,'complete');assert.equal(data.error,undefined);assert.equal(f.state.calls,1);
});

test('signed-out and deleted accounts cannot receive format output; deletion retains measured accounting only',async t=>{
 const f=fixture(t);assert.equal((await f.call(f.build(),null)).status,401);assert.equal(f.state.calls,0);
 await f.setup();f.state.hook=()=>f.raw.prepare('INSERT INTO life_account_deletions VALUES(?,?)').run(owner,now.toISOString());
 const response=await f.call(f.build());assert.equal(response.status,410);assert.ok(!(await response.text()).includes(canary));
 assert.equal(f.raw.prepare('SELECT COUNT(*) AS n FROM life_routine_builds').get().n,0);
 const archived=f.raw.prepare('SELECT * FROM life_deleted_ai_usage').get();assert.equal(archived.status,'failed');assert.equal(archived.cost_micros,1234);assert.equal(archived.input_tokens,123);assert.equal(archived.output_tokens,234);
 assert.ok(!JSON.stringify(archived).includes(canary));
});

test('purging a build while generation is running never returns its private format diagnostic',async t=>{
 const f=fixture(t);await f.setup();
 f.state.hook=()=>f.raw.prepare('UPDATE life_routine_builds SET input_snapshot=?').run(JSON.stringify({purged:true}));
 const response=await f.call(f.build());assert.equal(response.status,200);assert.ok(!(await response.text()).includes(canary));
 const row=f.raw.prepare('SELECT * FROM life_routine_builds').get();assert.equal(row.result_json,null);assert.equal(row.provider_id,null);assert.equal(row.cost_micros,1234);
 assert.ok(!JSON.stringify(row).includes(canary));
});

test('moving a running build into Trash suppresses its temporary format diagnostic',async t=>{
 const f=fixture(t);await f.setup();const body=f.build();
 f.state.hook=async()=>assert.equal((await f.call({action:'record-deletion',change:{kind:'build',id:'budget:'+body.build.requestId,deleted:true}})).status,200);
 const response=await f.call(body);assert.equal(response.status,200);assert.ok(!(await response.text()).includes(canary));
 const listed=await (await f.call(null,owner,'?budget-builds')).json();assert.equal(listed.builds[0].deleted,true);assert.equal(listed.builds[0].status,'failed');assert.equal(listed.builds[0].result,null);
 assert.ok(!JSON.stringify(listed).includes(canary));assert.equal(f.raw.prepare('SELECT cost_micros FROM life_ai_usage').get().cost_micros,1234);
});
