import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {handleLife} from '../lib/life/service.ts';

const now=new Date('2026-09-09T16:00:00Z');
const day=offset=>new Date(now.valueOf()-offset*86400000).toISOString().slice(0,10);
function fixture(t){
 const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+file,'utf8'));
 const db={prepare(sql){return {bind(...params){return {async first(){return raw.prepare(sql).get(...params)||null;},async all(){return {results:raw.prepare(sql).all(...params)};}};}};}};
 const seed=(offset,journal='Synthetic entry '+offset,complete=true,id='google:owner')=>raw.prepare('INSERT INTO life_entries VALUES(?,?,?,?,?)').run(id,day(offset),JSON.stringify({date:day(offset),journal,complete,context:{reflection:'Context-only marker'},habits:[],version:0}),7,now.toISOString());
 const request=(body,headers={})=>new Request('https://life.test/api/life',{method:'POST',headers:{Origin:'https://life.test','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 const search=(filters={},id='google:owner')=>handleLife(request({action:'history',filters}),id,db,now);
 const page=async filters=>{const response=await search(filters);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('vary'),'Cookie');return response.json();};
 const changes=()=>raw.prepare('SELECT total_changes() n').get().n;
 return {raw,db,seed,request,search,page,changes};
}

test('history reaches beyond 366 days with bounded, disjoint pages and preserves every row',async t=>{
 const f=fixture(t);for(let i=0;i<400;i++)f.seed(i);
 const before=f.changes(),dates=[];let cursor=null;
 do{
  const page=await f.page({before:cursor});assert.ok(page.entries.length<=30);
  dates.push(...page.entries.map(entry=>entry.date));cursor=page.nextCursor;
  for(const entry of page.entries){assert.equal(entry.version,7);assert.equal(entry.updatedAt,now.toISOString());}
 }while(cursor);
 assert.deepEqual(dates,Array.from({length:400},(_,i)=>day(i)));
 assert.equal(new Set(dates).size,400);assert.equal(f.changes(),before);
 const older=await handleLife(new Request('https://life.test/api/life?date='+day(399)),'google:owner',f.db,now);
 assert.equal((await older.json()).entry.journal,'Synthetic entry 399');
});

test('a newly saved day does not shift older history pages; exactly 30 results need no extra page',async t=>{
 const f=fixture(t);for(let i=1;i<=60;i++)f.seed(i);
 const first=await f.page();f.seed(0);
 const second=await f.page({before:first.nextCursor});
 assert.deepEqual([...first.entries,...second.entries].map(e=>e.date),Array.from({length:60},(_,i)=>day(i+1)));
 assert.equal(second.nextCursor,null);
 assert.equal((await f.page({from:day(30),through:day(1)})).nextCursor,null);
});

test('journal search combines inclusive dates and completion status, including legacy drafts',async t=>{
 const f=fixture(t);
 f.seed(1,'Morning reading',true);f.seed(2,'Evening READING',false);f.seed(3,'Reading older day',true);f.seed(4,'No matching words',true);f.seed(5,'Reading legacy draft',undefined);
 // A pre-completion-schema entry has no complete property.
 f.raw.prepare("UPDATE life_entries SET payload=json_remove(payload,'$.complete') WHERE entry_date=?").run(day(5));
 const before=f.changes();
 assert.deepEqual((await f.page({query:' reading ',from:day(3),through:day(1)})).entries.map(e=>e.date),[day(1),day(2),day(3)]);
 assert.deepEqual((await f.page({query:'reading',status:'complete'})).entries.map(e=>e.date),[day(1),day(3)]);
 assert.deepEqual((await f.page({query:'reading',status:'draft'})).entries.map(e=>e.date),[day(2),day(5)]);
 assert.deepEqual(await f.page({query:'Context-only marker'}),{entries:[],nextCursor:null});
 assert.equal(f.changes(),before);
});

test('search treats SQL wildcards literally and never exposes another account',async t=>{
 const f=fixture(t);f.seed(1,'Progress 100%_done \\ path');f.seed(2,'Progress 100percentXdone path');f.seed(3,"Text ' OR 1=1 -- here");
 f.seed(0,'OTHER ACCOUNT PRIVATE MARKER 100%_done',true,'google:other');
 const before=f.changes();
 for(const query of ['%','_','\\','100%_done'])assert.deepEqual((await f.page({query})).entries.map(e=>e.date),[day(1)]);
 assert.deepEqual((await f.page({query:"' OR 1=1 --"})).entries.map(e=>e.date),[day(3)]);
 assert.deepEqual(await f.page({query:'OTHER ACCOUNT PRIVATE MARKER'}),{entries:[],nextCursor:null});
 const forged=await handleLife(f.request({action:'history',filters:{},userId:'google:other'}),'google:owner',f.db,now);
 assert.equal(forged.status,200);assert.doesNotMatch(await forged.text(),/OTHER ACCOUNT PRIVATE MARKER/);
 assert.equal(f.changes(),before);
});

test('invalid filters and unauthenticated or cross-origin requests fail without writes',async t=>{
 const f=fixture(t);f.seed(1);const before=f.changes();
 for(const filters of [null,[],{query:'x'.repeat(201)},{from:'2026-02-30'},{from:day(1),through:day(2)},{before:'tomorrow'},{status:'pending'},{userId:'google:other'}])assert.equal((await f.search(filters)).status,400,JSON.stringify(filters));
 assert.equal((await f.search({},null)).status,401);
 for(const headers of [{Origin:'https://evil.test'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await handleLife(f.request({action:'history',filters:{}},headers),'google:owner',f.db,now)).status,403);
 assert.equal((await handleLife(f.request({action:'history',filters:{}},{'Content-Type':'text/plain'}),'google:owner',f.db,now)).status,415);
 assert.equal(f.changes(),before);
});
