import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { handleLife } from '../lib/life/service.ts';
import { DraftSync } from '../lib/life/draft-sync.ts';
import {profileSchema} from '../lib/life/domain.ts';
import {profileSaveAcknowledged,reviewProfileChanges} from '../lib/life/profile-recovery.ts';
import {definiteClientRejection} from '../lib/life/write-retry.ts';
import {runInNewContext} from 'node:vm';
import {transpileModule,ModuleKind,JsxEmit} from 'typescript';
import * as jsx from 'react/jsx-runtime';
import {settingsForAI} from '../lib/life/ai-configuration.ts';
import {limitsForAI} from '../lib/life/ai-limits.ts';
import {budgetOutputSchema} from '../lib/life/budget-build-schema.ts';
import { geminiProvider,tokenCostMicros,AI_MODEL,MAX_OUTPUT_TOKENS,RESERVATION_MICROS,AIRequestRejected,rejectionCategory } from '../lib/life/ai-provider.ts';
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

test('later authentication rejections cannot settle an earlier unknown client write',()=>{
 for(const status of [undefined,500,503])for(const pending of [false,true])assert.equal(definiteClientRejection(status,pending),false);
 for(const status of [401,403]){assert.equal(definiteClientRejection(status,false),true);assert.equal(definiteClientRejection(status,true),false);}
 for(const status of [400,404,409,422,429])for(const pending of [false,true])assert.equal(definiteClientRejection(status,pending),true);
});

// Exercise real component button handlers with React hook and network adapters.
// The adapter only mounts effects and retains hook slots; no production service
// or provider is called, and no separate browser runtime is needed.
function retryComponent(file,seed){
 const slots=[],effects=[],writes=[];let cursor=0,statusConfig,tree,attempt=0;
 const react={
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
  useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},
  useEffect(fn,deps){const i=cursor++,previous=slots[i];if(!previous||deps.some((value,index)=>!Object.is(value,previous[index]))){slots[i]=deps;effects.push(fn);}},
  useContext(){return true;}
 };
 async function write(body){
  writes.push(structuredClone(body));const status=[503,401,403,200][attempt++];
  if(status!==200)throw Object.assign(Error('Synthetic lost acknowledgement or expired login'),{status});
  if(body.action==='resource')return {...body.record,version:1};
  if(body.action==='routine-build'||body.action==='training-analysis')return {build:{id:body.build.requestId,status:'complete',createdAt:now.toISOString(),result:null}};
  return {profile:profileSchema.parse({...profile,version:2})};
 }
 const adapters={react,'react/jsx-runtime':jsx,'@/lib/life/write-retry':{definiteClientRejection},'@/lib/life/domain':{todayIn:()=> '2026-09-16'},'@/lib/life/date-display':{formatDate:value=>value,formatTimestampDate:value=>value},'@/lib/life/exercise-presets':{repTarget:()=> '6–10'},'./shared':{
  request:async(path,body)=>body?write(body):{records:[]},saveRecord:(kind,record)=>write({action:'resource',kind,record}),useUnsaved(){},useWorkoutCancel:fn=>fn,WorkoutToolVisible:'visible'
 },'./use-ai-status':{useAIStatus:config=>{statusConfig=config;return {delayed:true,error:'',check:async()=>{},stop(){}};}}};
 const code=transpileModule(readFileSync('app/life/'+file+'.tsx','utf8'),{compilerOptions:{module:ModuleKind.CommonJS,jsx:JsxEmit.ReactJSX}}).outputText,output={};
 runInNewContext(code,{exports:output,crypto:{randomUUID},require:name=>adapters[name]||new Proxy({},{get:(_,key)=>String(key)})});
 const props={profile:profileSchema.parse({...profile,version:1}),date:'2026-09-16',cadence:'weekly',synced:true,onDirty(){},onReview(){},onBusy(){},onProfileSaved(){},onSettings(){}};
 function render(){cursor=0;tree=output.default(props);for(const effect of effects.splice(0))effect();return tree;}
 function text(node){if(typeof node==='string'||typeof node==='number')return String(node);return [node?.props?.children].flat(Infinity).map(child=>child&&typeof child==='object'?text(child):typeof child==='string'?child:'').join('');}
 function findNode(predicate,node){if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const child of [node.props?.children].flat(Infinity)){const found=findNode(predicate,child);if(found)return found;}return null;}
 const find=predicate=>findNode(predicate,tree);
 function button(label){const node=find(node=>!!node.props?.onClick&&(node.props['aria-label']===label||text(node)===label));assert.ok(node,'Missing '+label+' in '+file);return node;}
 render();if(statusConfig)statusConfig.onData(seed);render();
 return {writes,props,render,find,button,async click(label){const node=button(label);assert.ok(!node.props.disabled,label+' should be enabled');await node.props.onClick();await new Promise(resolve=>setImmediate(resolve));render();}};
}

test('cardio, routine, training, analysis and feedback handlers retain exact requests through expired-login retries',async t=>{
 const report={id:'saved-analysis',date:'2026-09-16',cadence:'weekly',from:'2026-09-14',revision:1,sourceVersion:1,status:'complete',text:'Synthetic analysis'};
 const training={id:'saved-training',status:'complete',createdAt:now.toISOString(),result:{text:'Synthetic training analysis'}};
 const cases=[
  {file:'cardio',seed:null,start:'Save',retry:'Retry cardio save',setup:async f=>f.click('Log cardio')},
  {file:'routine-builder',seed:{builds:[],available:true},start:'Build with AI',retry:'Retry this build',setup:async f=>{f.find(node=>node.type==='textarea').props.onChange({target:{value:'Synthetic push and pull routine'}});f.render();}},
  {file:'training-analysis',seed:{builds:[],available:true},start:'Analyze this week',retry:'Retry this analysis'},
  {file:'training-analysis',seed:{builds:[training],available:true},start:'Delete',retry:'Retry delete',setup:async f=>f.click('Past training analyses')},
  {file:'ai-review',seed:{reports:[report],available:true,regenerationsRemaining:3},start:'Regenerate',retry:'Retry this analysis'},
  {file:'ai-review',seed:{reports:[report],available:true,regenerationsRemaining:3},start:'Delete',retry:'Retry delete'},
  {file:'ai-review',seed:{reports:[report],available:true,regenerationsRemaining:3},start:'Save for future',retry:'Retry save',setup:async f=>{await f.click('Feedback');f.find(node=>node.type==='textarea').props.onChange({target:{value:'Synthetic guidance to preserve'}});f.render();}}
 ];
 for(const scenario of cases)await t.test(scenario.file+' '+scenario.start,async()=>{
  const f=retryComponent(scenario.file,scenario.seed);await scenario.setup?.(f);await f.click(scenario.start);
  assert.equal(f.writes.length,1);f.props.profile={...f.props.profile,version:99};f.render();
  await f.click(scenario.retry);await f.click(scenario.retry);await f.click(scenario.retry);
  assert.equal(f.writes.length,4);for(const write of f.writes)assert.deepEqual(write,f.writes[0]);
 });
});

test('budget instructs the full JSON shape while workout alone uses provider schema configuration',async()=>{
 const contract=JSON.parse(readFileSync('tests/fixtures/gemini-output-format.json','utf8'));
 assert.equal(contract.properties.responseMimeType.type,'string');assert.equal(contract.properties.responseJsonSchema.type,'any');
 let body;const provider=geminiProvider('synthetic',async(url,init)=>{body=JSON.parse(init.body);return Response.json({candidates:[{content:{parts:[{text:'{}'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:1,totalTokenCount:2}});});
 for(const purpose of ['budget','workout',undefined,'routine','training']){
  await provider.generate('{}',purpose);
  const config=body.generationConfig;assert.equal(config.responseFormat,undefined);assert.equal(config.responseSchema,undefined);
  if(purpose==='workout'){
   assert.equal(config.responseMimeType,'application/json');assert.ok(contract.properties.responseMimeType.supported.includes(config.responseMimeType));assert.equal(config.responseJsonSchema.type,'object');assert.ok(config.responseJsonSchema.properties);
  }else{assert.equal(config.responseMimeType,undefined);assert.equal(config.responseJsonSchema,undefined);}
  if(purpose==='budget')assert.ok(body.systemInstruction.parts[0].text.endsWith('Required JSON shape:\n'+JSON.stringify(budgetOutputSchema)));
 }
});

test('only explicit provider INVALID_ARGUMENT receipts settle rejected requests at zero cost',async()=>{
 for(const [status,body,known] of [[400,{error:{code:400,status:'INVALID_ARGUMENT',message:'Private echoed content'}},true],[500,{error:{code:500,status:'INTERNAL'}},false],[400,{error:{code:400,status:'OTHER'}},false],[400,{error:{code:400,status:'INVALID_ARGUMENT'},usageMetadata:{totalTokenCount:1}},false]]){
  const provider=geminiProvider('synthetic',async()=>Response.json(body,{status}));
  await assert.rejects(provider.generate('{}','budget'),e=>{assert.equal(e instanceof AIRequestRejected,known);assert.doesNotMatch(e.message,/Private echoed content/);return true;});
 }
 let calls=0;const f=fixture(geminiProvider('synthetic',async()=>{calls++;return Response.json({error:{code:400,status:'INVALID_ARGUMENT'}},{status:400});}));
 try{await f.setup();const request=review();assert.equal((await f.call(request)).status,422);assert.equal((await f.call(request)).status,200);assert.equal(calls,1);
  assert.deepEqual({...f.raw.prepare('SELECT status,cost_micros,input_tokens,output_tokens,error_code FROM life_ai_usage').get()},{status:'failed',cost_micros:0,input_tokens:0,output_tokens:0,error_code:'provider_request_rejected'});
 }finally{f.raw.close();}
});

test('provider rejection diagnostics expose only fixed categories without private descriptions or credentials',async()=>{
 const cases=[
  ['API key not valid: SyntheticCredentialValue','credentials'],
  ['JSON schema complexity exceeded: PrivateBudgetValue','schema'],
  ['Invalid response_format mime_type: PrivateBudgetValue','output-format'],
  ['Invalid thinking level: PrivateBudgetValue','thinking'],
  ['This model does not support the configuration: PrivateBudgetValue','model-configuration'],
  ['Unexpected field: PrivateBudgetValue','request-configuration'],
  [null,'request-configuration'],[{message:'SyntheticCredentialValue'},'request-configuration'],
 ];
 for(const [message,category] of cases){
  assert.equal(rejectionCategory(message),category);
  const provider=geminiProvider('SyntheticCredentialValue',async()=>Response.json({error:{code:400,status:'INVALID_ARGUMENT',message}},{status:400}));
  await assert.rejects(provider.generate('PrivateBudgetValue','budget'),error=>{
   assert.ok(error instanceof AIRequestRejected);assert.ok(error.message.includes(category));assert.doesNotMatch(error.message,/PrivateBudgetValue|SyntheticCredentialValue|Unexpected field|JSON schema complexity/);return true;
  });
 }
 assert.equal(rejectionCategory('x'.repeat(12000)+' api key SyntheticCredentialValue'),'request-configuration');
});

const ownerPrototype={userId:'google:synthetic-owner',expiresAt:'2026-10-14T23:59:59.000Z'};
function archivedUsage(f,id,n,{cost=100,at=now.toISOString(),error=null}={}){for(let i=0;i<n;i++)f.raw.prepare("INSERT INTO life_deleted_ai_usage(user_id,request_id,status,model,price_version,reserved_micros,cost_micros,created_at,error_code) VALUES(?,?,'failed','synthetic','synthetic',200000,?,?,?)").run(id,randomUUID(),cost,at,error);}
test('prototype limits require the exact server-configured identity and expire without changing global settings',()=>{
 const env={LIFEAPP_AUTH_MODE:'google',LIFEAPP_AI_OWNER_USER_ID:ownerPrototype.userId,LIFEAPP_AI_OWNER_LIMITS_UNTIL:ownerPrototype.expiresAt};
 const settings=settingsForAI(env);
 assert.deepEqual(limitsForAI(settings,ownerPrototype.userId,now),{userCapMicros:30000000,dailyAttempts:25,builderAttempts:20,regenerations:5});
 assert.equal(limitsForAI(settings,ownerPrototype.userId,new Date('2026-10-01T00:00:00Z')).userCapMicros,31000000);
 for(const id of ['google:other','synthetic-owner','owner@example.test'])assert.equal(limitsForAI(settings,id,now).dailyAttempts,5);
 for(const override of [{LIFEAPP_AUTH_MODE:'sites'},{LIFEAPP_AI_OWNER_USER_ID:''},{LIFEAPP_AI_OWNER_LIMITS_UNTIL:'invalid'}])assert.equal(limitsForAI(settingsForAI({...env,...override}),ownerPrototype.userId,now).dailyAttempts,5);
 assert.equal(limitsForAI(settings,ownerPrototype.userId,new Date(ownerPrototype.expiresAt)).dailyAttempts,5);
 assert.equal(settings.globalCapMicros,5000000);assert.equal(settings.userCapMicros,1000000);assert.equal(settings.enabled,false);
});
test('owner daily analysis admission includes archived attempts and keeps other accounts at five',async()=>{
 const f=fixture({generate:async(_input,purpose)=>({...result,text:purpose==='budget'?JSON.stringify({notes:'',categories:[],recurring:[]}):result.text})},{ownerPrototype});try{await f.setup(ownerPrototype.userId);await f.setup('google:other');
 archivedUsage(f,ownerPrototype.userId,24);archivedUsage(f,'google:other',5);
 assert.equal((await f.call(review(),'google:other')).status,429);
 assert.equal((await f.call(review(),ownerPrototype.userId)).status,200);
 const original=(await (await f.call(undefined,ownerPrototype.userId,'?ai=1&date=2026-09-08')).json()).reports[0];
 assert.equal((await f.call(review({predecessorId:original.id}),ownerPrototype.userId)).status,429);
 assert.equal(f.raw.prepare('SELECT count(*) n FROM life_ai_usage WHERE user_id=?').get(ownerPrototype.userId).n,25);
 }finally{f.raw.close();}
});
test('owner regeneration allowance is five and cannot bypass the cost breaker',async()=>{
 const f=fixture({generate:async(_input,purpose)=>({...result,text:purpose==='budget'?JSON.stringify({notes:'',categories:[],recurring:[]}):result.text})},{ownerPrototype});try{await f.setup(ownerPrototype.userId);
 let response=await (await f.call(review(),ownerPrototype.userId)).json();
 for(let i=0;i<5;i++){const r=await f.call(review({predecessorId:response.report.id}),ownerPrototype.userId);assert.equal(r.status,200);response=await r.json();}
 assert.equal((await f.call(review({predecessorId:response.report.id}),ownerPrototype.userId)).status,429);
 const status=await (await f.call(undefined,ownerPrototype.userId,'?ai=1&date=2026-09-08')).json();assert.equal(status.regenerationsRemaining,0);assert.equal(status.usage.capMicros,30000000);assert.equal(status.ownerPrototype,undefined);
 }finally{f.raw.close();}
 const g=fixture(undefined,{ownerPrototype});try{await g.setup(ownerPrototype.userId);
 archivedUsage(g,ownerPrototype.userId,1,{cost:1100000,at:'2026-09-01T00:00:00.000Z'});
 assert.equal((await g.call(review(),ownerPrototype.userId)).status,200);
 assert.equal((await g.call({action:'entry',entry:entry('2026-09-07')},ownerPrototype.userId)).status,200);
 archivedUsage(g,'google:retired',1,{error:'cost_bound_exceeded'});assert.equal((await g.call(review({date:'2026-09-07'}),ownerPrototype.userId)).status,429);
 }finally{g.raw.close();}
});

const budgetBuild=()=>({action:'budget-build',build:{requestId:randomUUID(),month:'2026-09',text:'Synthetic groceries allowance $300.',consent:true}});
test('owner can pass ten builds but stops at twenty while ordinary builders retain two',async()=>{
 const f=fixture({generate:async()=>({...result,text:JSON.stringify({notes:'',categories:[],recurring:[]})})},{ownerPrototype});try{
  for(const [id,count] of [[ownerPrototype.userId,20],['google:other',2]]){
   await f.setup(id);
   for(let i=0;i<count;i++)assert.equal((await f.call(budgetBuild(),id)).status,200);
   assert.equal((await f.call(budgetBuild(),id)).status,429);
   assert.equal(f.raw.prepare("SELECT count(*) n FROM life_ai_usage WHERE user_id=? AND request_id LIKE 'budget:%'").get(id).n,count);
  }
 }finally{f.raw.close();}
});
test('owner daily dollars include measured and archived unknown costs in analyses and budget builds',async()=>{
 for(const request of [review,budgetBuild]){
  const f=fixture({generate:async(_input,purpose)=>({...result,text:purpose==='budget'?JSON.stringify({notes:'',categories:[],recurring:[]}):result.text})},{ownerPrototype});try{await f.setup(ownerPrototype.userId);
   archivedUsage(f,ownerPrototype.userId,1,{cost:600000});archivedUsage(f,ownerPrototype.userId,1,{cost:null});
   const body=request();assert.equal((await f.call(body,ownerPrototype.userId)).status,200); // $0.80 + $0.20 exactly fits.
   assert.equal((await f.call(body,ownerPrototype.userId)).status,200); // Exact replay spends nothing.
   const next=request===review?review({date:'2026-09-07'}):budgetBuild();
   if(request===review)assert.equal((await f.call({action:'entry',entry:entry('2026-09-07')},ownerPrototype.userId)).status,200);
   assert.equal((await f.call(next,ownerPrototype.userId)).status,429); // $0.800225 + $0.20 does not.
   const held=f.raw.prepare('SELECT reserved_micros,cost_micros FROM life_deleted_ai_usage WHERE cost_micros IS NULL').get();
   assert.deepEqual({...held},{reserved_micros:200000,cost_micros:null});
   assert.equal((await f.call(next,ownerPrototype.userId,'',new Date('2026-09-10T00:00:00.000Z'))).status,200);
  }finally{f.raw.close();}
 }
});
test('simultaneous owner analysis and budget reservations cannot cross the daily ceiling',async()=>{
 const pending=deferred();let calls=0;const f=fixture({generate:async()=>{calls++;return pending.promise;}},{ownerPrototype});try{await f.setup(ownerPrototype.userId);
  archivedUsage(f,ownerPrototype.userId,1,{cost:800000});
  const tasks=[f.call(review(),ownerPrototype.userId),f.call(budgetBuild(),ownerPrototype.userId)];
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
  pending.reject(Error('Synthetic unknown outcome'));const responses=await Promise.all(tasks);assert.deepEqual(responses.map(r=>r.status).sort(),[429,502]);
  assert.equal(f.raw.prepare('SELECT SUM(COALESCE(cost_micros,reserved_micros)) AS total FROM life_ai_usage').get().total,1000000);
 }finally{f.raw.close();}
});
test('active owner pool preserves ordinary caps and has a bounded aggregate; expiry counts everyone again',async()=>{
 const owner=ownerPrototype.userId,other='google:other';
 for(const request of [review,budgetBuild]){
  const f=fixture({generate:async(_input,purpose)=>({...result,text:purpose==='budget'?JSON.stringify({notes:'',categories:[],recurring:[]}):result.text})},{ownerPrototype});try{await f.setup(owner);await f.setup(other);
   archivedUsage(f,owner,1,{cost:6000000,at:'2026-09-01T00:00:00.000Z'});
   assert.equal((await f.call(request(),other)).status,200); // Owner usage does not exhaust the ordinary pool.
   archivedUsage(f,other,1,{cost:800000});
   const extra=request===review?review({date:'2026-09-07'}):budgetBuild();
   if(request===review)await f.call({action:'entry',entry:entry('2026-09-07')},other);
   assert.equal((await f.call(extra,other)).status,429); // Ordinary personal $1 remains.
   f.settings.ownerPrototype={...ownerPrototype,expiresAt:now.toISOString()};
   assert.equal((await f.call(request(),owner)).status,429); // Owner falls back to personal $1.
   await f.setup('google:new');assert.equal((await f.call(request(),'google:new')).status,429); // Shared $5 includes all owner rows again.
  }finally{f.raw.close();}
  const g=fixture({generate:async(_input,purpose)=>({...result,text:purpose==='budget'?JSON.stringify({notes:'',categories:[],recurring:[]}):result.text})},{ownerPrototype});try{await g.setup(owner);await g.setup(other);
   archivedUsage(g,'google:retired',1,{cost:4800001,at:'2026-09-01T00:00:00.000Z'});
   assert.equal((await g.call(request(),other)).status,429); // Ordinary shared $5 is independent of owner headroom.
   assert.equal((await g.call(request(),owner)).status,200);
   archivedUsage(g,'google:retired',1,{cost:30000000,at:'2026-09-01T00:00:00.000Z'});
   const next=request===review?review({date:'2026-09-07'}):budgetBuild();
   if(request===review)await g.call({action:'entry',entry:entry('2026-09-07')},owner);
   assert.equal((await g.call(next,owner)).status,429); // $35 aggregate, including retired usage.
  }finally{g.raw.close();}
 }
});
test('owner month headroom remains bounded even with prior-day accounting',async()=>{
 for(const request of [review,budgetBuild]){
  const f=fixture({generate:async(_input,purpose)=>({...result,text:purpose==='budget'?JSON.stringify({notes:'',categories:[],recurring:[]}):result.text})},{ownerPrototype});try{await f.setup(ownerPrototype.userId);
   archivedUsage(f,ownerPrototype.userId,1,{cost:29800001,at:'2026-09-01T00:00:00.000Z'});
   assert.equal((await f.call(request(),ownerPrototype.userId)).status,429);
  }finally{f.raw.close();}
 }
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

test('definite response conflicts keep local text and need an explicit review before a new save',async()=>{
 const calls=[],initial={...entry(),habits:[],version:1,complete:false};let conflict=true;
 const writer=new DraftSync(initial,async(snapshot,id)=>{calls.push({snapshot,id});if(conflict)throw Object.assign(Error('Changed elsewhere'),{status:409});return {...snapshot,version:snapshot.version+1};},()=>{});
 writer.edit({...initial,journal:'My unsaved journal'});await assert.rejects(writer.commit(true));
 assert.equal(writer.status,'conflict');assert.equal(writer.entry.journal,'My unsaved journal');
 await assert.rejects(writer.commit(true));assert.equal(calls.length,1);
 const saved={...initial,version:2,journal:'Other device journal'};
 writer.resolveConflict(saved,true);assert.equal(calls.length,1);assert.equal(writer.status,'waiting');assert.equal(writer.entry.version,2);assert.equal(writer.entry.journal,'My unsaved journal');
 conflict=false;await writer.commit(true);assert.equal(writer.status,'saved');assert.equal(calls[1].snapshot.version,2);assert.notEqual(calls[0].id,calls[1].id);
});

test('response conflict review preserves new saved habits, matches local choices by ID and cannot overwrite Trash',async()=>{
 const one={id:randomUUID(),title:'Read',module:'reflection',status:'done'},two={id:randomUUID(),title:'Walk',module:'fitness',status:'missed'};
 const initial={...entry(),habits:[one],version:1,complete:false};
 const writer=new DraftSync(initial,async()=>{throw Object.assign(Error('Conflict'),{status:409});},()=>{});
 writer.edit({...initial,journal:'Keep me'});await assert.rejects(writer.flush());
 const latest={...initial,version:2,habits:[{...one,title:'Updated read',status:'missed'},two]};writer.resolveConflict(latest,true);
 assert.deepEqual(writer.entry.habits,[{...one,title:'Updated read'},two]);
 await assert.rejects(writer.flush());assert.throws(()=>writer.resolveConflict({...latest,deleted:true},true),/Restore/);assert.equal(writer.entry.journal,'Keep me');
 writer.resolveConflict({...latest,deleted:true},false);assert.equal(writer.status,'saved');assert.equal(writer.entry.deleted,true);
});

test('a rejected response can be corrected while server failures keep exact pending input',async()=>{
 const sent=[],initial={...entry(),habits:[],complete:false};let code=400;
 const writer=new DraftSync(initial,async(snapshot,id)=>{sent.push({snapshot,id});if(code)throw Object.assign(Error('Rejected'),{status:code});return {...snapshot,version:1};},()=>{});
 writer.edit({...initial,journal:'Invalid'});await assert.rejects(writer.flush());assert.equal(writer.status,'rejected');
 writer.edit({...writer.entry,journal:'Corrected'});code=503;await assert.rejects(writer.flush());assert.notEqual(sent[0].id,sent[1].id);assert.equal(writer.status,'error');
 code=0;await writer.flush();assert.deepEqual(sent[1],sent[2]);assert.equal(writer.entry.journal,'Corrected');
});

test('authentication rejection on an unknown response retry cannot release the original mutation',async()=>{
 const sent=[],initial={...entry(),habits:[],complete:false};let attempt=0;
 const writer=new DraftSync(initial,async(snapshot,id)=>{sent.push({snapshot,id});attempt++;if(attempt<3)throw Object.assign(Error('Unconfirmed'),{status:attempt===1?503:401});return {...snapshot,version:1};},()=>{});
 writer.edit({...initial,journal:'Save exactly once'});await assert.rejects(writer.flush());await assert.rejects(writer.flush());assert.equal(writer.status,'error');
 await writer.flush();assert.deepEqual(sent[0],sent[1]);assert.deepEqual(sent[1],sent[2]);
});

test('lost settings acknowledgement is recognized only by newer exact normalized values',()=>{
 const submitted=profileSchema.parse({...profile,goal:'  My goal  ',version:3});
 assert.equal(profileSaveAcknowledged(submitted,{...submitted,goal:'My goal',version:4}),true);
 assert.equal(profileSaveAcknowledged(submitted,{...submitted,version:3}),false);
 assert.equal(profileSaveAcknowledged(submitted,{...submitted,goal:'Changed elsewhere',version:4}),false);
 assert.equal(profileSaveAcknowledged(submitted,null),false);
 const reordered=Object.fromEntries(Object.entries(submitted).reverse());assert.equal(profileSaveAcknowledged(submitted,{...reordered,version:4}),true);
});

test('explicit settings conflict review keeps edited sections and preserves unrelated remote settings and new habits',()=>{
 const habit={id:randomUUID(),title:'Read',module:'reflection',archived:false},newHabit={id:randomUUID(),title:'Walk',module:'fitness',archived:false};
 const base=profileSchema.parse({...profile,habits:[habit],version:1});
 const local={...base,goal:'My goal',habits:[{...habit,title:'Read 20 minutes'}]};
 const saved={...base,goal:'Other goal',timezone:'America/New_York',habits:[habit,newHabit],version:2};
 const review=reviewProfileChanges(base,local,saved);
 assert.equal(review.draft.version,2);assert.equal(review.draft.goal,'My goal');assert.equal(review.draft.timezone,'America/New_York');assert.deepEqual(review.draft.habits,[{...habit,title:'Read 20 minutes'},newHabit]);
 assert.deepEqual(review.conflicts,['main goal','habits']);assert.equal(local.version,1);assert.equal(saved.goal,'Other goal');
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
