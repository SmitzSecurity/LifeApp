import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {handleLife} from '../lib/life/service.ts';
import {budgetSchema,budgetSummary} from '../lib/life/modules.ts';
import {annualFundTarget} from '../lib/life/annual-fund.ts';
import {validateBackup} from '../lib/life/migration-preview.ts';

function fixture(t){
 const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+file,'utf8'));
 const db={prepare(sql){return {bind(...params){return {async first(){return raw.prepare(sql).get(...params)||null;},async all(){return {results:raw.prepare(sql).all(...params)};}};}};}};
 const call=(body,user='a',query='')=>handleLife(new Request('https://life.test/api/life'+query,{method:body?'POST':'GET',headers:{Origin:'https://life.test','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),user,db,new Date('2026-09-16T12:00:00Z'));
 const ok=async(body,user='a',query='')=>{const r=await call(body,user,query),v=await r.json();assert.equal(r.status,200,JSON.stringify(v));return v;};
 const setup=()=>ok({action:'profile',profile:{goal:'Synthetic savings goal',timezone:'UTC',modules:['money'],habits:[],version:0}});
 const save=({id,version,data})=>ok({action:'resource',record:{kind:'transaction',id,version,data}}).then(v=>v.record);
 return {raw,call,ok,setup,save};
}
test('annual fund opt-in merges only its setting, remembers decline and supports exact retries',async t=>{
 const f=fixture(t);await f.setup();
 const decline={action:'annual-fund-settings',change:{previous:null,item:{enabled:false}}};
 const first=(await f.ok(decline)).profile;assert.equal(first.annualFund.enabled,false);assert.equal(first.version,2);
 assert.equal((await f.ok(decline)).profile.version,2);
 await f.ok({action:'profile',profile:{...first,goal:'Changed goal'}});
 const enabled=(await f.ok({action:'annual-fund-settings',change:{previous:{enabled:false},item:{enabled:true}}})).profile;
 assert.equal(enabled.goal,'Changed goal');assert.equal(enabled.version,4);
 assert.equal((await f.call(decline)).status,409);
 assert.equal((await f.call(decline,null)).status,401);
});
test('annual target combines included full yearly amounts without creating monthly expenses',()=>{
 const category=randomUUID(),annual=(amountCents,extra={})=>({id:randomUUID(),title:'Annual bill',kind:'expense',amountCents,categoryId:category,frequency:'annual',month:12,day:1,...extra});
 const plan=budgetSchema.parse({currency:'USD',categories:[{id:category,name:'Bills',limitCents:10000}],goals:{spending:'',saving:'',investing:''},recurring:[annual(12000),annual(1000,{variable:true}),annual(5000,{excludeFromAnnualFund:true}),annual(6000,{deleted:true}),annual(7000,{active:false}),annual(8000,{endDate:'2026-08-31'}),annual(9000,{frequency:'monthly-day',month:undefined})]});
 const target=annualFundTarget(plan,'2026-09');assert.equal(target.annualCents,13000);assert.equal(target.monthlyCents,1084);assert.equal(target.items.length,2);assert.equal(target.estimated,true);
 assert.equal(budgetSummary(plan,[],'2026-09').expenses,0);
});
test('annual target excludes bills ending before their next renewal and keeps an inclusive final renewal',()=>{
 const category=randomUUID(),item=(frequency,endDate)=>({id:randomUUID(),title:'Synthetic renewal',kind:'expense',amountCents:12000,categoryId:category,frequency,month:12,day:1,startDate:'2026-01-01',endDate,...(frequency==='custom'?{custom:{unit:'years',interval:1}}:{})});
 const expired=item('annual','2026-10-01'),customExpired=item('custom','2026-11-30'),included=item('annual','2026-12-01');
 const plan=budgetSchema.parse({currency:'USD',categories:[{id:category,name:'Bills',limitCents:20000}],goals:{spending:'',saving:'',investing:''},recurring:[expired,customExpired,included]});
 const target=annualFundTarget(plan,'2026-09');assert.deepEqual(target.items.map(r=>r.id),[included.id]);assert.equal(target.annualCents,12000);assert.equal(target.monthlyCents,1000);
 assert.equal(annualFundTarget(plan,'2026-12').annualCents,12000);assert.equal(annualFundTarget(plan,'2027-01').annualCents,0);
});

test('annual target stops after the last eligible installment for annual and custom yearly schedules',()=>{
 const category=randomUUID(),item=frequency=>({id:randomUUID(),title:'Limited annual payments',kind:'expense',amountCents:12000,categoryId:category,frequency,month:10,day:15,startDate:'2025-10-15',installments:2,...(frequency==='custom'?{custom:{unit:'years',interval:1}}:{})});
 const plan=budgetSchema.parse({currency:'USD',categories:[{id:category,name:'Bills',limitCents:30000}],goals:{spending:'',saving:'',investing:''},recurring:[item('annual'),item('custom')]});
 assert.equal(annualFundTarget(plan,'2026-09').annualCents,24000);assert.equal(annualFundTarget(plan,'2026-10').annualCents,24000);
 for(const month of ['2026-11','2027-09','2027-10']){const target=annualFundTarget(plan,month);assert.equal(target.items.length,0);assert.equal(target.annualCents,0);assert.equal(target.monthlyCents,0);}
});

test('confirmed contributions and annual payments roll across months; deletion, correction and opt-out preserve history',async t=>{
 const f=fixture(t);await f.setup();
 const tx={date:'2026-08-15',kind:'saving',amountCents:5000,categoryId:'',note:'Annual fund contribution',recurringId:null,voided:false,annualFund:'contribution'};
 const contribution={id:randomUUID(),version:0,data:tx};
 assert.equal((await f.call({action:'resource',record:{kind:'transaction',...contribution}})).status,400);
 await f.ok({action:'annual-fund-settings',change:{previous:null,item:{enabled:true}}});
 let saved=await f.save(contribution);
 await f.save({id:randomUUID(),version:0,data:{...tx,date:'2026-09-16',amountCents:2000}});
 const planned=await f.save({id:randomUUID(),version:0,data:{...tx,date:'2026-09-15',amountCents:99000,planned:true,expectedDate:'2026-09-15'}});
 const category=randomUUID(),recurring=randomUUID();
 await f.ok({action:'resource',record:{kind:'budget',id:'2026-09',version:0,data:{currency:'USD',categories:[{id:category,name:'Bills',limitCents:10000}],goals:{spending:'',saving:'',investing:''},recurring:[{id:recurring,title:'Annual membership',kind:'expense',categoryId:category,amountCents:3000,frequency:'annual',month:9,day:1}]}}});
 let payment=await f.save({id:`due:2026-09:${recurring}`,version:0,data:{date:'2026-09-16',kind:'expense',amountCents:3000,categoryId:category,note:'Annual membership',recurringId:recurring,voided:false,annualFund:'payment'}});
 const balance=async(user='a',month='2026-09')=>(await f.ok(undefined,user,'?annual-fund&month='+month)).balance;
 assert.deepEqual(await balance(),{contributionsCents:7000,paymentsCents:3000,monthContributionsCents:2000,balanceCents:4000});
 assert.equal((await balance('b')).balanceCents,0);assert.equal((await balance('a','2026-08')).balanceCents,5000);
 payment=await f.save({...payment,data:{...payment.data,deleted:true}});assert.equal(payment.version,2);assert.equal(payment.data.deleted,true);assert.equal((await balance()).balanceCents,7000);
 saved=await f.save({...saved,data:{...saved.data,voided:true}});assert.equal((await balance()).balanceCents,2000);
 await f.ok({action:'annual-fund-settings',change:{previous:{enabled:true},item:{enabled:false}}});
 assert.equal((await f.call({action:'resource',record:{kind:'transaction',id:planned.id,version:planned.version,data:{...planned.data,planned:false}}})).status,400,'Opt-out blocks first confirmation of a pending fund contribution');
 saved=await f.save({...saved,data:{...saved.data,voided:false,amountCents:6000}});assert.equal(saved.version,3);assert.equal(saved.data.amountCents,6000);assert.equal((await balance()).balanceCents,8000);
 assert.equal((await f.call({action:'resource',record:{kind:'transaction',id:randomUUID(),version:0,data:{...tx,date:'2026-09-16'}}})).status,400);
 const backup=await (await f.call(undefined,'a','?export=1')).text();assert.doesNotThrow(()=>validateBackup(backup));
 assert.equal((await f.call(undefined,'a','?annual-fund&month=invalid')).status,400);
});
test('fund tags cannot turn income, card payments or monthly bills into fund withdrawals',async t=>{
 const f=fixture(t);await f.setup();await f.ok({action:'annual-fund-settings',change:{previous:null,item:{enabled:true}}});
 const base={date:'2026-09-16',amountCents:2000,categoryId:'',note:'Synthetic',recurringId:null,voided:false};
 for(const data of [{...base,kind:'income',annualFund:'contribution'},{...base,kind:'transfer',annualFund:'payment'},{...base,kind:'expense',annualFund:'payment'}])assert.equal((await f.call({action:'resource',record:{kind:'transaction',id:randomUUID(),version:0,data}})).status,400);
});
