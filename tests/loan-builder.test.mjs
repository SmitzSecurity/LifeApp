import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {handleLife} from '../lib/life/service.ts';
import {budgetSchema,budgetSummary} from '../lib/life/modules.ts';
import {budgetBuildInput,budgetSnapshotSchema,budgetBuildResult,parseBudgetDraft,budgetInstruction,loanInstruction,budgetOutputSchema} from '../lib/life/budget-build-schema.ts';
import {beginBudgetReview,addBudgetReviewCategory,budgetReviewUnassigned,budgetReviewImport} from '../lib/life/budget-build-review.ts';
import {geminiProvider,AI_MODEL,RESERVATION_MICROS} from '../lib/life/ai-provider.ts';
import {validateBackup} from '../lib/life/migration-preview.ts';

const now=new Date('2026-09-16T14:00:00Z'),month='2026-09';
const student={title:'Student loan — group A',kind:'expense',amountCents:0,frequency:'monthly-day',variable:false,
 debt:{loanType:'student',paymentStatus:'balance-only',balanceCents:212345,accruedInterestCents:1267,balanceDate:'2026-09-14',interestMethod:'statement',interestAccrual:'unknown',otherPaymentCents:0}};
const mortgage={title:'Home mortgage',kind:'expense',amountCents:155000,frequency:'monthly-day',day:1,variable:false,startDate:'2026-10-01',
 debt:{loanType:'mortgage',paymentStatus:'scheduled',originalBalanceCents:24000000,balanceCents:22345678,balanceDate:'2026-09-15',annualRatePercent:5.5,interestMethod:'monthly',interestAccrual:'accruing',otherPaymentCents:35000}};
const card={title:'Credit card',kind:'transfer',amountCents:0,frequency:'monthly-day',day:20,variable:true,paymentDueDay:20,
 debt:{loanType:'credit-card',paymentStatus:'scheduled',balanceCents:42500,balanceDate:'2026-09-12',annualRatePercent:21.99,interestMethod:'statement',interestAccrual:'unknown',otherPaymentCents:0}};
const result={notes:'Confirm the student repayment schedule. Card balance is not the next statement payment.',categories:[],recurring:[student,mortgage,card]};
const providerResult={text:JSON.stringify(result),inputTokens:500,outputTokens:400,thoughtTokens:0,costMicros:1875,providerId:'synthetic',modelVersion:AI_MODEL,finishReason:'STOP'};
const png={mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jbeQAAAAASUVORK5CYII='};
const pdf={mimeType:'application/pdf',data:Buffer.from('%PDF-1.7\nSynthetic statement\n%%EOF').toString('base64')};
function fixture(t){
 const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+file,'utf8'));
 const db={prepare(sql){return {bind(...params){return {async first(){return raw.prepare(sql).get(...params)||null;},async all(){return {results:raw.prepare(sql).all(...params)};}};}};}};
 const state={calls:[],result:providerResult,fail:false};
 const ai={enabled:true,userCapMicros:1000000,globalCapMicros:5000000,provider:{generate:async(input,purpose,attachment)=>{state.calls.push({input:JSON.parse(input),purpose,attachment});if(state.fail)throw Error('Unknown provider outcome');return state.result;}}};
 const call=(body,user='a',query='')=>handleLife(new Request('https://life.test/api/life'+query,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:'https://life.test'},body:body?JSON.stringify(body):undefined}),user,db,now,ai);
 const setup=async(user='a')=>{assert.equal((await call({action:'profile',profile:{goal:'Journal',moduleGoals:{money:'Understand debt'},timezone:'UTC',modules:['money'],habits:[],version:0}},user)).status,200);};
 const build=(patch={})=>({action:'budget-build',build:{requestId:randomUUID(),intent:'loans',month,text:'Synthetic loan statement with principal and date, no payment schedule.',consent:true,...patch}});
 const initial=budgetSchema.parse({currency:'USD',categories:[],recurring:[],goals:{spending:'',saving:'',investing:''}});
 return {raw,db,state,ai,call,setup,build,initial};
}

test('loan intent is explicit, strict and optional for legacy Budget builds and exports',()=>{
 const base={requestId:randomUUID(),month,text:'Loan statement',consent:true};
 assert.equal(budgetBuildInput.parse(base).intent,undefined);
 assert.equal(budgetBuildInput.parse({...base,intent:'loans'}).intent,'loans');
 for(const intent of ['loan','budget','routine',null])assert.equal(budgetBuildInput.safeParse({...base,intent}).success,false);
 assert.equal(budgetSnapshotSchema.parse({description:base.text,month,intent:'loans',moneyGoals:{}}).intent,'loans');
 assert.equal(budgetSnapshotSchema.safeParse({description:base.text,month,intent:'routine',moneyGoals:{}}).success,false);
});

test('loan extraction preserves separate principal, interest, unknown terms and payment schedules',()=>{
 const parsed=parseBudgetDraft(JSON.stringify(result),'loans');
 const [a,b,c]=parsed.recurring;
 assert.equal(a.debt.balanceCents,212345);assert.equal(a.debt.accruedInterestCents,1267);assert.equal(a.debt.balanceDate,'2026-09-14');
 assert.equal(a.debt.originalBalanceCents,undefined);assert.equal(a.debt.annualRatePercent,undefined);assert.equal(a.debt.paymentStatus,'balance-only');assert.equal(a.day,1);assert.equal(a.startDate,undefined);assert.equal(a.amountCents,0);
 assert.equal(b.debt.otherPaymentCents,35000);assert.equal(b.amountCents,155000);assert.equal(b.startDate,'2026-10-01');
 assert.equal(c.kind,'transfer');assert.equal(c.categoryId,'');assert.equal(c.amountCents,0);assert.equal(c.debt.balanceCents,42500);assert.equal(c.paymentDueDay,20);
 assert.ok(parsed.recurring.every(r=>r.categoryId===''));
 const optionalNulls={...student,debt:{...student.debt,originalBalanceCents:null,annualRatePercent:null}};
 assert.equal(parseBudgetDraft(JSON.stringify({...result,recurring:[optionalNulls]}),'loans').recurring[0].debt.annualRatePercent,undefined);
});

test('loan mode rejects ordinary charges, income and generated categories before returning a usable draft',()=>{
 for(const input of [
  {...result,categories:[{name:'Bills',limitCents:100000}]},
  {...result,recurring:[{...student,debt:undefined,amountCents:1000,day:1}]},
  {...result,recurring:[{...student,kind:'income'}]},
  {...result,recurring:[{...student,debt:{...student.debt,loanType:undefined}}]},
  {...result,recurring:[{...student,debt:{...student.debt,paymentStatus:undefined}}]},
  {...result,recurring:[{...student,debt:{...student.debt,interestAccrual:undefined}}]},
  {...result,recurring:[{...student,amountCents:212345}]},
  {...result,recurring:[{...student,startDate:'2026-09-01'}]},
  {...result,recurring:[{...student,day:15}]},
  {...result,recurring:[{...card,debt:{...card.debt,interestMethod:'daily'}}]},
  {...result,recurring:[{...student,debt:{...student.debt,balanceDate:'2026-02-30'}}]},
  {...result,recurring:[{...student,debt:{...student.debt,balanceCents:null}}]},
  {...result,recurring:[{...student,debt:{...student.debt,annualRatePercent:-1}}]},
  {...result,recurring:[{...student,debt:{...student.debt,unsupported:'private'}}]},
 ])assert.throws(()=>parseBudgetDraft(JSON.stringify(input),'loans'));
 assert.deepEqual(parseBudgetDraft(JSON.stringify({notes:'The statement balance date is missing.',categories:[],recurring:[]}),'loans').recurring,[]);
 const ordinary={notes:'',categories:[],recurring:[{title:'Rent',kind:'expense',amountCents:120000,frequency:'monthly-day',day:1,variable:false}]};
 assert.equal(parseBudgetDraft(JSON.stringify(ordinary)).recurring[0].title,'Rent');
});

test('loan generation uses Budget identity, fingerprints, accounting and exact retries without auto-adoption',async t=>{
 const f=fixture(t);await f.setup();const request=f.build({image:png});
 const response=await f.call(request);assert.equal(response.status,200);const payload=await response.json();assert.equal(payload.build.intent,'loans');assert.equal(payload.build.status,'complete');
 assert.deepEqual(await (await f.call(request)).json(),payload);assert.equal(f.state.calls.length,1);assert.equal(f.state.calls[0].purpose,'budget');assert.deepEqual(f.state.calls[0].attachment,png);
 assert.equal(f.state.calls[0].input.intent,'loans');assert.equal(f.state.calls[0].input.image.mimeType,'image/png');assert.match(f.state.calls[0].input.image.sha256,/^[a-f0-9]{64}$/);assert.equal(f.state.calls[0].input.image.data,undefined);
 for(const patch of [{intent:undefined},{text:'A different loan description'},{image:undefined},{month:'2026-10'}])assert.equal((await f.call({...request,build:{...request.build,...patch}})).status,409);
 const listed=await (await f.call(null,'a','?budget-builds')).json();assert.equal(listed.builds[0].intent,'loans');
 assert.equal((await f.call(null,'b','?budget-builds')).status,200);assert.equal((await (await f.call(null,'b','?budget-builds')).json()).builds.length,0);
 assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM life_resources WHERE kind='budget'").get().n,0);
 const ledger=f.raw.prepare('SELECT request_id,cost_micros,reserved_micros FROM life_ai_usage').get();assert.equal(ledger.request_id,'budget:'+request.build.requestId);assert.equal(ledger.cost_micros,1875);assert.equal(ledger.reserved_micros,RESERVATION_MICROS);
 assert.ok(validateBackup(await (await f.call(null,'a','?export')).text()));
});

test('loan review requires explicit expense categories, adopts atomically and never creates bills for balance-only loans',async t=>{
 const f=fixture(t);await f.setup();const draft=parseBudgetDraft(JSON.stringify(result),'loans');let review=beginBudgetReview(draft,f.initial);
 assert.equal(budgetReviewUnassigned(review).length,2);assert.throws(()=>budgetReviewImport(review,month),/category/);
 review=addBudgetReviewCategory(review,'Loan payments','2000',review.recurring[0].id);const categoryId=review.categories[0].item.id;
 review={...review,recurring:review.recurring.map(item=>item.kind==='expense'?{...item,categoryId}:item)};
 const request={action:'budget-item',change:budgetReviewImport(review,month)};
 const response=await f.call(request);assert.equal(response.status,200);const first=await response.json();assert.deepEqual(await (await f.call(request)).json(),first);
 const totals=budgetSummary(first.record.data,[],month);assert.equal(totals.expenses,0);assert.equal(totals.due.some(item=>item.recurringId===review.recurring[0].id),false);
 assert.equal(first.record.data.recurring.length,3);assert.equal(first.record.data.recurring[0].debt.accruedInterestCents,1267);
 assert.ok(validateBackup(await (await f.call(null,'a','?export')).text()));
});

test('invalid loan outputs settle measured usage but cannot create or expose ordinary budget recommendations',async t=>{
 const f=fixture(t);await f.setup();f.state.result={...providerResult,text:JSON.stringify({...result,recurring:[{title:'Salary',kind:'income',amountCents:100000,frequency:'monthly-day',day:1,variable:false}]})};
 const request=f.build(),response=await f.call(request);assert.equal(response.status,200);const payload=await response.json();assert.equal(payload.build.status,'failed');assert.equal(payload.build.result,null);assert.equal(payload.build.errorCode,'invalid_budget_output');
 assert.deepEqual(await (await f.call(request)).json(),payload);assert.equal(f.state.calls.length,1);assert.equal(f.raw.prepare('SELECT cost_micros FROM life_ai_usage').get().cost_micros,1875);
});

test('loan and general Budget builds share attempt caps and pending outcome blockers',async t=>{
 const f=fixture(t);await f.setup();
 for(const intent of [undefined,'loans'])assert.equal((await f.call(f.build({intent}))).status,200);
 assert.equal((await f.call(f.build())).status,429);assert.equal(f.state.calls.length,2);
 const g=fixture(t);await g.setup();g.state.fail=true;const request=g.build();assert.equal((await g.call(request)).status,502);g.state.fail=false;
 assert.equal((await g.call(g.build({intent:undefined}))).status,429);assert.equal((await g.call(g.build())).status,429);
 const replay=await (await g.call(request)).json();assert.equal(replay.build.status,'uncertain');assert.equal(replay.build.intent,'loans');assert.equal(g.state.calls.length,1);
 const ledger=g.raw.prepare('SELECT cost_micros,reserved_micros FROM life_ai_usage').get();assert.equal(ledger.cost_micros,null);assert.equal(ledger.reserved_micros,RESERVATION_MICROS);
 const listed=await (await g.call(null,'a','?budget-builds')).json();assert.match(listed.blockedReason,/unconfirmed/);
});

test('loan provider instruction carries the full schema and attachment without provider schema configuration',async()=>{
 const calls=[];const provider=geminiProvider('synthetic-key',async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body});return Response.json(String(url).endsWith(':countTokens')?{totalTokens:1000}:{candidates:[{content:{parts:[{text:JSON.stringify(result)}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:200,totalTokenCount:300},modelVersion:AI_MODEL});});
 const input=JSON.stringify({intent:'loans',description:'Synthetic statement',month});await provider.generate(input,'budget',pdf);
 assert.equal(calls.length,2);assert.match(calls[0].url,/:countTokens$/);const body=calls[1].body;
 assert.equal(body.contents[0].parts[0].text,input);assert.deepEqual(body.contents[0].parts[1],{inlineData:pdf});
 assert.ok(body.systemInstruction.parts[0].text.startsWith(loanInstruction));assert.ok(body.systemInstruction.parts[0].text.endsWith('Required JSON shape:\n'+JSON.stringify(budgetOutputSchema)));
 for(const key of ['responseMimeType','responseJsonSchema','responseSchema','responseFormat'])assert.equal(body.generationConfig[key],undefined);
 for(const text of ['separate from outstanding principal','Never estimate current rates','categories array must be empty','monthly-day','balance-only'])assert.ok(loanInstruction.includes(text));
 assert.match(budgetInstruction,/credit-card and interestMethod statement/);
});


test('loan mode cannot manufacture a recovery grant and an operator grant preserves the original Budget hold',async t=>{
 const f=fixture(t);await f.setup();f.state.fail=true;const source=f.build();assert.equal((await f.call(source)).status,502);f.state.fail=false;
 assert.equal((await f.call(f.build({recoveryOf:source.build.requestId}))).status,429);assert.equal(f.state.calls.length,1);
 const expiresAt='2026-09-17T14:00:00.000Z',sourceId=source.build.requestId;
 assert.equal((await f.call({action:'resource',record:{kind:'ai-recovery',id:sourceId,version:0,data:{sourceId,purpose:'budget',expiresAt}}})).status,400);
 f.raw.prepare('INSERT INTO life_resources VALUES(?,?,?,?,?,1,?,NULL)').run('a','ai-recovery',sourceId,'',JSON.stringify({sourceId,purpose:'budget',expiresAt}),now.toISOString());
 const recovery=f.build({recoveryOf:sourceId});assert.equal((await f.call(recovery)).status,200);assert.equal((await f.call(recovery)).status,200);assert.equal(f.state.calls.length,2);
 assert.equal((await f.call(f.build({recoveryOf:sourceId}))).status,429);
 const old=f.raw.prepare('SELECT status,cost_micros,reserved_micros FROM life_ai_usage WHERE request_id=?').get('budget:'+sourceId);assert.equal(old.status,'uncertain');assert.equal(old.cost_micros,null);assert.equal(old.reserved_micros,RESERVATION_MICROS);
 const list=await (await f.call(null,'a','?budget-builds')).json();assert.equal(list.blockedReason,null);assert.equal(list.recovery,null);assert.equal(list.builds.find(item=>item.id===sourceId).resolvedBlocker,true);
 assert.ok(validateBackup(await (await f.call(null,'a','?export')).text()));
});

test('loan drafts use existing Trash retention and permanent purge preserves accounting without replay or restoration',async t=>{
 const f=fixture(t);await f.setup();const request=f.build();const payload=await (await f.call(request)).json(),id='budget:'+payload.build.id;
 assert.equal((await f.call({action:'record-deletion',change:{kind:'build',id,deleted:true}})).status,200);
 const before=await (await f.call(null,'a','?budget-builds')).json();assert.equal(before.builds[0].deleted,true);assert.equal(before.builds[0].intent,'loans');
 const trash=await (await f.call(null,'a','?trash')).json(),item=trash.items.find(item=>item.id===id);
 assert.equal((await f.call({action:'trash',change:{kind:'build',id,deletedAt:item.deletedAt,operation:'purge'}})).status,200);
 assert.equal((await f.call(request)).status,410);assert.equal((await f.call({action:'trash',change:{kind:'build',id,deletedAt:item.deletedAt,operation:'restore'}})).status,410);
 const row=f.raw.prepare('SELECT result_json,input_snapshot,cost_micros FROM life_routine_builds WHERE request_id=?').get(id);assert.equal(row.result_json,null);assert.equal(JSON.parse(row.input_snapshot).purged,true);assert.doesNotMatch(row.input_snapshot,/Synthetic loan statement|Student loan/);assert.equal(row.cost_micros,1875);assert.equal(f.state.calls.length,1);
 assert.ok(validateBackup(await (await f.call(null,'a','?export')).text()));
});


test('legacy zero-payment loan drafts stay readable but cannot bypass reviewed adoption validation',()=>{
 const legacy={id:randomUUID(),title:'Older loan draft',kind:'expense',amountCents:0,categoryId:'',frequency:'monthly-day',day:1,variable:false,debt:{originalBalanceCents:100000,balanceCents:90000,balanceDate:'2026-09-01',annualRatePercent:5,interestMethod:'monthly',otherPaymentCents:0}};
 const saved=budgetBuildResult.parse({notes:'Payment amount needs review.',categories:[],recurring:[legacy]});
 let review=beginBudgetReview(saved,budgetSchema.parse({currency:'USD',categories:[],recurring:[],goals:{spending:'',saving:'',investing:''}}));review=addBudgetReviewCategory(review,'Loans','100',legacy.id);
 assert.throws(()=>budgetReviewImport(review,month),/amount|payment/i);
 review={...review,recurring:review.recurring.map(item=>({...item,amountCents:10000}))};assert.equal(budgetReviewImport(review,month).recurring[0].item.amountCents,10000);
});
