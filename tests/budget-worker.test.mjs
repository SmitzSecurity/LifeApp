import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,createFetchMock} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {serializeSignedCookie} from 'better-call';
import {AI_MODEL,RESERVATION_MICROS} from '../lib/life/ai-provider.ts';
import {validateBackup} from '../lib/life/migration-preview.ts';
import {budgetOutputSchema,loanOutputSchema} from '../lib/life/budget-build-schema.ts';
import {beginBudgetReview,addBudgetReviewCategory,budgetReviewImport} from '../lib/life/budget-build-review.ts';
import {budgetSummary} from '../lib/life/modules.ts';
import {transactionOutputSchema} from '../lib/life/transaction-build-schema.ts';

const digest=value=>createHash('sha256').update(value).digest('hex');
const output={notes:'Synthetic compiled budget draft.',categories:[{name:'Groceries',limitCents:40000}],recurring:[]};
function pdfDocument(){
 let pdf='%PDF-1.4\n';const offsets=[0],objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>','<< /Length 0 >>\nstream\n\nendstream'];
 objects.forEach((body,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${body}\nendobj\n`;});
 const start=Buffer.byteLength(pdf);pdf+='xref\n0 5\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('');
 pdf+=`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
 return {mimeType:'application/pdf',data:Buffer.from(pdf).toString('base64')};
}

async function fixture(t,{countTokens=100000,rejectGeneration=false,draft=output}={}){
 const fetchMock=createFetchMock();fetchMock.disableNetConnect();const calls=[];
 const mock=fetchMock.get('https://generativelanguage.googleapis.com');
 // Drain large mocked request bodies before responding. A static mock reply
 // can reset Miniflare's Windows transport while it is still uploading.
 for(const operation of ['countTokens','generateContent'])mock.intercept({path:`/v1beta/models/${AI_MODEL}:${operation}`,method:'POST'}).reply(rejectGeneration&&operation==='generateContent'?400:200,async options=>{
  const body=JSON.parse(await new Response(options.body).text());calls.push({operation,body});
  if(operation==='generateContent'){
   assert.ok(body.systemInstruction.parts[0].text.endsWith('Required JSON shape:\n'+JSON.stringify(body.systemInstruction.parts[0].text.includes('TRANSACTION IMPORT MODE:')?transactionOutputSchema:body.systemInstruction.parts[0].text.includes('LOAN BUILDER MODE:')?loanOutputSchema:budgetOutputSchema)));
   assert.equal(body.generationConfig.responseMimeType,undefined);assert.equal(body.generationConfig.responseJsonSchema,undefined);
   assert.equal(body.generationConfig.responseFormat,undefined);assert.equal(body.generationConfig.responseSchema,undefined);
   if(rejectGeneration)return JSON.stringify({error:{code:400,status:'INVALID_ARGUMENT',message:'Synthetic request rejected'}});
  }
  return JSON.stringify(operation==='countTokens'?{totalTokens:countTokens}:{responseId:'synthetic-compiled-budget',modelVersion:AI_MODEL,candidates:[{content:{parts:[{text:JSON.stringify(typeof draft==='function'?draft(body):draft)}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:100000,candidatesTokenCount:100,thoughtsTokenCount:0,totalTokenCount:100100}});
 }).persist();
 const secret=randomBytes(48).toString('base64url');
 const mf=new Miniflare({modules:true,modulesRules:[{type:'ESModule',include:['**/*.js']}],scriptPath:'dist-standalone/server/index.js',compatibilityDate:'2026-05-22',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],fetchMock,
  bindings:{LIFEAPP_AUTH_MODE:'google',BETTER_AUTH_URL:'https://life.test',BETTER_AUTH_SECRET:secret,GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',LIFEAPP_BETA_EMAILS:'budget-worker@example.test',LIFEAPP_AI_ENABLED:'true',LIFEAPP_AI_PAID_PROJECT:'true',GEMINI_API_KEY:'synthetic-key'},serviceBindings:{ASSETS:async()=>new Response('Not found',{status:404})}});
 t.after(async()=>{await mf.dispose();await fetchMock.close();});
 const db=await mf.getD1Database('DB');
 for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint'))await db.prepare(sql.trim()).run();
 const stamp=Date.now(),id='synthetic-budget-worker',userId='google:'+id;
 await db.prepare('INSERT INTO life_auth_user VALUES(?1,?2,?3,1,NULL,?4,?4)').bind(id,'Synthetic Budget Worker','budget-worker@example.test',stamp).run();
 await db.prepare('INSERT INTO life_auth_session VALUES(?1,?2,?3,?4,?4,NULL,NULL,?5)').bind('synthetic-budget-session',stamp+3600000,'synthetic-budget-token',stamp,id).run();
 await db.prepare('INSERT INTO life_auth_account(id,account_id,provider_id,user_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?5)').bind('synthetic-budget-account','synthetic-budget-google-sub','google',id,stamp).run();
 const cookie=(await serializeSignedCookie('__Secure-lifeapp.session_token','synthetic-budget-token',secret,{path:'/',secure:true,httpOnly:true})).split(';')[0];
 const call=(body,query='')=>mf.dispatchFetch('https://life.test/api/life'+query,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:'https://life.test','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const setup=await call({action:'profile',profile:{goal:'Synthetic budget goal',timezone:'UTC',modules:['money'],habits:[],version:0}});assert.equal(setup.status,200,await setup.clone().text());
 return {mf,db,call,calls,userId,month:new Date(stamp).toISOString().slice(0,7)};
}

test('compiled multi-payday budget preserves undo, reassignment, card transfers and portable export',{timeout:60000},async t=>{
 const f=await fixture(t),month=new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth()-1,1)).toISOString().slice(0,7);
 const category=randomUUID(),other=randomUUID(),bill=randomUUID(),payday=randomUUID(),card=randomUUID();
 const ok=async body=>{const response=await f.call(body),value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value.record;};
 const save=({id,version,data})=>ok({action:'resource',record:{kind:'transaction',id,version,data}});
 const blank={categoryName:'',note:'Synthetic payment',voided:false,deleted:false};
 let plan=await ok({action:'resource',record:{kind:'budget',id:month,version:0,data:{currency:'USD',categories:[{id:category,name:'Bills',limitCents:50000},{id:other,name:'Home',limitCents:20000}],goals:{spending:'',saving:'',investing:''},recurring:[
  {id:bill,title:'Weekly service',kind:'expense',amountCents:6000,categoryId:category,day:1,frequency:'weekly',startDate:month+'-01'},
  {id:payday,title:'Biweekly income',kind:'income',amountCents:100000,categoryId:'',day:1,frequency:'biweekly',startDate:month+'-01',incomePlan:{withholdings:[{name:'Benefits',rule:{mode:'fixed',value:10000}}],saving:{mode:'percent',value:10}}},
  {id:card,title:'Card statement',kind:'transfer',amountCents:0,categoryId:'',day:2,paymentDueDay:5,variable:true},
 ]}}});
 const first=await save({id:`due:${month}-01:${bill}`,version:0,data:{...blank,date:month+'-02',occurrenceDate:month+'-01',kind:'expense',amountCents:6000,categoryId:category,recurringId:bill}});
 let second=await save({id:`due:${month}-08:${bill}`,version:0,data:{...blank,date:month+'-08',occurrenceDate:month+'-08',kind:'expense',amountCents:6000,categoryId:category,recurringId:bill}});
 let removed=await save({...first,data:{...first.data,deleted:true}});
 const previous=plan.data.recurring.find(r=>r.id===bill),change={kind:'recurring',month,previous,item:{...previous,categoryId:other}};
 assert.equal((await f.call({action:'budget-item',change})).status,400,'An independently active occurrence still protects its category');
 second=await save({...second,data:{...second.data,deleted:true}});
 plan=await ok({action:'budget-item',change});
 removed=await save({...removed,data:{...removed.data,categoryId:other,deleted:false}});
 const replay=await save({...removed,version:removed.version-1});assert.equal(replay.version,removed.version,'Exact retries do not add another payment');
 for(const day of ['01','15'])await save({id:`due:${month}-${day}:${payday}`,version:0,data:{...blank,date:month+'-'+day,occurrenceDate:month+'-'+day,kind:'income',amountCents:90000,categoryId:'',recurringId:payday,incomeDetails:{grossCents:100000,plan:plan.data.recurring.find(r=>r.id===payday).incomePlan}}});
 await save({id:`due:${month}:${card}`,version:0,data:{...blank,date:month+'-02',kind:'transfer',amountCents:25000,categoryId:'',recurringId:card}});
 const sourceId=`due:${month}-01:${payday}`;
 await save({id:`allocation:${month}-01:${payday}:saving`,version:0,data:{...blank,date:month+'-01',kind:'saving',amountCents:9000,categoryId:'',recurringId:null,planned:true,expectedDate:month+'-01',incomeSourceId:sourceId}});
 const response=await f.call(undefined,`?kind=transaction&month=${month}`),{records}=await response.json(),summary=budgetSummary(plan.data,records,month);
 assert.equal(summary.expenses,6000);assert.equal(summary.income,180000);assert.equal(summary.saving,0);assert.equal(summary.cashFlow,174000);
 assert.equal(summary.due.filter(r=>r.kind==='expense'&&r.recorded).length,1);assert.equal(summary.due.filter(r=>r.kind==='income'&&r.recorded).length,2);
 const backup=await (await f.call(undefined,'?export=1')).text();assert.doesNotThrow(()=>validateBackup(backup));
 assert.equal(f.calls.length,0,'This workflow makes no provider requests');
});

for(const scenario of [
 {name:'short text',text:'Groceries monthly allowance $400.',preflight:false},
 {name:'350,000-character text file',text:'Synthetic budget line with harmless notes.\n'.repeat(8500).slice(0,349977)+'\nGroceries budget $400.',preflight:true},
 {name:'PDF attachment',text:'',document:pdfDocument(),preflight:true},
])test(`compiled signed-in budget build accepts ${scenario.name}, retains input and retries without dispatching twice`,{timeout:60000},async t=>{
 const f=await fixture(t),requestId=randomUUID(),build={requestId,text:scenario.text,month:f.month,consent:true,...(scenario.document?{document:scenario.document}:{})};
 const response=await f.call({action:'budget-build',build},'?budget-build'),payload=await response.json();
 assert.equal(response.status,200,JSON.stringify(payload));assert.equal(payload.build.status,'complete');assert.equal(payload.build.result.categories[0].limitCents,40000);
 assert.deepEqual(f.calls.map(call=>call.operation),scenario.preflight?['countTokens','generateContent']:['generateContent']);
 const generated=f.calls.at(-1).body,snapshot=JSON.parse(generated.contents[0].parts[0].text);
 assert.equal(digest(snapshot.description),digest(scenario.text));assert.equal(snapshot.month,f.month);
 if(scenario.preflight)assert.equal(digest(JSON.stringify(f.calls[0].body.generateContentRequest.contents)),digest(JSON.stringify(generated.contents)));
 if(scenario.document)assert.equal(digest(generated.contents[0].parts[1].inlineData.data),digest(scenario.document.data));
 const replay=await f.call({action:'budget-build',build},'?budget-build');assert.equal(replay.status,200);assert.deepEqual(await replay.json(),payload);assert.equal(f.calls.length,scenario.preflight?2:1);
 const changed=await f.call({action:'budget-build',build:{...build,text:scenario.text+' changed'}},'?budget-build');assert.equal(changed.status,409);assert.equal(f.calls.length,scenario.preflight?2:1);
 const row=await f.db.prepare('SELECT status,input_snapshot,cost_micros,reserved_micros FROM life_routine_builds WHERE user_id=?1 AND request_id=?2').bind(f.userId,'budget:'+requestId).first();
 assert.equal(row.status,'complete');assert.equal(digest(JSON.parse(row.input_snapshot).description),digest(scenario.text));assert.equal(row.reserved_micros,RESERVATION_MICROS);assert.ok(row.cost_micros>0&&row.cost_micros<RESERVATION_MICROS);
 assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM life_resources WHERE kind='budget'").first()).n,0,'Generated content remains an unsaved draft');
 const list=await (await f.call(undefined,'?budget-builds')).json();assert.equal(list.blockedReason,null);assert.equal(list.builds[0].status,'complete');
 const exported=await f.call(undefined,'?export');assert.equal(exported.status,200);assert.ok(validateBackup(await exported.text()));
});

test('compiled budget preflight rejection returns 422 and a known zero-cost failure before generation',{timeout:60000},async t=>{
 const f=await fixture(t,{countTokens:180001});
 const build={requestId:randomUUID(),text:'x'.repeat(350000),month:f.month,consent:true};
 const response=await f.call({action:'budget-build',build},'?budget-build'),payload=await response.json();
 assert.equal(response.status,422,JSON.stringify(payload));assert.match(payload.error,/too long/);
 assert.deepEqual(f.calls.map(call=>call.operation),['countTokens']);
 const row=await f.db.prepare('SELECT status,cost_micros,error_code,input_tokens,output_tokens FROM life_routine_builds WHERE request_id=?1').bind('budget:'+build.requestId).first();
 assert.equal(row.status,'failed');assert.equal(row.error_code,'input_preflight_rejected');assert.equal(row.cost_micros,0);assert.equal(row.input_tokens,0);assert.equal(row.output_tokens,0);
 const replay=await f.call({action:'budget-build',build},'?budget-build');assert.equal(replay.status,200);assert.equal((await replay.json()).build.status,'failed');assert.equal(f.calls.length,1);
 const list=await (await f.call(undefined,'?budget-builds')).json();assert.equal(list.blockedReason,null);
});

test('compiled explicit provider rejection is zero-cost, replay-safe and does not block fresh builds',{timeout:60000},async t=>{
 const f=await fixture(t,{rejectGeneration:true}),build={requestId:randomUUID(),text:'Synthetic monthly budget $400.',month:f.month,consent:true};
 const response=await f.call({action:'budget-build',build},'?budget-build');assert.equal(response.status,422);
 const row=await f.db.prepare('SELECT status,cost_micros,error_code,input_tokens,output_tokens FROM life_routine_builds WHERE request_id=?1').bind('budget:'+build.requestId).first();
 assert.deepEqual(row,{status:'failed',cost_micros:0,error_code:'provider_request_rejected',input_tokens:0,output_tokens:0});
 assert.equal((await f.call({action:'budget-build',build},'?budget-build')).status,200);assert.equal(f.calls.length,1);
 const list=await (await f.call(undefined,'?budget-builds')).json();assert.equal(list.blockedReason,null);
 assert.equal((await f.call({action:'budget-build',build:{...build,requestId:randomUUID()}},'?budget-build')).status,422);assert.equal(f.calls.length,2);
 assert.ok(validateBackup(await (await f.call(undefined,'?export')).text()));
});

test('compiled loan builder preserves file intent, separate groups and explicit reviewed adoption alongside general Budget',{timeout:60000},async t=>{
 const loanOutput=JSON.parse(readFileSync('tests/fixtures/loan-workflow.json','utf8'));
 const f=await fixture(t,{draft:body=>JSON.parse(body.contents[0].parts[0].text).intent==='loans'?loanOutput:output});
 const image={mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jbeQAAAAASUVORK5CYII='};
 const build={requestId:randomUUID(),text:'Synthetic student, mortgage and credit card statements.',intent:'loans',month:f.month,image,consent:true};
 const response=await f.call({action:'budget-build',build},'?budget-build'),payload=await response.json();
 assert.equal(response.status,200,JSON.stringify(payload));assert.equal(payload.build.status,'complete');assert.equal(payload.build.intent,'loans');assert.equal(payload.build.result.recurring.length,4);
 const generated=f.calls.at(-1).body;assert.match(generated.systemInstruction.parts[0].text,/LOAN BUILDER MODE:/);assert.deepEqual(generated.contents[0].parts[1],{inlineData:image});
 assert.deepEqual(await (await f.call({action:'budget-build',build},'?budget-build')).json(),payload);assert.equal(f.calls.length,1);
 assert.equal((await f.call({action:'budget-build',build:{...build,intent:undefined}},'?budget-build')).status,409);
 assert.equal((await f.call({action:'budget-build',build:{...build,intent:'routine'}},'?budget-build')).status,400);
 assert.equal(f.calls.length,1);
 assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM life_resources WHERE kind='budget'").first()).n,0);
 const initial={currency:'USD',categories:[],recurring:[],goals:{spending:'',saving:'',investing:''}};
 let review=beginBudgetReview(payload.build.result,initial);assert.throws(()=>budgetReviewImport(review,f.month),/category/);
 review=addBudgetReviewCategory(review,'Debt payments','2000',review.recurring[0].id);const categoryId=review.categories[0].item.id;
 review={...review,recurring:review.recurring.map(item=>item.kind==='expense'?{...item,categoryId}:item)};
 const adoption={action:'budget-item',change:budgetReviewImport(review,f.month)},savedResponse=await f.call(adoption),saved=await savedResponse.json();
 assert.equal(savedResponse.status,200,JSON.stringify(saved));assert.deepEqual(await (await f.call(adoption)).json(),saved);
 const student=saved.record.data.recurring.filter(item=>item.debt.loanType==='student');assert.equal(student.length,2);assert.notEqual(student[0].id,student[1].id);assert.equal(student[0].debt.balanceCents,212345);assert.equal(student[0].debt.accruedInterestCents,1267);assert.equal(student[1].debt.annualRatePercent,6.8);
 const card=saved.record.data.recurring.find(item=>item.debt.loanType==='credit-card');assert.equal(card.kind,'transfer');assert.equal(card.debt.interestMethod,'statement');assert.equal(card.debt.paymentStatus,'balance-only');
 const summary=budgetSummary(saved.record.data,[],f.month);assert.equal(summary.due.length,2);assert.equal(summary.due.some(item=>item.recurringId===card.id||item.recurringId===student[0].id),false);assert.equal(summary.expenses,0);assert.equal(summary.saving,0);assert.equal(summary.cashFlow,0);
 const general=await f.call({action:'budget-build',build:{requestId:randomUUID(),month:f.month,text:'Groceries monthly allowance $400.',consent:true}},'?budget-build');assert.equal(general.status,200);const generalResult=await general.json();assert.equal(generalResult.build.intent,undefined);assert.equal(generalResult.build.result.categories[0].name,'Groceries');
 const list=await (await f.call(undefined,'?budget-builds')).json();assert.equal(list.builds.length,2);assert.equal(list.builds.filter(item=>item.intent==='loans').length,1);
 const ledger=await f.db.prepare('SELECT request_id,cost_micros,reserved_micros FROM life_ai_usage').all();assert.equal(ledger.results.length,2);assert.ok(ledger.results.every(item=>item.request_id.startsWith('budget:')&&item.cost_micros>0&&item.reserved_micros===RESERVATION_MICROS));
 assert.ok(validateBackup(await (await f.call(undefined,'?export')).text()));
});

test('compiled loan mode rejects nonloan provider output and retains measured usage without saving budget items',{timeout:60000},async t=>{
 const f=await fixture(t),build={requestId:randomUUID(),intent:'loans',month:f.month,text:'Synthetic loan statement',document:pdfDocument(),consent:true};
 const response=await f.call({action:'budget-build',build},'?budget-build'),payload=await response.json();
 assert.equal(response.status,200,JSON.stringify(payload));assert.equal(payload.build.status,'failed');assert.equal(payload.build.errorCode,'invalid_budget_output');assert.equal(payload.build.result,null);assert.equal(payload.build.intent,'loans');
 assert.deepEqual(f.calls.map(call=>call.operation),['countTokens','generateContent']);assert.deepEqual(await (await f.call({action:'budget-build',build},'?budget-build')).json(),payload);assert.equal(f.calls.length,2);
 const row=await f.db.prepare('SELECT status,cost_micros,reserved_micros,result_json FROM life_routine_builds WHERE request_id=?1').bind('budget:'+build.requestId).first();assert.equal(row.status,'failed');assert.ok(row.cost_micros>0);assert.equal(row.reserved_micros,RESERVATION_MICROS);assert.equal(row.result_json,null);
 assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM life_resources WHERE kind='budget'").first()).n,0);
 assert.ok(validateBackup(await (await f.call(undefined,'?export')).text()));
});

test('compiled missing loan due day keeps all fifteen loans reviewable and status checks stay read-only',{timeout:60000},async t=>{
 const fixtures=JSON.parse(readFileSync('tests/fixtures/loan-workflow.json','utf8'));
 const recurring=Array.from({length:14},(_,i)=>({...fixtures.recurring[0],title:'Synthetic student group '+(i+1)}));
 recurring[0]={...recurring[0],day:19,startDate:'2026-10-01'};
 recurring[1]={...recurring[1],debt:{...recurring[1].debt,paymentStatus:null,interestAccrual:null}};
 recurring[13]={...fixtures.recurring[3],kind:'expense',debt:{...fixtures.recurring[3].debt,interestMethod:'daily'}};
 recurring.push({...fixtures.recurring[2],day:null});
 const f=await fixture(t,{draft:{notes:'Verify repayment terms against the statement.',categories:[],recurring}});
 const text='Synthetic dated loan statement.\n'.repeat(11000);
 const build={requestId:randomUUID(),intent:'loans',month:f.month,text,consent:true};
 const response=await f.call({action:'budget-build',build},'?budget-build'),payload=await response.json();
 assert.equal(response.status,200,JSON.stringify(payload));assert.equal(payload.build.status,'complete');
 assert.equal(payload.build.result.recurring.length,15);
 assert.equal(payload.build.result.recurring[0].startDate,undefined);assert.equal(payload.build.result.recurring[0].day,1);
 assert.equal(payload.build.result.recurring[1].debt.paymentStatus,'balance-only');assert.equal(payload.build.result.recurring[1].debt.interestAccrual,'unknown');
 assert.equal(payload.build.result.recurring[13].kind,'transfer');assert.equal(payload.build.result.recurring[13].debt.interestMethod,'statement');
 const mortgage=payload.build.result.recurring[14];assert.equal(mortgage.debt.paymentStatus,'balance-only');assert.equal(mortgage.amountCents,0);
 assert.equal(mortgage.debt.balanceCents,fixtures.recurring[2].debt.balanceCents);assert.equal(mortgage.debt.annualRatePercent,5.5);
 assert.match(payload.build.result.notes,/Home mortgage/);assert.match(payload.build.result.notes,/1,550|1550/);
 const before=await f.db.prepare('SELECT request_id,status,cost_micros,reserved_micros FROM life_ai_usage').all();
 for(let i=0;i<3;i++){
  const result=await (await f.call(undefined,'?budget-builds&summary=1')).json();assert.equal(result.builds.length,1);
  assert.equal(result.builds[0].description,undefined);assert.deepEqual(result.builds[0].result,payload.build.result);
 }
 const full=await (await f.call(undefined,'?budget-builds')).json();assert.equal(full.builds[0].description,text.trim());
 assert.deepEqual((await f.db.prepare('SELECT request_id,status,cost_micros,reserved_micros FROM life_ai_usage').all()).results,before.results);
 assert.equal(f.calls.filter(call=>call.operation==='generateContent').length,1);
 assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM life_resources WHERE kind='budget'").first()).n,0);
 assert.ok(validateBackup(await (await f.call(undefined,'?export')).text()));
});

test('compiled receipt extraction and multi-month transaction adoption are atomic, retry-safe and portable',{timeout:60000},async t=>{
 const month=new Date().toISOString().slice(0,7),past=new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth()-1,1)).toISOString().slice(0,7);
 const category=randomUUID(),newCategory=randomUUID();
 const draft={notes:'Synthetic receipt review.',transactions:[
  {date:month+'-01',kind:'expense',amountCents:4275,note:'Grocery receipt',categoryId:category,warning:''},
  {date:past+'-01',kind:'expense',amountCents:1850,note:'Historical taxi',categoryId:null,warning:''},
  {date:month+'-01',kind:'transfer',amountCents:30000,note:'Card payment',categoryId:null,warning:''},
 ]};
 const f=await fixture(t,{draft});
 const current={currency:'USD',categories:[{id:category,name:'Groceries',limitCents:25000,archived:false}],recurring:[],goals:{spending:'',saving:'',investing:''}};
 const historical={...current,categories:current.categories.map(c=>({...c,limitCents:0}))};
 const savedPlanResponse=await f.call({action:'budget-item',change:{kind:'initialize',month,initial:current}});
 assert.equal(savedPlanResponse.status,200,await savedPlanResponse.clone().text());
 const savedPlan=(await savedPlanResponse.json()).record;
 const build={requestId:randomUUID(),month,intent:'transactions',text:'Synthetic grocery receipt and past taxi/card statement.',document:pdfDocument(),consent:true};
 const response=await f.call({action:'budget-build',build},'?budget-build'),built=await response.json();
 assert.equal(response.status,200,JSON.stringify(built));assert.equal(built.build.status,'complete');
 assert.equal(built.build.intent,'transactions');assert.equal(built.build.result.transactions[0].categoryId,category);
 const providerSnapshot=JSON.parse(f.calls.find(c=>c.operation==='generateContent').body.contents[0].parts[0].text);
 assert.equal(providerSnapshot.moneyGoals,undefined);assert.equal(providerSnapshot.transactionContext.categoriesByMonth[0].categories[0].id,category);
 const reviewed={requestId:randomUUID(),buildId:build.requestId,months:[{month,initial:savedPlan.data,categories:[]},{month:past,initial:historical,categories:[{id:newCategory,name:'Travel',limitCents:0,archived:false}]}],transactions:built.build.result.transactions.map(row=>({id:row.id,version:0,data:{date:row.date,kind:row.kind,amountCents:row.amountCents,note:row.note,categoryId:row.kind==='expense'?(row.date.startsWith(past)?newCategory:category):'',categoryName:'',recurringId:null,voided:false,deleted:false}}))};
 const invalid=structuredClone(reviewed);invalid.transactions[1].data.categoryId=randomUUID();
 assert.equal((await f.call({action:'transaction-import',import:invalid},'?transaction-import')).status,409);
 assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM life_resources WHERE kind='transaction'").first()).n,0,'No partial rows after invalid category');
 assert.equal(await f.db.prepare("SELECT resource_id FROM life_resources WHERE kind='budget' AND resource_id=?1").bind(past).first(),null,'No partial historical month');
 const adopted=await f.call({action:'transaction-import',import:reviewed},'?transaction-import'),result=await adopted.json();
 assert.equal(adopted.status,200,JSON.stringify(result));assert.equal(result.records.length,3);
 assert.equal(result.plans.find(p=>p.id===past).data.recurring.length,0);
 const replay=await f.call({action:'transaction-import',import:reviewed},'?transaction-import');assert.equal(replay.status,200);assert.equal((await replay.json()).alreadyImported,true);
 assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM life_resources WHERE kind='transaction'").first()).n,3);
 const records=(await (await f.call(undefined,'?kind=transaction&month='+month)).json()).records;
 const totals=budgetSummary(savedPlan.data,records,month);assert.equal(totals.expenses,4275);assert.equal(totals.income,0);
 const changed=structuredClone(reviewed);changed.transactions[0].data.amountCents++;
 assert.equal((await f.call({action:'transaction-import',import:changed},'?transaction-import')).status,409);
 assert.ok(validateBackup(await (await f.call(undefined,'?export=1')).text()));
 assert.equal(f.calls.filter(c=>c.operation==='generateContent').length,1);
});
