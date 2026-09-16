import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,createFetchMock} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {serializeSignedCookie} from 'better-call';
import {AI_MODEL,RESERVATION_MICROS} from '../lib/life/ai-provider.ts';
import {validateBackup} from '../lib/life/migration-preview.ts';

const digest=value=>createHash('sha256').update(value).digest('hex');
const output={notes:'Synthetic compiled budget draft.',categories:[{name:'Groceries',limitCents:40000}],recurring:[]};
const outputMimeContract=JSON.parse(readFileSync('tests/fixtures/gemini-output-format.json','utf8'));
function pdfDocument(){
 let pdf='%PDF-1.4\n';const offsets=[0],objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>','<< /Length 0 >>\nstream\n\nendstream'];
 objects.forEach((body,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${body}\nendobj\n`;});
 const start=Buffer.byteLength(pdf);pdf+='xref\n0 5\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('');
 pdf+=`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
 return {mimeType:'application/pdf',data:Buffer.from(pdf).toString('base64')};
}

async function fixture(t,{countTokens=100000,rejectGeneration=false}={}){
 const fetchMock=createFetchMock();fetchMock.disableNetConnect();const calls=[];
 const mock=fetchMock.get('https://generativelanguage.googleapis.com');
 // Drain large mocked request bodies before responding. A static mock reply
 // can reset Miniflare's Windows transport while it is still uploading.
 for(const operation of ['countTokens','generateContent'])mock.intercept({path:`/v1beta/models/${AI_MODEL}:${operation}`,method:'POST'}).reply(rejectGeneration&&operation==='generateContent'?400:200,async options=>{
  const body=JSON.parse(await new Response(options.body).text());calls.push({operation,body});
  if(operation==='generateContent'){
   assert.equal(body.generationConfig.responseMimeType,'application/json');
   assert.ok(outputMimeContract.properties.responseMimeType.supported.includes(body.generationConfig.responseMimeType),'REST responseMimeType must use a documented media MIME string');
   assert.equal(body.generationConfig.responseJsonSchema.type,'object');assert.ok(body.generationConfig.responseJsonSchema.properties.recurring);
   assert.equal(body.generationConfig.responseFormat,undefined);assert.equal(body.generationConfig.responseSchema,undefined);
   if(rejectGeneration)return JSON.stringify({error:{code:400,status:'INVALID_ARGUMENT',message:'Synthetic request rejected'}});
  }
  return JSON.stringify(operation==='countTokens'?{totalTokens:countTokens}:{responseId:'synthetic-compiled-budget',modelVersion:AI_MODEL,candidates:[{content:{parts:[{text:JSON.stringify(output)}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:100000,candidatesTokenCount:100,thoughtsTokenCount:0,totalTokenCount:100100}});
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
