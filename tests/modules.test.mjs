import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { handleLife } from '../lib/life/service.ts';
import { profileSchema } from '../lib/life/domain.ts';
import { parseMoney,budgetSummary,dueDate,occurrenceId,nextSet,restRemaining } from '../lib/life/modules.ts';
import { buildReviewContext } from '../lib/life/review-context.ts';
const now=new Date('2026-09-09T12:00:00Z'),cat=randomUUID(),rec=randomUUID(),exercise=randomUUID(),routineId=randomUUID();
const profile={goal:'Synthetic goals',timezone:'UTC',modules:['reflection','money','fitness','spiritual'],moduleGoals:{money:'Build a buffer',fitness:'Track consistency',spiritual:'Reflect within my chosen tradition'},spiritualTradition:'User defined',habits:[],version:0};
const budget={currency:'USD',categories:[{id:cat,name:'Food',limitCents:30000}],recurring:[{id:rec,title:'Monthly plan',kind:'expense',amountCents:5000,categoryId:cat,day:9,active:true}],goals:{spending:'Stay within my plan',saving:'Build a buffer',investing:'Define a long-term target'}};
const routine={name:'Synthetic split',preferences:'Available equipment',archived:false,exercises:[{id:exercise,name:'Example lift',sets:2,reps:10,load:20,unit:'kg',restSeconds:90}]};
function fixture(){const raw=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+f,'utf8'));const db={prepare(sql){return{bind(...params){const q=raw.prepare(sql);return{async first(){return q.get(...params)||null;},async all(){return{results:q.all(...params)};}};}};}};return{raw,db};}
async function call(db,body,id='a',path=''){return handleLife(new Request('https://life.test/api/life'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json',Origin:'https://life.test'}:undefined,body:body?JSON.stringify(body):undefined}),id,db,now);}
async function setup(db){assert.equal((await call(db,{action:'profile',profile})).status,200);}
async function save(db,kind,id,data,version=0,user='a'){return call(db,{action:'resource',record:{kind,id,data,version}},user);}
const tx=(extra={})=>({date:'2026-09-09',kind:'expense',amountCents:1234,categoryId:cat,categoryName:'',note:'Synthetic groceries',recurringId:null,voided:false,...extra});
const workout=()=>({date:'2026-09-09',routineId,name:routine.name,exercises:routine.exercises,sets:[],restUntil:null,finishedAt:null});

test('money uses exact cents, recurrence handles leap years, missing months are rejected',()=>{
 assert.equal(parseMoney('0.10')+parseMoney('0.20'),30);assert.equal(parseMoney('1000.09'),100009);
 for(const v of ['1.005','-2','NaN','1e4','1000001',''])assert.throws(()=>parseMoney(v));
 assert.equal(dueDate('2028-02',31),'2028-02-29');assert.equal(dueDate('2026-02',31),'2026-02-28');assert.equal(dueDate('2026-04',31),'2026-04-30');assert.throws(()=>dueDate('2026-13',1));
});
test('budget separates planned from actual, transfers and voids; a scheduled payment consumes allowance once',()=>{
 const pending=budgetSummary(budget,[],'2026-09');assert.equal(pending.categories[0].remaining,30000);assert.equal(pending.categories[0].afterScheduled,25000);
 const actual={id:occurrenceId('2026-09',rec),version:1,data:tx({amountCents:5500,recurringId:rec})};
 const income={id:randomUUID(),version:1,data:tx({kind:'income',categoryId:'',amountCents:50000})};
 const saving={id:randomUUID(),version:1,data:tx({kind:'saving',categoryId:'',amountCents:10000})};
 const out=budgetSummary(budget,[actual,income,saving],'2026-09');assert.equal(out.categories[0].remaining,24500);assert.equal(out.categories[0].scheduled,0);assert.equal(out.cashFlow,34500);
 assert.equal(budgetSummary(budget,[{...actual,data:{...actual.data,voided:true}}],'2026-09').categories[0].remaining,30000);
 assert.equal(budgetSummary(budget,[actual],'2026-08').expenses,0);
});
test('new profile fields default for older accounts and section goals survive reload',async()=>{
 const old=profileSchema.parse({...profile,moduleGoals:undefined,spiritualTradition:undefined});assert.deepEqual(old.moduleGoals,{});assert.equal(old.timezoneMode,'automatic');
 const {db,raw}=fixture();try{await setup(db);const p=(await (await call(db,null)).json()).profile;assert.equal(p.moduleGoals.money,'Build a buffer');assert.equal(p.spiritualTradition,'User defined');}finally{raw.close();}
});
test('module records persist, exact retries do not duplicate, other accounts cannot see or overwrite them',async()=>{
 const {db,raw}=fixture();try{await setup(db);assert.equal((await save(db,'budget','2026-09',budget)).status,200);const id=randomUUID();const response=await save(db,'transaction',id,tx());assert.equal(response.status,200);const first=(await response.json()).record;assert.equal(first.data.categoryName,'Food');
 assert.equal((await save(db,'transaction',id,tx())).status,200);assert.equal((await (await call(db,null,'a','?kind=transaction&month=2026-09')).json()).records.length,1);
 assert.equal((await save(db,'transaction',id,tx({amountCents:4000}))).status,409);
 assert.equal((await call(db,{action:'profile',profile},'b')).status,200);assert.equal((await (await call(db,null,'b','?kind=transaction&month=2026-09&userId=a')).json()).records.length,0);
 assert.equal((await save(db,'transaction',id,tx(),0,'b')).status,400);
 assert.equal((await call(db,null,null,'?kind=budget')).status,401);
 }finally{raw.close();}
});
test('scheduled occurrence has one stable record and supports void/correction without double counting',async()=>{
 const {db,raw}=fixture();try{await setup(db);await save(db,'budget','2026-09',budget);const id=occurrenceId('2026-09',rec),data=tx({recurringId:rec,amountCents:5000});
 assert.equal((await save(db,'transaction',randomUUID(),data)).status,400);
 const first=(await (await save(db,'transaction',id,data)).json()).record;
 assert.equal((await save(db,'transaction',id,data)).status,200);
 assert.equal((await save(db,'transaction',id,{...first.data,voided:true},first.version)).status,200);
 assert.equal((await save(db,'transaction',id,{...first.data,voided:false},2)).status,200);
 const records=(await (await call(db,null,'a','?kind=transaction&month=2026-09')).json()).records;assert.equal(records.length,1);assert.equal(budgetSummary(budget,records,'2026-09').expenses,5000);
 assert.equal((await save(db,'transaction',randomUUID(),tx({date:'2026-09-10'}))).status,400);
 assert.equal((await save(db,'transaction',randomUUID(),tx({amountCents:12.34}))).status,400);
 }finally{raw.close();}
});
test('workout preserves routine snapshot, only one active session, sets save once and resume after reload',async()=>{
 const {db,raw}=fixture();try{await setup(db);await save(db,'routine',routineId,routine);const id=randomUUID();let response=await save(db,'workout',id,workout());assert.equal(response.status,200,await response.clone().text());let saved=(await response.json()).record;
 assert.equal((await save(db,'workout',randomUUID(),workout())).status,409);
 const data={...saved.data,sets:[{exerciseId:exercise,setNumber:1,reps:9,load:22.5,completedAt:now.toISOString()}],restUntil:new Date(now.valueOf()+90000).toISOString()};
 response=await save(db,'workout',id,data,saved.version);assert.equal(response.status,200);saved=(await response.json()).record;
 assert.equal((await save(db,'workout',id,data,1)).status,200);
 assert.equal((await save(db,'workout',id,{...data,sets:[...data.sets,...data.sets]},2)).status,400);
 assert.equal((await save(db,'workout',id,{...data,exercises:[{...routine.exercises[0],name:'Changed'}]},2)).status,400);
 await save(db,'routine',routineId,{...routine,name:'Renamed'},1);
 const records=(await (await call(db,null,'a','?kind=workout')).json()).records;assert.equal(records[0].data.name,'Synthetic split');assert.equal(nextSet(records[0].data).setNumber,2);assert.equal(restRemaining(records[0].data.restUntil,now.valueOf()+31000),59);assert.equal(restRemaining(records[0].data.restUntil,now.valueOf()+100000),0);
 assert.equal((await save(db,'workout',id,{...saved.data,finishedAt:now.toISOString(),restUntil:null},saved.version)).status,200);
 assert.equal((await save(db,'workout',randomUUID(),{...workout(),name:'Renamed'})).status,200);
 }finally{raw.close();}
});
test('review context uses section goals, actual dated evidence, missing-data limits and opt-in spiritual context',()=>{
 const p=profileSchema.parse(profile);const entries=[{date:'2026-09-09',journal:'Synthetic journal',complete:true,context:{spiritual:'Synthetic reflection',work:'Disabled field'},habits:[],version:1}];
 const context=buildReviewContext({profile:p,from:'2026-09-03',through:'2026-09-09',entries});assert.equal(context.coverage.unrecordedDays,6);assert.equal(context.sections.find(s=>s.id==='spiritual').tradition,'User defined');assert.equal(context.entries[0].context.work,undefined);assert.match(context.coverage.interpretation,/unknown/);assert.ok(context.rules.some(r=>r.includes('correlation')));
 const secular=buildReviewContext({profile:{...p,modules:['reflection']},from:'2026-09-09',through:'2026-09-09',entries});assert.equal(secular.sections.length,1);assert.equal(secular.entries[0].context.spiritual,undefined);assert.equal(secular.money,null);
});

test('finishing a check-in requires explicit habit resolutions and a journal; drafts remain saveable',async()=>{
 const {db,raw}=fixture();try{await setup(db);
 const entry={date:'2026-09-09',journal:'',context:{},statuses:[],version:0,complete:true};
 assert.equal((await call(db,{action:'entry',entry})).status,400);
 assert.equal((await call(db,{action:'entry',entry:{...entry,complete:false}})).status,200);
 const saved=await call(db,{action:'entry',entry:{...entry,journal:'A synthetic complete day.',version:1}});assert.equal(saved.status,200);assert.equal((await saved.json()).entry.complete,true);
 }finally{raw.close();}
});
