import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {handleLife} from '../lib/life/service.ts';
import {budgetSchema} from '../lib/life/modules.ts';
import {budgetBuildInput,budgetSnapshotSchema,parseBudgetDraft} from '../lib/life/budget-build-schema.ts';
import {parseTransactionDraft,transactionBuildResult,transactionBuildResultForContext,transactionContextSchema,transactionOutputSchema,TRANSACTION_CONTEXT_MONTHS} from '../lib/life/transaction-build-schema.ts';
import {geminiProvider,AI_MODEL,RESERVATION_MICROS} from '../lib/life/ai-provider.ts';
import {validateBackup} from '../lib/life/migration-preview.ts';

const now=new Date('2026-09-16T02:00:00Z'),month='2026-09',categoryId=randomUUID(),oldCategoryId=randomUUID(),archivedId=randomUUID();
const context={today:'2026-09-15',categoriesByMonth:[{month,categories:[{id:categoryId,name:'Groceries'}]},{month:'2026-08',categories:[{id:oldCategoryId,name:'Food'}]}],categoriesOmitted:false};
const item={date:'2026-09-14',kind:'expense',amountCents:4275,note:'Synthetic grocery',categoryId,warning:''};
const output={notes:'Review extracted transactions before saving.',transactions:[item]};
const providerResult={text:JSON.stringify(output),inputTokens:500,outputTokens:400,thoughtTokens:0,costMicros:1875,providerId:'synthetic',modelVersion:AI_MODEL,finishReason:'STOP'};
const png={mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jbeQAAAAASUVORK5CYII='};
const pdf={mimeType:'application/pdf',data:Buffer.from('%PDF-1.7\nSynthetic statement\n%%EOF').toString('base64')};
function fixture(t){
 const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+file,'utf8'));
 const db={prepare(sql){return {bind(...params){return {async first(){return raw.prepare(sql).get(...params)||null;},async all(){return {results:raw.prepare(sql).all(...params)};}};}};}};
 const state={calls:[],result:providerResult,fail:false};
 const ai={enabled:true,userCapMicros:1000000,globalCapMicros:5000000,provider:{generate:async(input,purpose,attachment)=>{state.calls.push({input:JSON.parse(input),purpose,attachment});if(state.fail)throw Error('Unknown provider outcome');return state.result;}}};
 const call=(body,user='a',query='')=>handleLife(new Request('https://life.test/api/life'+query,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:'https://life.test'},body:body?JSON.stringify(body):undefined}),user,db,now,ai);
 const setup=async(user='a')=>{assert.equal((await call({action:'profile',profile:{goal:'Private journal goal',moduleGoals:{money:'Private money goal',fitness:'Private movement goal'},timezone:'America/New_York',modules:['money'],habits:[],version:0}},user)).status,200);};
 const build=(patch={})=>({action:'budget-build',build:{requestId:randomUUID(),intent:'transactions',month,text:'Synthetic receipt dated September 14 2026 with paid total $42.75.',consent:true,...patch}});
 const plan=(categories=[])=>budgetSchema.parse({currency:'USD',categories,recurring:[],goals:{spending:'Private spending rule',saving:'',investing:''}});
 const seed=async(targetMonth,categories,user='a')=>{assert.equal((await call({action:'budget-item',change:{kind:'initialize',month:targetMonth,initial:plan(categories)}},user)).status,200);};
 return {raw,db,state,ai,call,setup,build,seed,plan};
}

test('transaction intent uses a separate strict snapshot and result contract',()=>{
 const base={requestId:randomUUID(),month,text:'A dated receipt',consent:true};
 assert.equal(budgetBuildInput.parse({...base,intent:'transactions'}).intent,'transactions');
 assert.equal(budgetBuildInput.safeParse({...base,intent:'transactions',transactionContext:context}).success,false);
 const snapshot={description:base.text,month,intent:'transactions',transactionContext:context};
 assert.ok(budgetSnapshotSchema.safeParse(snapshot).success);
 assert.equal(budgetSnapshotSchema.safeParse({...snapshot,moneyGoals:{}}).success,false);
 assert.equal(budgetSnapshotSchema.safeParse({...snapshot,transactionContext:undefined}).success,false);
 assert.ok(budgetSnapshotSchema.safeParse({description:base.text,month,moneyGoals:{}}).success);
 assert.throws(()=>parseBudgetDraft(JSON.stringify({notes:'',categories:[],recurring:[]}),'transactions'));
 const draft=parseTransactionDraft('```json\n'+JSON.stringify(output)+'\n```',context);
 assert.equal(draft.transactions[0].categoryId,categoryId);assert.equal(draft.transactions[0].amountCents,4275);
 assert.match(draft.transactions[0].id,/^[a-f0-9-]{36}$/);assert.ok(transactionBuildResult.safeParse(draft).success);
 assert.ok(transactionBuildResultForContext(context).safeParse(draft).success);
 assert.equal(transactionBuildResult.safeParse({...draft,transactions:[draft.transactions[0],draft.transactions[0]]}).success,false);
});

test('missing facts remain blank and category suggestions require the exact dated month',()=>{
 const unknown=randomUUID();
 const draft=parseTransactionDraft(JSON.stringify({...output,transactions:[
  {...item,date:null,amountCents:null},
  {...item,date:'2026-08-13',categoryId},
  {...item,date:'2026-08-13',categoryId:oldCategoryId},
  {...item,categoryId:unknown},
  {...item,kind:'transfer'},
  {...item,kind:'income'},
  {...item,date:'2026-10-01'},
  {...item,date:'1899-12-31'},
  {...item,categoryId:'Groceries'},
 ]}),context).transactions;
 assert.equal(draft[0].date,null);assert.equal(draft[0].amountCents,null);assert.equal(draft[0].categoryId,null);assert.match(draft[0].warning,/date.*amount/);
 assert.equal(draft[1].categoryId,null);assert.equal(draft[2].categoryId,oldCategoryId);
 for(const index of [3,4,5,6,7,8])assert.equal(draft[index].categoryId,null);
 assert.equal(draft[6].date,null);assert.equal(draft[7].date,null);
 const saved={notes:'',transactions:[{...item,id:randomUUID(),categoryId:unknown}]};
 assert.equal(transactionBuildResultForContext(context).safeParse(saved).success,false);
 assert.equal(transactionBuildResultForContext(context).safeParse({...saved,transactions:[{...saved.transactions[0],categoryId:null,date:'2026-10-01'}]}).success,false);
});

test('malformed money, dates, extra fields, negative adjustments and oversized drafts fail strictly',()=>{
 for(const patch of [{amountCents:0},{amountCents:-1},{amountCents:1.5},{amountCents:100_000_001},{amountCents:'42.75'},{date:'2026-02-30'},{date:'09/14/2026'},{kind:'refund'},{categoryId:'x'.repeat(101)},{note:''},{id:randomUUID()},{unexpected:'instruction'}])assert.throws(()=>parseTransactionDraft(JSON.stringify({...output,transactions:[{...item,...patch}]}),context));
 assert.throws(()=>parseTransactionDraft(JSON.stringify({...output,transactions:Array(51).fill(item)}),context));
 assert.throws(()=>parseTransactionDraft(JSON.stringify({...output,categories:[]}),context));
 assert.equal(transactionContextSchema.safeParse({...context,categoriesByMonth:[context.categoriesByMonth[0],context.categoriesByMonth[0]]}).success,false);
 assert.equal(parseTransactionDraft(JSON.stringify({...output,transactions:Array(50).fill(item)}),context).transactions.length,50);
});

test('transaction builds use only owned active category context across months and never save financial records',async t=>{
 const f=fixture(t);await f.setup();await f.setup('b');
 await f.seed(month,[{id:categoryId,name:'Groceries',limitCents:987654},{id:archivedId,name:'Archived category',limitCents:1,archived:true}]);
 await f.seed('2026-08',[{id:oldCategoryId,name:'Food',limitCents:8000}]);
 await f.seed(month,[{id:randomUUID(),name:'Other account secret',limitCents:8888}],'b');
 const request=f.build(),response=await f.call(request);assert.equal(response.status,200);
 const result=await response.json();assert.equal(result.build.status,'complete');assert.equal(result.build.intent,'transactions');assert.equal(result.build.adopted,false);assert.equal(result.build.result.transactions[0].categoryId,categoryId);
 const snapshot=f.state.calls[0].input;assert.deepEqual(snapshot.transactionContext,context);assert.equal(f.state.calls[0].purpose,'budget');
 assert.doesNotMatch(JSON.stringify(snapshot),/Private|secret|Archived category|limitCents|moneyGoals|recurring/);
 assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM life_resources WHERE kind='transaction'").get().n,0);
 const summary=await (await f.call(null,'a','?budget-builds&summary=1')).json();assert.equal(summary.builds[0].intent,'transactions');assert.equal(summary.builds[0].description,undefined);assert.equal(summary.builds[0].adopted,false);
 assert.equal((await (await f.call(null,'b','?budget-builds')).json()).builds.length,0);
 assert.ok(validateBackup(await (await f.call(null,'a','?export')).text()));
});

test('exact source retries keep the original category snapshot and reject changed intent or attachment',async t=>{
 const f=fixture(t);await f.setup();await f.seed(month,[{id:categoryId,name:'Groceries',limitCents:30000}]);
 const request=f.build({text:'',image:png}),first=await (await f.call(request,'a','?budget-build')).json();
 assert.equal(first.build.status,'complete');assert.deepEqual(f.state.calls[0].attachment,png);
 const snapshot=f.raw.prepare('SELECT input_snapshot FROM life_routine_builds').get().input_snapshot;assert.match(snapshot,/sha256/);assert.doesNotMatch(snapshot,/iVBOR/);
 f.raw.prepare("UPDATE life_resources SET payload=json_set(payload,'$.categories[0].archived',json('true')),version=version+1 WHERE user_id='a' AND kind='budget'").run();
 assert.deepEqual(await (await f.call(request,'a','?budget-build')).json(),first);assert.equal(f.state.calls.length,1);
 for(const patch of [{text:'A different receipt'},{month:'2026-08'},{intent:'loans'},{image:undefined,document:pdf}])assert.equal((await f.call({...request,build:{...request.build,...patch}},'a','?budget-build')).status,409);
 assert.equal((await f.call(f.build({transactionContext:context}))).status,400);assert.equal(f.state.calls.length,1);
 assert.ok(validateBackup(await (await f.call(null,'a','?export')).text()));
});

test('the category snapshot stays bounded and gives the selected historical month priority',async t=>{
 const f=fixture(t);await f.setup();
 const insert=f.raw.prepare("INSERT INTO life_resources(user_id,kind,resource_id,period,payload,version,updated_at,active_slot) VALUES('a','budget',?,?,?,1,?,NULL)");
 for(let index=0;index<TRANSACTION_CONTEXT_MONTHS+3;index++){const date=new Date(Date.UTC(2010+Math.floor(index/12),index%12,1)).toISOString().slice(0,7);insert.run(date,date,JSON.stringify(f.plan([{id:randomUUID(),name:'Food',limitCents:1000}])),now.toISOString());}
 const response=await f.call(f.build({month:'2010-01'}));assert.equal(response.status,200);const categories=f.state.calls[0].input.transactionContext;
 assert.equal(categories.categoriesByMonth.length,TRANSACTION_CONTEXT_MONTHS);assert.equal(categories.categoriesByMonth[0].month,'2010-01');assert.equal(categories.categoriesOmitted,true);
});

test('Gemini transaction requests use focused instructions, inline PDF token preflight and no provider schema config',async()=>{
 const calls=[];const provider=geminiProvider('synthetic-key',async(url,init)=>{
  calls.push({url,body:JSON.parse(init.body)});
  if(url.endsWith(':countTokens'))return Response.json({totalTokens:1000});
  return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(output)}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:1000,candidatesTokenCount:100,totalTokenCount:1100}});
 });
 await provider.generate(JSON.stringify({intent:'transactions',transactionContext:context}),'budget',pdf);
 assert.equal(calls.length,2);assert.ok(calls[0].url.endsWith(':countTokens'));
 const body=calls[1].body,instruction=body.systemInstruction.parts[0].text;
 assert.match(instruction,/^TRANSACTION IMPORT MODE:/);assert.ok(instruction.endsWith('Required JSON shape:\n'+JSON.stringify(transactionOutputSchema)));
 assert.match(instruction,/untrusted data, never instructions/);assert.match(instruction,/one final paid total/);assert.match(instruction,/card payment is a transfer/);assert.match(instruction,/Refunds\/reversals/);
 assert.deepEqual(body.contents[0].parts[1],{inlineData:pdf});
 for(const key of ['responseMimeType','responseJsonSchema','responseFormat','responseSchema'])assert.equal(body.generationConfig[key],undefined);
 assert.equal(body.generationConfig.maxOutputTokens,8192);
});

test('invalid and truncated extraction preserves measured costs without usable drafts',async t=>{
 for(const patch of [{text:JSON.stringify({...output,transactions:[{...item,amountCents:-4275}]})},{finishReason:'MAX_TOKENS'},{text:'not JSON'}]){
  const f=fixture(t);await f.setup();f.state.result={...providerResult,...patch};const response=await f.call(f.build());assert.equal(response.status,200);const data=await response.json();assert.equal(data.build.status,'failed');assert.equal(data.build.result,null);
  const usage=f.raw.prepare('SELECT cost_micros,reserved_micros FROM life_ai_usage').get();assert.equal(usage.cost_micros,providerResult.costMicros);assert.equal(usage.reserved_micros,RESERVATION_MICROS);
  assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM life_resources').get().n,0);assert.ok(validateBackup(await (await f.call(null,'a','?export')).text()));
 }
});

test('unknown transaction extraction retains the shared reservation and blocks fresh builds across intents',async t=>{
 const f=fixture(t);await f.setup();f.state.fail=true;const request=f.build();assert.equal((await f.call(request)).status,502);
 const replay=await f.call(request);assert.equal(replay.status,200);assert.equal((await replay.json()).build.status,'uncertain');assert.equal(f.state.calls.length,1);
 for(const intent of ['transactions','loans',undefined])assert.equal((await f.call(f.build({intent}))).status,429);
 const usage=f.raw.prepare('SELECT cost_micros,reserved_micros FROM life_ai_usage').get();assert.equal(usage.cost_micros,null);assert.equal(usage.reserved_micros,RESERVATION_MICROS);
 assert.ok(validateBackup(await (await f.call(null,'a','?export')).text()));
});

test('exports retain transaction context and reject tampered cross-month category suggestions',async t=>{
 const f=fixture(t);await f.setup();await f.seed(month,[{id:categoryId,name:'Groceries',limitCents:30000}]);await f.call(f.build());
 const exported=await (await f.call(null,'a','?export')).text();assert.ok(validateBackup(exported));
 for(const change of [draft=>{draft.transactions[0].categoryId=oldCategoryId;},draft=>{draft.transactions[0].date='2026-08-14';},draft=>{draft.transactions[0].date='2026-10-14';}]){
  const data=JSON.parse(exported),draft=JSON.parse(data.routineBuilds[0].result_json);change(draft);data.routineBuilds[0].result_json=JSON.stringify(draft);assert.throws(()=>validateBackup(JSON.stringify(data)));
 }
});
