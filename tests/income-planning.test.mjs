import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {calculateIncome,incomePlanError,incomeAllocationId} from '../lib/life/income-planning.ts';
import {budgetSchema,transactionSchema,budgetSummary,incomeAllocations,occurrenceId} from '../lib/life/modules.ts';
import {handleLife} from '../lib/life/service.ts';
import {validateBackup} from '../lib/life/migration-preview.ts';
const now=new Date('2026-09-16T12:00:00Z'),month='2026-09',rec=randomUUID();
const policy={withholdings:[{name:'Tax withholding',rule:{mode:'percent',value:20}},{name:'Benefits',rule:{mode:'fixed',value:10000}}],saving:{mode:'percent',value:10},investing:{mode:'fixed',value:15000}};
const plan=budgetSchema.parse({currency:'USD',categories:[],recurring:[{id:rec,title:'Payday',kind:'income',amountCents:200000,categoryId:'',day:16,incomePlan:policy}],goals:{spending:'',saving:'',investing:''}});
const income=()=>({id:occurrenceId(month,rec),version:1,data:transactionSchema.parse({date:'2026-09-16',kind:'income',amountCents:150000,categoryId:'',categoryName:'',note:'Payday',recurringId:rec,voided:false,incomeDetails:{grossCents:200000,plan:policy}})});
function fixture(){const raw=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+f,'utf8'));const db={prepare(sql){return{bind(...params){const q=raw.prepare(sql);return{async first(){return q.get(...params)||null;},async all(){return{results:q.all(...params)};}};}};}};return{raw,db};}
const call=(db,body,user='owner',path='')=>handleLife(new Request('https://life.test/api/life'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json',Origin:'https://life.test'}:undefined,body:body?JSON.stringify(body):undefined}),user,db,now);
const save=(db,id,data,version=0)=>call(db,{action:'resource',record:{kind:'transaction',id,version,data}});
async function setup(db){assert.equal((await call(db,{action:'profile',profile:{goal:'Synthetic',timezone:'UTC',modules:['money'],habits:[],version:0}})).status,200);assert.equal((await call(db,{action:'resource',record:{kind:'budget',id:month,version:0,data:plan}})).status,200);}

test('income deductions use gross, targets use take-home, and rounding stays in cents',()=>{
 const result=calculateIncome(200000,policy);assert.equal(result.withheldCents,50000);assert.equal(result.netCents,150000);assert.equal(result.savingCents,15000);assert.equal(result.investingCents,15000);assert.equal(result.remainingCents,120000);
 assert.equal(calculateIncome(10001,{withholdings:[{name:'Deduction',rule:{mode:'percent',value:12.5}}],saving:{mode:'percent',value:10}}).savingCents,875);
 assert.match(incomePlanError(100,{withholdings:[{name:'Too much',rule:{mode:'fixed',value:100}}]}),/take-home/);
 assert.match(incomePlanError(100,{withholdings:[],saving:{mode:'fixed',value:101}}),/exceed/);
 assert.equal(budgetSchema.safeParse({...plan,recurring:[{...plan.recurring[0],kind:'expense'}]}).success,false);
 assert.equal(transactionSchema.safeParse({...income().data,amountCents:200000}).success,false);
});

test('allocation prompts are stable, excluded from actual totals, and suppressed after deletion',()=>{
 const source=income(),allocations=incomeAllocations([source],month);assert.equal(allocations.length,2);assert.ok(allocations.every(t=>t.data.planned));
 const summary=budgetSummary(plan,[source,...allocations],month);assert.equal(summary.income,150000);assert.equal(summary.saving,0);assert.equal(summary.investing,0);assert.equal(summary.cashFlow,150000);
 const paid={...allocations[0],version:1,data:{...allocations[0].data,amountCents:12000,planned:false}};
 assert.equal(budgetSummary(plan,[source,paid],month).saving,12000);
 assert.equal(incomeAllocations([source,paid],month).length,1);
 const adjusted={...source,data:{...source.data,amountCents:230000,incomeDetails:{...source.data.incomeDetails,grossCents:300000}}};
 assert.equal(incomeAllocations([adjusted,paid],month).some(t=>t.id===paid.id),false);
 assert.equal(incomeAllocations([{...source,data:{...source.data,voided:true}}],month).length,0);
 assert.equal(incomeAllocations([source,{...allocations[0],version:1,data:{...allocations[0].data,deleted:true}}],month).length,1);
 assert.equal(incomeAllocations([source],month,allocations.map(t=>t.id)).length,0);
 assert.equal(incomeAllocations([source],'2026-10').length,0);
});

test('income snapshots and separately confirmed transfers preserve exact retries and original amounts',async()=>{
 const {db,raw}=fixture();try{await setup(db);const source=income();
 let response=await save(db,source.id,source.data);assert.equal(response.status,200);assert.equal((await response.json()).record.version,1);
 const transfer=incomeAllocations([source],month)[0],actual={...transfer.data,planned:false,amountCents:12500};
 response=await save(db,transfer.id,actual);assert.equal(response.status,200);assert.equal((await response.json()).record.version,1);
 response=await save(db,transfer.id,actual);assert.equal(response.status,200);assert.equal((await response.json()).record.version,1);
 assert.equal((await save(db,source.id,{...source.data,incomeDetails:{...source.data.incomeDetails,plan:{withholdings:[]}}},1)).status,400);
 assert.equal((await save(db,transfer.id,{...actual,incomeSourceId:occurrenceId(month,randomUUID())},1)).status,400);
 assert.equal((await save(db,transfer.id,{...actual,kind:'investing'},1)).status,400);
 assert.equal((await save(db,source.id,{...source.data,voided:true},1)).status,200);
 assert.equal((await save(db,transfer.id,{...actual,note:'Correct transfer description'},1)).status,200);
 const investment=incomeAllocationId(source.id,'investing');assert.equal((await save(db,investment,{...incomeAllocations([source],month)[1].data,planned:false})).status,409);
 }finally{raw.close();}
});

test('allocation dismissal enters Trash and permanent tombstones suppress derived prompts',async()=>{
 const {db,raw}=fixture();try{await setup(db);const source=income();await save(db,source.id,source.data);
 const transfer=incomeAllocations([source],month)[0];assert.equal((await save(db,transfer.id,{...transfer.data,deleted:true})).status,200);
 assert.ok(raw.prepare("SELECT 1 FROM life_trash WHERE kind='transaction' AND record_id=?").get(transfer.id));
 raw.prepare('DELETE FROM life_resources WHERE resource_id=?').run(transfer.id);raw.prepare('UPDATE life_trash SET purged_at=? WHERE record_id=?').run(now.toISOString(),transfer.id);
 const listing=await(await call(db,null,'owner','?kind=transaction&month='+month)).json();assert.ok(listing.suppressedAllocations.includes(transfer.id));
 assert.equal(incomeAllocations(listing.records,month,listing.suppressedAllocations).some(t=>t.id===transfer.id),false);
 assert.equal((await save(db,transfer.id,{...transfer.data,planned:false})).status,410);
 }finally{raw.close();}
});

test('income confirmation fails closed for changed rules and cross-account allocation sources',async()=>{
 const {db,raw}=fixture();try{await setup(db);const source=income();
 assert.equal((await save(db,source.id,{...source.data,incomeDetails:undefined,amountCents:200000})).status,400);
 const different={withholdings:[],saving:{mode:'fixed',value:1000}};
 assert.equal((await save(db,source.id,{...source.data,amountCents:200000,incomeDetails:{grossCents:200000,plan:different}})).status,409);
 const fakeSource=occurrenceId(month,randomUUID());assert.equal((await save(db,incomeAllocationId(fakeSource,'saving'),{...incomeAllocations([source],month)[0].data,incomeSourceId:fakeSource})).status,409);
 assert.equal((await save(db,randomUUID(),incomeAllocations([source],month)[0].data)).status,400);
 }finally{raw.close();}
});

test('income and allocation exports remain valid after the source income is permanently deleted',async()=>{
 const {db,raw}=fixture();try{await setup(db);const source=income();await save(db,source.id,source.data);
 const transfer=incomeAllocations([source],month)[0];await save(db,transfer.id,{...transfer.data,planned:false});
 let text=await(await call(db,null,'owner','?export=1')).text();assert.ok(validateBackup(text).resources.some(r=>r.resource_id===transfer.id));
 await save(db,source.id,{...source.data,deleted:true},1);const row=raw.prepare('SELECT deleted_at FROM life_trash WHERE record_id=?').get(source.id);
 assert.equal((await call(db,{action:'trash',change:{kind:'transaction',id:source.id,deletedAt:row.deleted_at,operation:'purge'}})).status,200);
 text=await(await call(db,null,'owner','?export=1')).text();const backup=validateBackup(text);assert.ok(backup.resources.some(r=>r.resource_id===transfer.id));assert.equal(backup.resources.some(r=>r.resource_id===source.id),false);
 const invalid=structuredClone(backup),linked=invalid.resources.find(r=>r.resource_id===transfer.id);linked.resource_id=randomUUID();assert.throws(()=>validateBackup(JSON.stringify(invalid)),/invalid_occurrence_id/);
 }finally{raw.close();}
});

test('first income confirmation atomically rejects changed, enabled or disabled rules while unrelated plan edits survive',async()=>{
 for(const mode of ['changed','enabled','disabled','unrelated']){
  const {db,raw}=fixture();try{
   await setup(db);const source=income(),initial=structuredClone(plan);
   if(mode==='enabled'){delete initial.recurring[0].incomePlan;raw.prepare("UPDATE life_resources SET payload=? WHERE kind='budget' AND resource_id=?").run(JSON.stringify(initial),month);delete source.data.incomeDetails;source.data.amountCents=200000;}
   let intercepted=false;
   const racingDb={prepare(sql){const statement=db.prepare(sql);return{bind(...params){const bound=statement.bind(...params);return{...bound,async first(){
    if(!intercepted&&sql.startsWith('INSERT INTO life_resources')&&params[1]==='transaction'&&params[2]===source.id){
     intercepted=true;const next=structuredClone(initial);
     if(mode==='changed')next.recurring[0].incomePlan.saving.value=15;
     else if(mode==='enabled')next.recurring[0].incomePlan=policy;
     else if(mode==='disabled')delete next.recurring[0].incomePlan;
     else next.categories.push({id:randomUUID(),name:'Unrelated allowance',limitCents:50000,archived:false});
     raw.prepare("UPDATE life_resources SET payload=?,version=version+1 WHERE user_id='owner' AND kind='budget' AND resource_id=?").run(JSON.stringify(next),month);
    }
    return bound.first();
   }};}};}};
   const response=await save(racingDb,source.id,source.data);assert.equal(intercepted,true);
   assert.equal(response.status,mode==='unrelated'?200:409);
   assert.equal(!!raw.prepare("SELECT 1 FROM life_resources WHERE kind='transaction' AND resource_id=?").get(source.id),mode==='unrelated');
   if(mode==='unrelated'){
    assert.equal(JSON.parse(raw.prepare("SELECT payload FROM life_resources WHERE kind='budget' AND resource_id=?").get(month).payload).categories.length,1);
    raw.prepare("UPDATE life_resources SET payload=json_remove(payload,'$.recurring[0].incomePlan'),version=version+1 WHERE kind='budget' AND resource_id=?").run(month);
    const retry=await save(db,source.id,source.data);assert.equal(retry.status,200);assert.equal((await retry.json()).record.version,1);
   }
  }finally{raw.close();}
 }
});
