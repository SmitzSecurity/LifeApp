import assert from 'node:assert/strict';
import test,{after,before} from 'node:test';
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
const mf=new Miniflare({modules:true,modulesRules:[{type:'ESModule',include:['**/*.js']}],scriptPath:'dist/server/index.js',compatibilityDate:'2026-05-22',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],serviceBindings:{ASSETS:async()=>new Response('Not found',{status:404})}});
after(()=>mf.dispose());
before(async()=>{const db=await mf.getD1Database('DB');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+f,'utf8').split('--> statement-breakpoint'))await db.prepare(sql.trim()).run();});
const headers={accept:'text/html','oai-authenticated-user-id':'synthetic-user','oai-authenticated-user-email':'demo@example.test'};
test('protected home initiates sign-in and anonymous API denies access',async()=>{
 const home=await mf.dispatchFetch('https://life.test/',{headers:{accept:'text/html'},redirect:'manual'});
 assert.ok([302,303,307,308].includes(home.status));assert.match(home.headers.get('location')||'',/signin-with-chatgpt/);
 const api=await mf.dispatchFetch('https://life.test/api/life');assert.equal(api.status,401);
});
test('signed-in home serves the LifeApp client shell with its own metadata',async()=>{
 const r=await mf.dispatchFetch('https://life.test/',{headers});assert.equal(r.status,200);
 const html=await r.text();assert.match(html,/LifeApp/);assert.doesNotMatch(html,/Starter Project/);assert.doesNotMatch(html,/codex-preview/);
});
test('Worker API writes and reloads a private profile through the D1 binding',async()=>{
 const profile={goal:'Synthetic worker smoke test',timezone:'America/New_York',modules:['reflection'],habits:[],version:0};
 const saved=await mf.dispatchFetch('https://life.test/api/life',{method:'POST',headers:{...headers,'Content-Type':'application/json',Origin:'https://life.test'},body:JSON.stringify({action:'profile',profile})});assert.equal(saved.status,200,await saved.clone().text());
 const read=await mf.dispatchFetch('https://life.test/api/life',{headers});assert.equal(read.status,200);assert.equal((await read.json()).profile.goal,profile.goal);
 const other=await mf.dispatchFetch('https://life.test/api/life',{headers:{...headers,'oai-authenticated-user-id':'other-synthetic-user'}});assert.equal((await other.json()).profile,null);
});

test('compiled Worker persists new section data and enforces completion through actual D1 routes',async()=>{
 const auth={...headers,'oai-authenticated-user-id':'module-worker-test','Content-Type':'application/json',Origin:'https://life.test'};
 async function post(body){return mf.dispatchFetch('https://life.test/api/life',{method:'POST',headers:auth,body:JSON.stringify(body)});}
 const profile={goal:'Synthetic module test',timezone:'UTC',modules:['money','fitness'],habits:[],version:0};
 assert.equal((await post({action:'profile',profile})).status,200);
 const budget={currency:'USD',categories:[],recurring:[],goals:{spending:'',saving:'',investing:''}};
 const saved=await post({action:'resource',record:{kind:'budget',id:'2026-09',version:0,data:budget}});assert.equal(saved.status,200,await saved.clone().text());
 const read=await mf.dispatchFetch('https://life.test/api/life?kind=budget',{headers:auth});assert.equal((await read.json()).records[0].data.currency,'USD');
 const invalid=await post({action:'entry',entry:{date:'2026-01-01',journal:'',context:{},statuses:[],version:0,complete:true}});assert.equal(invalid.status,400);
 const other=await mf.dispatchFetch('https://life.test/api/life?kind=budget',{headers:{...auth,'oai-authenticated-user-id':'other-module-test'}});assert.deepEqual((await other.json()).records,[]);
});

test('compiled Worker exposes disabled AI status without a key and protects the review route',async()=>{
 const anonymous=await mf.dispatchFetch('https://life.test/api/life?ai=1');assert.equal(anonymous.status,401);
 const r=await mf.dispatchFetch('https://life.test/api/life?ai=1&date=2026-09-08',{headers});assert.equal(r.status,200);
 const data=await r.json();assert.equal(data.available,false);assert.deepEqual(data.reports,[]);assert.equal(data.customerBilling,false);assert.equal(data.usage.capMicros,1000000);
 const generated=await mf.dispatchFetch('https://life.test/api/life',{method:'POST',headers:{...headers,'Content-Type':'application/json',Origin:'https://life.test'},body:JSON.stringify({action:'ai',review:{date:'2026-09-08',requestId:crypto.randomUUID(),sourceVersion:1,predecessorId:null,critique:'',consent:true}})});assert.equal(generated.status,503);
});
