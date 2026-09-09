import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {handleAccountDeletion} from '../lib/auth/delete-account.ts';
import {handleLife} from '../lib/life/service.ts';
import {generateAI} from '../lib/life/ai-service.ts';
import {AI_MODEL,RESERVATION_MICROS} from '../lib/life/ai-provider.ts';
const now=new Date('2026-09-09T16:00:00Z');
const env={LIFEAPP_AUTH_MODE:'google',BETTER_AUTH_URL:'https://life.test',BETTER_AUTH_SECRET:'synthetic-secret-'.repeat(4),GOOGLE_CLIENT_ID:'synthetic',GOOGLE_CLIENT_SECRET:'synthetic',LIFEAPP_BETA_EMAILS:'a@example.test,b@example.test'};
const profile={goal:'PRIVATE GOAL',timezone:'UTC',modules:['reflection'],habits:[],version:0};
const review={date:'2026-09-09',requestId:randomUUID(),sourceVersion:1,predecessorId:null,critique:'',consent:true};
const result={text:'PRIVATE AI REPORT',inputTokens:100,outputTokens:40,thoughtTokens:10,costMicros:225,providerId:'PRIVATE PROVIDER ID',modelVersion:AI_MODEL,finishReason:'STOP'};
const userTables=['life_profiles','life_entries','life_resources','life_ai_reviews','life_review_jobs','life_reminder_outbox','life_automatic_consent','life_period_consent'];
function fixture(){
 const raw=new DatabaseSync(':memory:');raw.exec('PRAGMA foreign_keys=ON');
 for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+f,'utf8'));
 const db={prepare(sql){return {bind(...params){return {async first(){return raw.prepare(sql).get(...params)||null;},async all(){return {results:raw.prepare(sql).all(...params)};}};}};}};
 const session=id=>({user:{id,email:id+'@example.test',emailVerified:true},session:{id:'session-'+id,createdAt:new Date(now.valueOf()-1000)}});
 const auth={api:{getSession:async()=>session('a')}};
 const req=(body={confirmation:'DELETE'},origin='https://life.test',method='POST')=>new Request('https://life.test/api/auth/delete-account',{method,headers:{Origin:origin,'Content-Type':'application/json'},body:method==='POST'?JSON.stringify(body):undefined});
 const remove=(request=req())=>handleAccountDeletion(request,auth,env,db,now);
 const settings={enabled:true,provider:{generate:async()=>result},userCapMicros:1000000,globalCapMicros:5000000};
 const life=(body,id='google:a')=>handleLife(new Request('https://life.test/api/life',{method:'POST',headers:{Origin:'https://life.test','Content-Type':'application/json'},body:JSON.stringify(body)}),id,db,now,settings);
 async function setup(id='a'){
  raw.prepare('INSERT INTO life_auth_user VALUES(?,?,?,1,NULL,?,?)').run(id,'PRIVATE NAME',id+'@example.test',now.valueOf(),now.valueOf());
  raw.prepare('INSERT INTO life_auth_session VALUES(?,?,?,?,?,?,?,?)').run('session-'+id,now.valueOf()+86400000,'PRIVATE TOKEN '+id,now.valueOf()-1000,now.valueOf(),'192.0.2.10','PRIVATE AGENT',id);
  raw.prepare('INSERT INTO life_auth_account(id,account_id,provider_id,user_id,access_token,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('account-'+id,'PRIVATE GOOGLE SUBJECT '+id,'google',id,'PRIVATE OAUTH TOKEN',now.valueOf(),now.valueOf());
  assert.equal((await life({action:'profile',profile},'google:'+id)).status,200);
  assert.equal((await life({action:'entry',entry:{date:'2026-09-09',journal:'PRIVATE JOURNAL '+id,context:{},statuses:[],version:0,complete:true}},'google:'+id)).status,200);
  raw.prepare('INSERT INTO life_resources VALUES(?,?,?,?,?,1,?,NULL)').run('google:'+id,'workout','synthetic-workout','2026-09',JSON.stringify({date:'2026-09-09',name:'PRIVATE RESOURCE',exercises:[],sets:[],finishedAt:null}),now.toISOString());
  raw.prepare('INSERT INTO life_review_jobs VALUES(?,?,?,?,?,1,NULL)').run('google:'+id,'2026-09-09',now.toISOString(),'UTC','08:00');
  raw.prepare('INSERT INTO life_reminder_outbox VALUES(?,?,?) ON CONFLICT DO NOTHING').run('google:'+id,'2026-09-09',now.toISOString());
  raw.prepare('INSERT INTO life_automatic_consent VALUES(?,1,1,?,?,?,?)').run('google:'+id,'daily-v1','2026-09-09',now.toISOString(),now.toISOString());
  raw.prepare('INSERT INTO life_period_consent VALUES(?,1,1,?,?,?,?,NULL)').run('google:'+id,'periods-v1','2026-09-09',now.toISOString(),now.toISOString());
 }
 return {raw,db,auth,session,req,remove,settings,life,setup};
}
function dump(raw){return raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(({name})=>[name,raw.prepare('SELECT * FROM '+name).all()]);}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}

test('deletion removes the signed-in account, all sessions and private records; another account is unchanged',async()=>{
 const f=fixture();try{
  await f.setup();await f.setup('b');
  assert.equal((await generateAI(f.db,'google:a',review,f.settings,now)).status,200);
  f.raw.prepare('INSERT INTO life_auth_session SELECT ?,expires_at,?,created_at,updated_at,ip_address,user_agent,user_id FROM life_auth_session WHERE user_id=?').run('second-a','PRIVATE SECOND TOKEN','a');
  const beforeB=userTables.map(t=>f.raw.prepare('SELECT * FROM '+t+' WHERE user_id=?').all('google:b'));
  assert.equal((await f.remove()).status,200);
  for(const t of userTables)assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM '+t+' WHERE user_id=?').get('google:a').n,0,t);
  for(const t of ['life_auth_user','life_auth_session','life_auth_account'])assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM '+t+' WHERE '+(t==='life_auth_user'?'id':'user_id')+'=?').get('a').n,0,t);
  assert.deepEqual(userTables.map(t=>f.raw.prepare('SELECT * FROM '+t+' WHERE user_id=?').all('google:b')),beforeB);
  const usage=f.raw.prepare('SELECT * FROM life_deleted_ai_usage').get();assert.equal(usage.cost_micros,225);assert.equal(usage.input_tokens,100);
  assert.doesNotMatch(JSON.stringify(usage),/PRIVATE|example.test|input_snapshot|report_text|provider_id/);
  assert.equal(f.raw.prepare('SELECT SUM(cost_micros) n FROM life_ai_usage').get().n,225);
  assert.equal((await f.remove()).status,401);
 }finally{f.raw.close();}
});
test('requires exact confirmation, same origin, verified permitted account and recent sign-in',async()=>{
 const f=fixture();try{
  await f.setup();const before=dump(f.raw);
  for(const body of [{confirmation:'delete'},{confirmation:'DELETE',userId:'b'},{},null,[]])assert.equal((await f.remove(f.req(body))).status,400);
  assert.equal((await f.remove(f.req(undefined,'https://evil.test'))).status,403);
  assert.equal((await f.remove(f.req(undefined,''))).status,403);
  assert.equal((await f.remove(f.req(undefined,undefined,'GET'))).status,404);
  f.auth.api.getSession=async()=>null;assert.equal((await f.remove()).status,401);
  f.auth.api.getSession=async()=>({...f.session('a'),user:{id:'a',email:'a@example.test',emailVerified:false}});assert.equal((await f.remove()).status,401);
  f.auth.api.getSession=async()=>({...f.session('a'),user:{id:'a',email:'not-allowed@example.test',emailVerified:true}});assert.equal((await f.remove()).status,401);
  f.auth.api.getSession=async()=>({...f.session('a'),session:{id:'session-a',createdAt:new Date(now.valueOf()-600001)}});const old=await f.remove();assert.equal(old.status,403);assert.equal((await old.json()).code,'reauthenticate');
  assert.deepEqual(dump(f.raw),before);
 }finally{f.raw.close();}
});
test('session revocation between authentication and delete prevents deletion; any trigger failure rolls back everything',async()=>{
 const f=fixture();try{
  await f.setup();await generateAI(f.db,'google:a',review,f.settings,now);
  f.auth.api.getSession=async()=>{f.raw.prepare('UPDATE life_auth_session SET expires_at=0 WHERE user_id=?').run('a');return f.session('a');};
  assert.equal((await f.remove()).status,401);assert.equal(f.raw.prepare('SELECT count(*) n FROM life_profiles').get().n,1);
  f.raw.prepare('UPDATE life_auth_session SET expires_at=?').run(now.valueOf()+10000);f.auth.api.getSession=async()=>f.session('a');
  const before=dump(f.raw);
  f.raw.exec("CREATE TRIGGER synthetic_failure BEFORE DELETE ON life_auth_user BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
  assert.equal((await f.remove()).status,503);assert.deepEqual(dump(f.raw),before);
 }finally{f.raw.close();}
});
test('stale writes cannot recreate private rows, jobs, consent, auth users or sessions after deletion',async()=>{
 const f=fixture();try{
  await f.setup();await generateAI(f.db,'google:a',review,f.settings,now);
  const tables=[...userTables,'life_auth_user','life_auth_session','life_auth_account'];
  const rows=tables.map(t=>[t,f.raw.prepare('SELECT * FROM '+t).get()]);
  assert.equal((await f.remove()).status,200);
  for(const [table,row] of rows){
   assert.ok(row,table);
   assert.throws(()=>f.raw.prepare('INSERT INTO '+table+'('+Object.keys(row).join(',')+') VALUES('+Object.keys(row).map(()=>'?').join(',')+')').run(...Object.values(row)),/Account has been deleted/,table);
  }
  assert.equal(f.raw.prepare('SELECT count(*) n FROM life_ai_reviews').get().n,0);
 }finally{f.raw.close();}
});
for(const outcome of ['complete','unknown','cost-bound'])test('deletion during an AI request preserves accounting: '+outcome,async()=>{
 const f=fixture(),pending=deferred();let calls=0;
 try{
  await f.setup();await f.setup('b');
  f.settings.globalCapMicros=RESERVATION_MICROS;
  f.settings.provider={generate:async()=>{calls++;return pending.promise;}};
  const generating=generateAI(f.db,'google:a',review,f.settings,now);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
  assert.equal((await f.remove()).status,200);
  assert.equal(f.raw.prepare('SELECT SUM(COALESCE(cost_micros,reserved_micros)) n FROM life_ai_usage').get().n,RESERVATION_MICROS);
  assert.equal((await generateAI(f.db,'google:b',review,f.settings,now)).status,429);
  if(outcome==='unknown')pending.reject(Error('Synthetic timeout'));else pending.resolve({...result,costMicros:outcome==='cost-bound'?RESERVATION_MICROS+1:225});
  const response=await generating;assert.equal(response.status,410);assert.doesNotMatch(await response.text(),/PRIVATE/);
  assert.equal(f.raw.prepare('SELECT count(*) n FROM life_ai_reviews').get().n,0);
  const ledger=f.raw.prepare('SELECT * FROM life_deleted_ai_usage').get();
  assert.equal(ledger.cost_micros,outcome==='unknown'?null:outcome==='cost-bound'?RESERVATION_MICROS+1:225);
  assert.equal(ledger.reserved_micros,RESERVATION_MICROS);
  if(outcome==='cost-bound'){
   f.settings.globalCapMicros=5000000;
   assert.equal((await generateAI(f.db,'google:b',review,f.settings,now)).status,429);
  }
  assert.equal(calls,1);
 }finally{f.raw.close();}
});
test('an account can be deleted before onboarding; expired database sessions cannot delete it',async()=>{
 const f=fixture();try{
  await f.setup();for(const table of userTables)f.raw.exec('DELETE FROM '+table);
  f.raw.prepare('UPDATE life_auth_session SET created_at=?').run(now.valueOf()-600001);
  assert.equal((await f.remove()).status,401);
  f.raw.prepare('UPDATE life_auth_session SET created_at=?').run(now.valueOf()-1000);
  assert.equal((await f.remove()).status,200);
  assert.equal(f.raw.prepare('SELECT count(*) n FROM life_deleted_ai_usage').get().n,0);
 }finally{f.raw.close();}
});
