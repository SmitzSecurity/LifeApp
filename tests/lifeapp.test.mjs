import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleLife } from '../lib/life/service.ts';
import { score, todayIn, emptyEntry } from '../lib/life/domain.ts';
const now=new Date('2026-09-09T12:00:00Z');
const habitId='a673c27b-169f-4d96-9e85-9a2b7d0b8c74';
const profile={goal:'Make time for reading',timezone:'America/New_York',modules:['reflection'],habits:[{id:habitId,title:'Read for 10 minutes',module:'reflection',archived:false}],version:0};
function database() {
 const raw = new DatabaseSync(':memory:');
 for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+f,'utf8'));
 const db = {
  prepare(sql) {
   return {
    bind(...params) {
     const q = raw.prepare(sql);
     return {
      async first() { return q.get(...params) || null; },
      async all() { return { results: q.all(...params) }; }
     };
    }
   };
  }
 };
 return { raw, db };
}
function request(body,path='',origin='https://life.test'){return new Request('https://life.test/api/life'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json',Origin:origin}:undefined,body:body?JSON.stringify(body):undefined});}
async function call(db,id,body,path=''){return handleLife(request(body,path),id,db,now);}
async function setup(db,id='user-a'){const r=await call(db,id,{action:'profile',profile});assert.equal(r.status,200);return (await r.json()).profile;}
function input(status='done',version=0){return {date:'2026-09-09',journal:'A synthetic day of reading.',context:{},statuses:[{id:habitId,status}],version};}

test('scores only explicit done/missed; exemption and missing are not failures',()=>{
assert.deepEqual(score(['done','missed','exempt','unrecorded'].map(status=>({status}))),{done:1,missed:1,exempt:1,unrecorded:1,eligible:2,percent:50});
assert.equal(score([{status:'missed'}]).percent,0);
assert.equal(score([{status:'exempt'},{status:'unrecorded'}]).percent,null);
assert.equal(score([]).percent,null);
assert.equal(emptyEntry({...profile,habits:[]},'2026-09-09').habits.length,0);
});
test('local calendar day handles UTC boundaries and daylight saving',()=>{
assert.equal(todayIn('America/New_York',new Date('2026-09-09T02:00:00Z')),'2026-09-08');
assert.equal(todayIn('Pacific/Auckland',new Date('2026-09-09T12:30:00Z')),'2026-09-10');
assert.equal(todayIn('America/New_York',new Date('2026-11-01T05:30:00Z')),'2026-11-01');
});
test('anonymous requests fail before any database access',async()=>{
assert.equal((await call({prepare(){throw Error('must not read')}},null)).status,401);
});
test('onboarding and check-ins persist, edit in place, and reload from SQL',async()=>{
const {db,raw}=database();await setup(db);
const r=await call(db,'user-a',{action:'entry',entry:input()});assert.equal(r.status,200);assert.equal((await r.json()).summary.percent,100);
const state=await (await call(db,'user-a')).json();assert.equal(state.profile.goal,profile.goal);assert.equal(state.entries[0].journal,input().journal);
const update=await call(db,'user-a',{action:'entry',entry:{...input('missed',1),journal:'Edited synthetic note'}});assert.equal(update.status,200);
assert.equal((await update.json()).summary.percent,0);
assert.equal(raw.prepare('SELECT COUNT(*) n FROM life_entries').get().n,1);
const reread=await (await call(db,'user-a',undefined,'?date=2026-09-09')).json();assert.equal(reread.entry.journal,'Edited synthetic note');assert.equal(reread.entry.version,2);
raw.close();
});
test('two users cannot read or overwrite each other, including forged body/query ids',async()=>{
const {db,raw}=database();await setup(db);await call(db,'user-a',{action:'entry',entry:input()});
const b=await (await call(db,'user-b',undefined,'?userId=user-a')).json();assert.equal(b.profile,null);assert.deepEqual(b.entries,[]);
assert.equal((await (await call(db,'user-b',undefined,'?date=2026-09-09&userId=user-a')).json()).entry,null);
await setup(db,'user-b');await call(db,'user-b',{action:'entry',userId:'user-a',entry:{...input('missed'),journal:'B only'}});
const a=await (await call(db,'user-a')).json();assert.equal(a.entries[0].journal,input().journal);assert.equal(a.entries[0].habits[0].status,'done');raw.close();
});
test('stale writes and duplicate initial saves cannot replace newer work',async()=>{
const {db,raw}=database();await setup(db);assert.equal((await call(db,'user-a',{action:'profile',profile})).status,409);
await call(db,'user-a',{action:'entry',entry:input()});assert.equal((await call(db,'user-a',{action:'entry',entry:input('missed')})).status,409);
const pair=await Promise.all([call(db,'user-a',{action:'entry',entry:input('missed',1)}),call(db,'user-a',{action:'entry',entry:input('exempt',1)})]);assert.deepEqual(pair.map(r=>r.status).sort(),[200,409]);raw.close();
});
test('archiving or renaming a habit preserves its saved snapshots',async()=>{
const {db,raw}=database();const p=await setup(db);await call(db,'user-a',{action:'entry',entry:input()});
const change={...p,habits:[{...p.habits[0],title:'Read something else',archived:true}]};assert.equal((await call(db,'user-a',{action:'profile',profile:change})).status,200);
const edit=await call(db,'user-a',{action:'entry',entry:input('missed',1)});assert.equal(edit.status,200);assert.equal((await edit.json()).entry.habits[0].title,'Read for 10 minutes');
const newDay={...input(),date:'2026-09-08',statuses:[]};assert.equal((await call(db,'user-a',{action:'entry',entry:newDay})).status,200);
assert.equal((await call(db,'user-a',{action:'profile',profile:{...change,version:2,habits:[]}})).status,400);raw.close();
});
test('invalid dates, timezone, unadopted habits, cross-origin writes and oversized notes are rejected',async()=>{
const {db,raw}=database();assert.equal((await call(db,'user-a',{action:'profile',profile:{...profile,timezone:'invalid'}})).status,400);await setup(db);
for(const date of ['2026-02-30','not-a-date','2026-09-10'])assert.equal((await call(db,'user-a',{action:'entry',entry:{...input(),date}})).status,400);
assert.equal((await call(db,'user-a',{action:'entry',entry:{...input(),journal:'x'.repeat(6001)}})).status,400);
assert.equal((await call(db,'user-a',{action:'entry',entry:{...input(),statuses:[]}})).status,409);
assert.equal((await call(db,'user-a',{action:'entry',entry:{...input(),context:{spiritual:'Not enabled'}}})).status,400);
assert.equal((await handleLife(request({action:'entry',entry:input()},'','https://evil.test'),'user-a',db,now)).status,403);
assert.equal((await handleLife(new Request('https://life.test/api/life',{method:'POST',body:'{',headers:{'Content-Type':'application/json'}}),'user-a',db,now)).status,400);
raw.close();
});

test('private export includes all saved account records without auth credentials or other accounts',async()=>{
 const {db,raw}=database();await setup(db,'user-a');await setup(db,'user-b');
 await call(db,'user-a',{action:'entry',entry:input()});await call(db,'user-b',{action:'entry',entry:{...input(),journal:'OTHER ACCOUNT PRIVATE TEXT'}});
 const response=await call(db,'user-a',undefined,'?export=1');assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/attachment/);
 const backup=await response.json();assert.equal(backup.format,'lifeapp-portable-v1');assert.equal(backup.entries.length,1);assert.equal(JSON.parse(backup.entries[0].payload).journal,input().journal);
 assert.doesNotMatch(JSON.stringify(backup),/OTHER ACCOUNT PRIVATE TEXT|user_id|life_auth/);assert.equal((await call(db,null,undefined,'?export=1')).status,401);
 raw.prepare('UPDATE life_entries SET payload=? WHERE user_id=?').run('x'.repeat(5*1024*1024),'user-a');assert.equal((await call(db,'user-a',undefined,'?export=1')).status,413);raw.close();
});
