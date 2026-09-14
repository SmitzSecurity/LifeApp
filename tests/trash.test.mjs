import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {handleLife} from '../lib/life/service.ts';
import {purgeExpiredTrash} from '../lib/life/trash.ts';
import {validateBackup} from '../lib/life/migration-preview.ts';
import {AI_MODEL} from '../lib/life/ai-provider.ts';

const stamp='2026-09-14T12:00:00.000Z';
function fixture(t){
 const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+f,'utf8'));
 const db={prepare(sql){return {bind(...args){return {async first(){return raw.prepare(sql).get(...args)||null;},async all(){return {results:raw.prepare(sql).all(...args)};}};}};}};
 const state={now:new Date(stamp),calls:0,hook:null,finish:'STOP'};
 const ai={enabled:true,userCapMicros:2000000,globalCapMicros:5000000,provider:{async generate(){state.calls++;if(state.hook)await state.hook();return {text:'Synthetic useful analysis.',inputTokens:100,outputTokens:10,thoughtTokens:0,costMicros:200,providerId:'synthetic-private-provider-id',modelVersion:AI_MODEL,finishReason:state.finish};}}};
 const call=(body,user='a',path='')=>handleLife(new Request('https://life.test/api/life'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:'https://life.test'},body:body?JSON.stringify(body):undefined}),user,db,state.now,ai);
 const setup=async(user='a')=>{await call({action:'profile',profile:{goal:'Synthetic goal',timezone:'UTC',modules:['reflection','money','fitness'],habits:[],version:0}},user);await call({action:'entry',entry:{date:'2026-09-13',journal:'Synthetic private journal',context:{},statuses:[],complete:true,version:0}},user);};
 const cardio=async()=>{const record={kind:'cardio',id:randomUUID(),version:0,data:{date:'2026-09-14',activity:'run',minutes:30,distance:5,unit:'km',intensity:'moderate',note:'Synthetic cardio note',voided:false}};assert.equal((await call({action:'resource',record})).status,200);record.version=1;record.data.deleted=true;assert.equal((await call({action:'resource',record})).status,200);return record;};
 const list=async()=> (await (await call(null,'a','?trash')).json()).items;
 const change=(item,operation)=>({action:'trash',change:{kind:item.kind,id:item.id,deletedAt:item.deletedAt,operation}});
 const analysis=(previous=null)=>({action:'ai',review:{cadence:'daily',date:'2026-09-13',sourceVersion:1,requestId:randomUUID(),predecessorId:previous,critique:previous?'Keep it practical.':'',consent:true}});
 return {raw,db,state,call,setup,cardio,list,change,analysis};
}
test('organizer is disabled at the HTTP boundary without reserving or calling AI',async t=>{
 const f=fixture(t);await f.setup();assert.equal((await f.call({action:'workout-build',build:{requestId:randomUUID(),text:'Bench press 3 x 8 at 135 lb',consent:true}})).status,410);assert.equal(f.state.calls,0);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM life_ai_usage').get().n,0);
});
test('Trash is isolated, deletion age is stable, and Restore starts a fresh deletion window',async t=>{
 const f=fixture(t);await f.setup();await f.setup('b');const record=await f.cardio(),first=(await f.list())[0];assert.equal(first.expiresAt,'2026-09-21T12:00:00.000Z');assert.equal((await (await f.call(null,'b','?trash')).json()).items.length,0);
 f.state.now=new Date('2026-09-15T12:00:00.000Z');record.version=2;record.data.note='Changed while deleted';assert.equal((await f.call({action:'resource',record})).status,200);assert.equal((await f.list())[0].deletedAt,first.deletedAt);
 assert.equal((await f.call(f.change(first,'restore'),'b')).status,409);assert.equal((await f.call(f.change(first,'restore'))).status,200);assert.equal((await f.list()).length,0);
 record.version=4;assert.equal((await f.call({action:'resource',record})).status,200);const next=(await f.list())[0];assert.notEqual(next.deletedAt,first.deletedAt);assert.equal((await f.call(f.change(first,'purge'))).status,409);validateBackup(await (await f.call(null,'a','?export')).text());
});
test('permanent deletion removes content atomically, prevents stale resurrection, and permits exact purge retries',async t=>{
 const f=fixture(t);await f.setup();const record=await f.cardio(),item=(await f.list())[0];assert.equal((await f.call(f.change(item,'purge'))).status,200);assert.equal((await f.call(f.change(item,'purge'))).status,200);assert.equal((await f.call(f.change(item,'restore'))).status,410);
 assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM life_resources WHERE kind='cardio'").get().n,0);assert.equal((await f.list()).length,0);
 record.version=0;record.data.deleted=false;assert.equal((await f.call({action:'resource',record})).status,410);validateBackup(await (await f.call(null,'a','?export')).text());
 // An injected storage failure must roll back both the purge marker and content removal.
 const other=await f.cardio(),otherItem=(await f.list())[0];f.raw.exec("CREATE TRIGGER synthetic_failure BEFORE DELETE ON life_resources BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
 assert.equal((await f.call(f.change(otherItem,'purge'))).status,503);assert.equal(f.raw.prepare('SELECT purged_at FROM life_trash WHERE record_id=?').get(other.id).purged_at,null);assert.ok(f.raw.prepare('SELECT payload FROM life_resources WHERE resource_id=?').get(other.id));
});
test('seven-day cleanup has an exact boundary and preserves active items and unrelated accounts',async t=>{
 const f=fixture(t);await f.setup();const record=await f.cardio(),item=(await f.list())[0];
 assert.equal((await purgeExpiredTrash(f.db,new Date('2026-09-21T11:59:59.999Z'))).results.length,0);
 f.state.now=new Date(item.expiresAt);assert.equal((await f.call(f.change(item,'restore'))).status,410);
 assert.equal((await purgeExpiredTrash(f.db,f.state.now)).results.length,1);assert.equal((await purgeExpiredTrash(f.db,f.state.now)).results.length,0);
 assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM life_entries').get().n,1);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM life_profiles').get().n,1);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM life_resources WHERE resource_id=?').get(record.id).n,0);
});
test('journal purge removes text and prevents stale first-save resurrection',async t=>{
 const f=fixture(t);await f.setup();await f.call({action:'record-deletion',change:{kind:'entry',id:'2026-09-13',version:1,deleted:true}});const item=(await f.list())[0];assert.equal((await f.call(f.change(item,'purge'))).status,200);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM life_entries').get().n,0);
 assert.throws(()=>f.raw.prepare('INSERT INTO life_entries VALUES(?,?,?,?,?)').run('a','2026-09-13','{}',1,stamp),/permanently deleted/);validateBackup(await (await f.call(null,'a','?export')).text());
 const fresh=(await (await f.call(null,'a','?date=2026-09-13')).json()).entry;assert.equal(fresh.journal,'');assert.equal(fresh.version,3);
 const input={date:fresh.date,journal:'A genuinely new entry',context:{},statuses:[],complete:true,version:0};assert.equal((await f.call({action:'entry',entry:input})).status,409);
 input.version=fresh.version;assert.equal((await f.call({action:'entry',entry:input})).status,200);assert.equal(f.raw.prepare('SELECT version FROM life_entries').get().version,4);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM life_trash').get().n,0);validateBackup(await (await f.call(null,'a','?export')).text());
});
test('successful regeneration discards the prior text and input but keeps all costs; failure preserves the current analysis',async t=>{
 const f=fixture(t);await f.setup();const first=(await (await f.call(f.analysis())).json()).report;
 const second=(await (await f.call(f.analysis(first.id))).json()).report;assert.equal(second.status,'complete');const old=f.raw.prepare('SELECT * FROM life_ai_reviews WHERE request_id=?').get(first.id);assert.equal(old.report_text,null);assert.equal(old.critique,'');assert.deepEqual(JSON.parse(old.input_snapshot),{purged:true});assert.equal(old.cost_micros,200);assert.equal((await f.list()).length,0);
 assert.equal(JSON.parse(f.raw.prepare('SELECT input_snapshot FROM life_ai_reviews WHERE request_id=?').get(second.id).input_snapshot).previousReview,null);
 f.state.finish='MAX_TOKENS';await f.call(f.analysis(second.id));assert.ok(f.raw.prepare('SELECT report_text FROM life_ai_reviews WHERE request_id=?').get(second.id).report_text);assert.equal(f.raw.prepare('SELECT SUM(cost_micros) n FROM life_ai_usage').get().n,600);validateBackup(await (await f.call(null,'a','?export')).text());
});
test('purging an in-flight analysis discards the late output and settles cost without resurrecting content',async t=>{
 const f=fixture(t);await f.setup();f.state.hook=async()=>{await f.call({action:'record-deletion',change:{kind:'analysis',id:'daily:2026-09-13',deleted:true}});const item=(await f.list())[0];assert.equal((await f.call(f.change(item,'purge'))).status,200);};
 assert.equal((await f.call(f.analysis())).status,200);const row=f.raw.prepare('SELECT * FROM life_ai_reviews').get();assert.equal(row.report_text,null);assert.equal(row.provider_id,null);assert.equal(row.cost_micros,200);assert.deepEqual(JSON.parse(row.input_snapshot),{purged:true});assert.equal(f.state.calls,1);validateBackup(await (await f.call(null,'a','?export')).text());
});
test('recurring permanent deletion scrubs the item while retaining transaction identities and unrelated plan data',async t=>{
 const f=fixture(t);await f.setup();const c=randomUUID(),r=randomUUID(),plan={currency:'USD',categories:[{id:c,name:'Bills',limitCents:30000}],recurring:[{id:r,title:'Private electric bill',kind:'expense',amountCents:8000,categoryId:c,day:1,active:true}],goals:{spending:'Keep this goal',saving:'',investing:''}};
 assert.equal((await f.call({action:'resource',record:{kind:'budget',id:'2026-09',version:0,data:plan}})).status,200);
 assert.equal((await f.call({action:'resource',record:{kind:'transaction',id:'due:2026-09:'+r,version:0,data:{date:'2026-09-01',kind:'expense',amountCents:8300,categoryId:c,recurringId:r,note:'Paid actual bill',voided:false}}})).status,200);
 plan.recurring[0].deleted=true;assert.equal((await f.call({action:'resource',record:{kind:'budget',id:'2026-09',version:1,data:plan}})).status,200);const item=(await f.list())[0];assert.equal(item.kind,'recurring');assert.equal((await f.call(f.change(item,'purge'))).status,200);
 const saved=JSON.parse(f.raw.prepare("SELECT payload FROM life_resources WHERE kind='budget'").get().payload);assert.equal(saved.recurring[0].title,'Deleted item');assert.equal(saved.recurring[0].id,r);assert.equal(saved.recurring[0].categoryId,c);assert.equal(saved.recurring[0].purged,true);assert.equal(saved.goals.spending,plan.goals.spending);assert.equal(JSON.parse(f.raw.prepare("SELECT payload FROM life_resources WHERE kind='transaction'").get().payload).recurringId,r);
 saved.recurring[0].deleted=false;assert.equal((await f.call({action:'resource',record:{kind:'budget',id:'2026-09',version:3,data:saved}})).status,410);validateBackup(await (await f.call(null,'a','?export')).text());
});

test('permanently deleting an uncertain AI draft retains the hold and removes it during account deletion',async t=>{
 const f=fixture(t);await f.setup();f.state.hook=()=>{throw Error('Synthetic uncertain provider');};
 const id=randomUUID();await f.call({action:'routine-build',build:{requestId:id,text:'A synthetic full body program',consent:true}});
 await f.call({action:'record-deletion',change:{kind:'build',id:'routine:'+id,deleted:true}});const item=(await f.list())[0];assert.equal((await f.call(f.change(item,'purge'))).status,200);
 assert.equal(f.raw.prepare('SELECT reserved_micros FROM life_ai_usage').get().reserved_micros,200000);assert.equal(f.raw.prepare('SELECT cost_micros FROM life_ai_usage').get().cost_micros,null);assert.deepEqual(JSON.parse(f.raw.prepare('SELECT input_snapshot FROM life_routine_builds').get().input_snapshot),{purged:true});
 assert.equal((await f.call({action:'routine-build',build:{requestId:randomUUID(),text:'A different synthetic program',consent:true}})).status,429);assert.equal(f.state.calls,1);
 validateBackup(await (await f.call(null,'a','?export')).text());
 f.raw.prepare('INSERT INTO life_account_deletions(user_id,deleted_at) VALUES(?,?)').run('a',stamp);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM life_trash').get().n,0);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM life_profiles').get().n,0);assert.equal(f.raw.prepare('SELECT reserved_micros FROM life_ai_usage').get().reserved_micros,200000);
});
test('training regeneration replaces only the matching week and preserves a previous week',async t=>{
 const f=fixture(t);await f.setup();const cardio=await f.cardio();await f.call(f.change((await f.list())[0],'restore'));
 const run=()=>f.call({action:'training-analysis',build:{requestId:randomUUID(),consent:true}});
 const first=(await (await run()).json()).build;assert.equal(first.status,'complete');
 const previous='training:'+randomUUID();f.raw.prepare("INSERT INTO life_routine_builds(user_id,request_id,status,input_snapshot,result_json,model,price_version,reserved_micros,cost_micros,input_tokens,output_tokens,thought_tokens,provider_id,created_at,finished_at,error_code) SELECT user_id,?1,status,json_set(input_snapshot,'$.training.from','2026-09-07'),result_json,model,price_version,reserved_micros,cost_micros,input_tokens,output_tokens,thought_tokens,provider_id,'2026-09-13T12:00:00.000Z','2026-09-13T12:00:00.000Z',error_code FROM life_routine_builds WHERE request_id=?2").run(previous,'training:'+first.id);
 f.state.now=new Date('2026-09-14T12:01:00.000Z');const second=(await (await run()).json()).build;assert.equal(second.status,'complete');assert.equal(f.raw.prepare('SELECT result_json FROM life_routine_builds WHERE request_id=?').get('training:'+first.id).result_json,null);assert.ok(f.raw.prepare('SELECT result_json FROM life_routine_builds WHERE request_id=?').get('training:'+second.id).result_json);assert.ok(f.raw.prepare('SELECT result_json FROM life_routine_builds WHERE request_id=?').get(previous).result_json);validateBackup(await (await f.call(null,'a','?export')).text());
});
test('migration 0010 backfills deletion times without deleting existing content or changing accounting',t=>{
 const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')&&!f.startsWith('0010')).sort())raw.exec(readFileSync('drizzle/'+f,'utf8'));
 const id=randomUUID(),payload=JSON.stringify({date:'2026-09-01',activity:'run',minutes:20,distance:null,unit:'mi',intensity:'easy',note:'Preserved during installation',voided:false,deleted:true});
 raw.prepare('INSERT INTO life_resources VALUES(?,?,?,?,?,?,?,NULL)').run('a','cardio',id,'2026-09',payload,2,'2026-09-01T12:00:00.000Z');
 const before=raw.prepare('SELECT * FROM life_resources').all();raw.exec(readFileSync('drizzle/0010_central_trash.sql','utf8'));assert.deepEqual(raw.prepare('SELECT * FROM life_resources').all(),before);assert.equal(raw.prepare('SELECT deleted_at FROM life_trash').get().deleted_at,'2026-09-01T12:00:00.000Z');assert.equal(raw.prepare('SELECT purged_at FROM life_trash').get().purged_at,null);assert.equal(raw.prepare('SELECT COUNT(*) n FROM life_ai_usage').get().n,0);
});

test('entry purge keeps its separately saved analysis exportable without requiring deleted source text',async t=>{
 const f=fixture(t);await f.setup();await f.call(f.analysis());await f.call({action:'record-deletion',change:{kind:'entry',id:'2026-09-13',version:1,deleted:true}});assert.equal((await f.call(f.change((await f.list())[0],'purge'))).status,200);const backup=validateBackup(await (await f.call(null,'a','?export')).text());assert.equal(backup.entries.length,0);assert.equal(backup.reviews[0].report_text,'Synthetic useful analysis.');
});
