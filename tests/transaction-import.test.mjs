import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {handleLife} from '../lib/life/service.ts';
import {budgetSchema,transactionSchema,budgetSummary} from '../lib/life/modules.ts';
import {validateBackup} from '../lib/life/migration-preview.ts';
import {AI_MODEL} from '../lib/life/ai-provider.ts';
const now=new Date('2026-09-16T12:00:00.000Z');
function fixture(t){
 const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+f,'utf8'));
 const state={beforeImport:null,rows:[{date:'2026-08-20',kind:'expense',amountCents:1234,note:'Synthetic grocery receipt',categoryId:null,warning:''},{date:'2026-09-10',kind:'transfer',amountCents:5000,note:'Synthetic card payment',categoryId:null,warning:''}]};
 const db={prepare(sql){return {bind(...params){return {async first(){return raw.prepare(sql).get(...params)||null;},async all(){if(sql.startsWith('WITH incoming')&&state.beforeImport){const hook=state.beforeImport;state.beforeImport=null;await hook();}return {results:raw.prepare(sql).all(...params)};}};}};}};
 const ai={enabled:true,userCapMicros:1000000,globalCapMicros:5000000,provider:{generate:async()=>({text:JSON.stringify({notes:'Review this synthetic source.',transactions:state.rows}),inputTokens:10,outputTokens:30,thoughtTokens:0,costMicros:100,providerId:'synthetic',modelVersion:AI_MODEL,finishReason:'STOP'})}};
 const call=(body,user='a',query='')=>handleLife(new Request('https://life.test/api/life'+query,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:'https://life.test'},body:body?JSON.stringify(body):undefined}),user,db,now,ai);
 const initial=budgetSchema.parse({currency:'USD',categories:[{id:randomUUID(),name:'Groceries',limitCents:0},{id:randomUUID(),name:'Travel',limitCents:0}],recurring:[],goals:{spending:'',saving:'',investing:''}});
 const setup=async(user='a')=>assert.equal((await call({action:'profile',profile:{goal:'Synthetic only',timezone:'UTC',modules:['money'],habits:[],version:0}},user)).status,200);
 const build=async(text='Synthetic receipt source for atomic transaction import.',user='a')=>{const response=await call({action:'budget-build',build:{requestId:randomUUID(),month:'2026-09',intent:'transactions',text,consent:true}},user,'?budget-build');assert.equal(response.status,200);return (await response.json()).build;};
 const review=build=>({requestId:randomUUID(),buildId:build.id,months:[...new Set(build.result.transactions.map(t=>t.date.slice(0,7)))].map(month=>({month,initial:structuredClone(initial),categories:[]})),transactions:build.result.transactions.map(row=>({id:row.id,version:0,data:transactionSchema.parse({date:row.date,kind:row.kind,amountCents:row.amountCents,categoryId:row.kind==='expense'?initial.categories[0].id:'',note:row.note,recurringId:null,voided:false})}))});
 const save=(input,user='a')=>call({action:'transaction-import',import:input},user,'?transaction-import');
 const resources=()=>raw.prepare('SELECT * FROM life_resources ORDER BY user_id,kind,resource_id').all();
 return {raw,db,state,call,setup,build,review,save,initial,resources};
}
test('reviewed transactions initialize historical months atomically and transfers never inflate spending',async t=>{
 const f=fixture(t);await f.setup();const input=f.review(await f.build()),newCategory={id:randomUUID(),name:'Receipts',limitCents:25000,archived:false};input.months[0].categories=[newCategory];input.transactions[0].data.categoryId=newCategory.id;
 const response=await f.save(input);assert.equal(response.status,200);const saved=await response.json();assert.equal(saved.records.length,2);assert.equal(saved.plans.length,2);assert.equal(saved.records.find(r=>r.id===input.transactions[0].id).data.categoryName,'Receipts');
 assert.equal(saved.plans.find(p=>p.id==='2026-08').data.categories[2].limitCents,25000);assert.equal(saved.plans.every(p=>!p.data.recurring.length),true);
 assert.equal(budgetSummary(saved.plans[0].data,saved.records,'2026-08').expenses,1234);assert.equal(budgetSummary(saved.plans[1].data,saved.records,'2026-09').expenses,0);
 const receipt=f.resources().find(r=>r.kind==='transaction-import');assert.equal(receipt.resource_id,input.buildId);assert.doesNotMatch(receipt.payload,/Synthetic|Receipts|1234|5000/);
});
test('lost acknowledgements retry once and remain safe after later edits, category changes and Trash purge',async t=>{
 const f=fixture(t);await f.setup();const input=f.review(await f.build());assert.equal((await f.save(input)).status,200);const before=f.resources();const retry=await f.save(input);assert.equal(retry.status,200);assert.equal((await retry.json()).alreadyImported,true);assert.deepEqual(f.resources(),before);
 const tx=JSON.parse(before.find(r=>r.kind==='transaction').payload),id=before.find(r=>r.kind==='transaction').resource_id;
 assert.equal((await f.call({action:'resource',record:{kind:'transaction',id,version:1,data:{...tx,note:'Corrected after import',deleted:true}}})).status,200);
 let replay=await (await f.save(input)).json();assert.equal(replay.records.find(r=>r.id===id).data.deleted,true);assert.equal(replay.records.find(r=>r.id===id).version,2);
 const trash=f.raw.prepare("SELECT * FROM life_trash WHERE user_id='a' AND kind='transaction' AND record_id=?").get(id);
 assert.equal((await f.call({action:'trash',change:{kind:'transaction',id,deletedAt:trash.deleted_at,operation:'purge'}})).status,200);
 replay=await (await f.save(input)).json();assert.deepEqual(replay.missingTransactionIds,[id]);assert.equal(replay.records.some(r=>r.id===id),false);
 const changed=structuredClone(input);changed.transactions[0].data.amountCents++;assert.equal((await f.save(changed)).status,409);
 assert.equal((await f.save({...input,requestId:randomUUID()})).status,409);
});
test('a failure on any row rolls back every transaction, new category, month and receipt',async t=>{
 const f=fixture(t);await f.setup();const input=f.review(await f.build());
 f.raw.exec(`CREATE TRIGGER synthetic_import_failure BEFORE INSERT ON life_resources WHEN NEW.kind='transaction' AND NEW.resource_id='${input.transactions[1].id}' BEGIN SELECT RAISE(ABORT,'Synthetic write failure'); END;`);
 assert.equal((await f.save(input)).status,503);assert.deepEqual(f.resources(),[]);
 f.raw.exec('DROP TRIGGER synthetic_import_failure');assert.equal((await f.save(input)).status,200);assert.equal(f.resources().length,5);
});
test('unrelated category edits merge and an intervening version change retries the entire import',async t=>{
 const f=fixture(t);await f.setup();const input=f.review(await f.build());const month=input.months[0];
 assert.equal((await f.call({action:'budget-item',change:{kind:'initialize',month:month.month,initial:month.initial}})).status,200);
 const c=month.initial.categories[1],edited={...c,name:'Trips',limitCents:22222};
 f.state.beforeImport=async()=>assert.equal((await f.call({action:'budget-item',change:{kind:'category',month:month.month,previous:c,item:edited}})).status,200);
 const saved=await f.save(input);assert.equal(saved.status,200);const result=await saved.json();assert.deepEqual(result.plans.find(p=>p.id===month.month).data.categories[1],edited);assert.equal(f.resources().filter(r=>r.kind==='transaction').length,2);
});
test('selected-category rename or archive conflicts reject the batch without saving other months',async t=>{
 for(const change of [{name:'Changed category'},{archived:true}]){
  const f=fixture(t);await f.setup();const input=f.review(await f.build()),m=input.months[0],c=m.initial.categories[0];await f.call({action:'budget-item',change:{kind:'initialize',month:m.month,initial:m.initial}});await f.call({action:'budget-item',change:{kind:'category',month:m.month,previous:c,item:{...c,...change}}});
  const before=f.resources();assert.equal((await f.save(input)).status,409);assert.deepEqual(f.resources(),before);
 }
});
test('review cannot use another account build, fabricate draft row identities or repeat a row',async t=>{
 const f=fixture(t);await f.setup();await f.setup('b');const input=f.review(await f.build());assert.equal((await f.save(input,'b')).status,409);assert.equal((await f.save(input,null)).status,401);
 const wrong=structuredClone(input);wrong.transactions[0].id=randomUUID();assert.equal((await f.save(wrong)).status,400);
 assert.equal((await f.save({...input,transactions:[...input.transactions,input.transactions[0]]})).status,400);
 assert.equal((await f.save({...input,months:[...input.months,input.months[0]]})).status,400);assert.deepEqual(f.resources(),[]);
});
test('actual amounts and dates need review; import cannot create future, recurring, allocation or planned entries',async t=>{
 const f=fixture(t);await f.setup();const input=f.review(await f.build());
 for(const patch of [{amountCents:0},{amountCents:-100},{date:'2026-10-01'},{kind:'saving',categoryId:''},{recurringId:randomUUID()},{planned:true},{voided:true},{deleted:true},{expectedDate:'2026-08-20'}]){const value=structuredClone(input);Object.assign(value.transactions[0].data,patch);assert.equal((await f.save(value)).status,400,JSON.stringify(patch));}
 const unassigned=structuredClone(input);unassigned.transactions[0].data.categoryId='';assert.equal((await f.save(unassigned)).status,409);
 const invented=structuredClone(input);invented.months[0].initial.categories[0].limitCents=500;assert.equal((await f.save(invented)).status,400);assert.deepEqual(f.resources(),[]);
});
test('retired draft row identity or a hidden source cannot resurrect data or partially initialize a month',async t=>{
 const f=fixture(t);await f.setup();const input=f.review(await f.build());
 f.raw.prepare("INSERT INTO life_trash(user_id,kind,record_id,deleted_at,purged_at) VALUES('a','transaction',?,?,?)").run(input.transactions[0].id,now.toISOString(),now.toISOString());
 assert.equal((await f.save(input)).status,409);assert.deepEqual(f.resources(),[]);
 const f2=fixture(t);await f2.setup();const second=f2.review(await f2.build());assert.equal((await f2.call({action:'record-deletion',change:{kind:'build',id:'budget:'+second.buildId,deleted:true}})).status,200);assert.equal((await f2.save(second)).status,409);assert.equal(f2.resources().some(r=>r.kind==='transaction'||r.kind==='budget'),false);
});
test('same-source rebuild cannot duplicate a previous receipt and its opaque marker survives deleted transactions',async t=>{
 const f=fixture(t);await f.setup();const original=f.review(await f.build());assert.equal((await f.save(original)).status,200);const repeat=f.review(await f.build());assert.notEqual(repeat.transactions[0].id,original.transactions[0].id);const before=f.resources();assert.equal((await f.save(repeat)).status,409);assert.deepEqual(f.resources(),before);
 const builds=await (await f.call(null,'a','?budget-builds&summary=1')).json();assert.equal(builds.builds.find(b=>b.id===original.buildId).adopted,true);assert.equal(builds.builds.find(b=>b.id===repeat.buildId).adopted,false);
});
test('receipts export with current transactions and purged identities, cannot be edited and leave with account deletion',async t=>{
 const f=fixture(t);await f.setup();const input=f.review(await f.build());assert.equal((await f.save(input)).status,200);
 const receipt=f.resources().find(r=>r.kind==='transaction-import');assert.equal((await f.call({action:'resource',record:{kind:'transaction-import',id:receipt.resource_id,version:1,data:JSON.parse(receipt.payload)}})).status,400);
 const backup=await (await f.call(null,'a','?export')).text();assert.ok(validateBackup(backup));const damaged=JSON.parse(backup),damagedReceipt=damaged.resources.find(r=>r.kind==='transaction-import');damagedReceipt.payload=JSON.stringify({...JSON.parse(damagedReceipt.payload),transactionIds:[randomUUID()]});assert.throws(()=>validateBackup(JSON.stringify(damaged)),/invalid_import_row/);
 const record=(await (await f.save(input)).json()).records[0];await f.call({action:'resource',record:{kind:'transaction',...record,data:{...record.data,deleted:true},updatedAt:undefined}});
 const trash=f.raw.prepare("SELECT * FROM life_trash WHERE user_id='a' AND kind='transaction' AND record_id=?").get(record.id);assert.ok(trash);await f.call({action:'trash',change:{kind:'transaction',id:record.id,deletedAt:trash.deleted_at,operation:'purge'}});assert.ok(validateBackup(await (await f.call(null,'a','?export')).text()));
 f.raw.prepare('INSERT INTO life_account_deletions VALUES(?,?)').run('a',now.toISOString());assert.deepEqual(f.resources(),[]);assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM life_ai_usage WHERE user_id='a'").get().n,1);assert.equal((await f.save(input)).status,400);
});
test('dedicated import endpoint refuses unrelated actions and bounded payloads',async t=>{
 const f=fixture(t);await f.setup();assert.equal((await f.call({action:'profile',profile:{}},'a','?transaction-import')).status,400);assert.equal((await f.call({action:'transaction-import',import:{padding:'x'.repeat(262144)}},'a','?transaction-import')).status,413);
});
