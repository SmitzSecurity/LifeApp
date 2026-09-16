import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {handleLife} from '../lib/life/service.ts';
import {renderReportMarkdown} from '../lib/life/report-markdown.ts';
import {reportEmail} from '../lib/life/email-service.ts';
import {exercisePresets,presetExercise,repTarget} from '../lib/life/exercise-presets.ts';
import {exerciseSchema} from '../lib/life/modules.ts';
import {validateBackup,previewMigration} from '../lib/life/migration-preview.ts';
import {AI_MODEL,RESERVATION_MICROS,geminiProvider} from '../lib/life/ai-provider.ts';
const now=new Date('2026-09-14T12:00:00.000Z');
const description='Push / pull split, dumbbells and cables, muscle growth. About 45 minutes.';
const output={notes:'Choose a starting load.',routines:[{name:'Push',preferences:'Dumbbells',exercises:[{name:'Dumbbell bench press',sets:3,reps:6,repMax:10,load:0,unit:'lb',restSeconds:150}]}]};
const providerResult={text:JSON.stringify(output),inputTokens:100,outputTokens:150,thoughtTokens:10,costMicros:500,providerId:'synthetic',modelVersion:AI_MODEL,finishReason:'STOP'};
function fixture(t){
 const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+file,'utf8'));
 const state={calls:[],result:providerResult,hook:null,beforeInsert:null};
 const db={prepare(sql){return {bind(...params){return {async first(){if(sql.startsWith('INSERT INTO life_routine_builds')&&state.beforeInsert){const fn=state.beforeInsert;state.beforeInsert=null;fn();}return raw.prepare(sql).get(...params)||null;},async all(){return {results:raw.prepare(sql).all(...params)};}};}};}};
 const ai={enabled:true,userCapMicros:1000000,globalCapMicros:5000000,provider:{generate:async(input,purpose)=>{state.calls.push({input:JSON.parse(input),purpose});if(state.hook)await state.hook();return purpose==='routine'?state.result:{...providerResult,text:'Synthetic analysis'};}}};
 const call=(body,id='a',path='')=>handleLife(new Request('https://life.test/api/life'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:'https://life.test'},body:body?JSON.stringify(body):undefined}),id,db,now,ai);
 async function setup(id='a'){assert.equal((await call({action:'profile',profile:{goal:'Private overall goal',moduleGoals:{fitness:'Build muscle'},timezone:'UTC',modules:['reflection','fitness','money'],habits:[],version:0}},id)).status,200);assert.equal((await call({action:'entry',entry:{date:'2026-09-13',journal:'Private journal not for routine builder',context:{},statuses:[],complete:true,version:0}},id)).status,200);}
 const build=(extra={})=>({action:'routine-build',build:{requestId:randomUUID(),text:description,consent:true,...extra}});
 const analysis=(cadence='daily')=>({action:'ai',review:{cadence,date:'2026-09-13',sourceVersion:1,requestId:randomUUID(),predecessorId:null,critique:'',consent:true}});
 return {raw,db,ai,state,call,setup,build,analysis};
}

test('report Markdown renders headings, emphasis, lists and tables identically in HTML email',()=>{
 const source='### Progress\n\n**Steady** effort.\n\n- Movement\n- Money\n\n| Day | Sets |\n| --- | --- |\n| Mon | 9 |';
 const html=renderReportMarkdown(source);assert.match(html,/<h4[^>]*>Progress<\/h4>/);assert.match(html,/<strong>Steady<\/strong>/);assert.match(html,/<ul/);assert.match(html,/<table/);assert.doesNotMatch(html,/###/);
 const mail=reportEmail({date:'2026-09-13',cadence:'weekly',revision:1,text:source,recipient:'synthetic@example.test',unsubscribeToken:'synthetic'},{from:'reports@lifeapp.smitzgroup.com',origin:'https://life.test'});
 assert.ok(mail.html.includes(html));assert.ok(mail.text.includes(source));
});
test('owner builder allowance remains bounded, identity-scoped and subordinate to shared accounting',async t=>{
 const f=fixture(t),owner='google:synthetic-owner';f.ai.ownerPrototype={userId:owner,expiresAt:'2026-10-14T23:59:59.000Z'};await f.setup(owner);await f.setup('b');
 for(let i=0;i<2;i++)assert.equal((await f.call(f.build(),'b')).status,200);
 assert.equal((await f.call(f.build(),'b')).status,429);
 for(let i=0;i<20;i++)assert.equal((await f.call(f.build(),owner)).status,200);
 assert.equal((await f.call(f.build(),owner)).status,429);
 f.ai.ownerPrototype.expiresAt=now.toISOString();assert.equal((await f.call(f.analysis(),owner)).status,429);
 assert.equal(f.state.calls.length,22);
});
test('untrusted report Markdown cannot run HTML, scripts or load images',()=>{
 const html=renderReportMarkdown('<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert%281%29) [data](data:text/html,hello) ![tracking](https://evil.test/pixel) [good](https://example.test)');
 assert.doesNotMatch(html,/<(?:script|img|iframe)\b/i);assert.doesNotMatch(html,/href="(?:javascript|data):/i);assert.match(html,/&lt;script&gt;/);assert.match(html,/href="https:\/\/example.test" rel="noopener noreferrer"/);
});
test('presets vary by exercise; old single-rep targets and snapshot identity remain unchanged',()=>{
 assert.ok(exercisePresets.length>=60);assert.equal(new Set(exercisePresets.map(e=>e.name)).size,exercisePresets.length);
 for(const preset of exercisePresets)assert.ok(exerciseSchema.safeParse(presetExercise(preset.name)).success);
 assert.equal(repTarget(presetExercise('Squat')),'5–8');assert.equal(presetExercise('Squat').restSeconds,180);assert.equal(repTarget(presetExercise('Lateral raise')),'12–20');assert.equal(presetExercise('Lateral raise').restSeconds,90);
 const old={id:randomUUID(),name:'Custom old exercise',sets:3,reps:10,load:20,unit:'lb',restSeconds:90};assert.deepEqual(exerciseSchema.parse(old),old);assert.equal(repTarget(old),'10');assert.equal(exerciseSchema.safeParse({...old,repMax:5}).success,false);
});
test('workout notes save with exact retries, reach daily and period analysis, and do not invent sets',async t=>{
 const f=fixture(t);await f.setup();await f.setup('b');
 const record={kind:'workout-note',id:randomUUID(),version:0,data:{date:'2026-09-13',text:'Bench 3 x 8 at 100 lb, then a walk.',minutes:45,voided:false}};
 for(let i=0;i<2;i++)assert.equal((await f.call({action:'resource',record})).status,200);
 assert.equal(f.raw.prepare("SELECT version FROM life_resources WHERE kind='workout-note'").get().version,1);
 assert.equal((await (await f.call(null,'b','?kind=workout-note')).json()).records.length,0);
 assert.equal((await f.call(f.analysis())).status,200);assert.equal(f.state.calls[0].input.context.workoutNotes[0].text,record.data.text);
 assert.equal((await f.call(f.analysis('weekly'))).status,200);const context=f.state.calls[1].input.context;assert.equal(context.workoutNotes[0].text,record.data.text);assert.match(context.workoutNoteCoverage.interpretation,/double-count/);
 const home=await (await f.call(null,'a','?dashboard')).json();assert.ok(JSON.stringify(home).includes('"workoutNotes":1'));assert.ok(JSON.stringify(home).includes('"sets":0'));
 const backup=validateBackup(await (await f.call(null,'a','?export')).text());assert.equal(backup.resources[0].kind,'workout-note');
 assert.equal((await f.call({action:'resource',record:{...record,version:1,data:{...record.data,voided:true}}})).status,200);
 const dashboard=await (await f.call(null,'a','?dashboard')).json();assert.ok(!JSON.stringify(dashboard).includes('"workoutNotes":1'));
 assert.equal((await f.call({action:'resource',record:{...record,id:randomUUID(),data:{...record.data,date:'2026-09-15'}}})).status,400);
});
test('routine building returns durable editable drafts without saving routines or exposing journal context',async t=>{
 const f=fixture(t);await f.setup();await f.setup('b');const body=f.build();
 const first=await (await f.call(body)).json();assert.equal(first.build.status,'complete');assert.equal(first.build.result.routines[0].version,0);
 assert.equal(f.state.calls[0].purpose,'routine');assert.equal(f.state.calls[0].input.description,description);assert.equal(f.state.calls[0].input.movementGoal,'Build muscle');assert.ok(!JSON.stringify(f.state.calls).includes('Private journal'));assert.ok(!JSON.stringify(f.state.calls).includes('Private overall'));
 assert.equal(f.raw.prepare("SELECT count(*) n FROM life_resources WHERE kind='routine'").get().n,0);
 assert.deepEqual(await (await f.call(body)).json(),first);assert.equal(f.state.calls.length,1);assert.equal((await f.call({...body,build:{...body.build,text:description+' different'}})).status,409);
 assert.equal((await (await f.call(null,'a','?routine-builds')).json()).builds.length,1);assert.equal((await (await f.call(null,'b','?routine-builds')).json()).builds.length,0);
 const draft=first.build.result.routines[0];assert.equal((await f.call({action:'resource',record:{kind:'routine',...draft}})).status,200);
 const backup=await (await f.call(null,'a','?export')).text();assert.equal(validateBackup(backup).routineBuilds.length,1);assert.equal((await previewMigration(backup)).source.measuredCostMicros,500);
});
test('routine requests require explicit consent and enforce shared cost and daily attempt limits',async t=>{
 const f=fixture(t);await f.setup();assert.equal((await f.call(f.build({consent:false}))).status,400);
 f.ai.userCapMicros=RESERVATION_MICROS-1;assert.equal((await f.call(f.build())).status,429);assert.equal(f.state.calls.length,0);f.ai.userCapMicros=1000000;
 assert.equal((await f.call(f.build())).status,200);assert.equal((await f.call(f.build())).status,200);assert.equal((await f.call(f.build())).status,429);assert.equal(f.state.calls.length,2);
 f.ai.userCapMicros=RESERVATION_MICROS+999;assert.equal((await f.call(f.analysis())).status,429);
});
test('simultaneous routine retries admit one provider call; changed same-id input is rejected',async t=>{
 const f=fixture(t);await f.setup();let release;f.state.hook=()=>new Promise(resolve=>{release=resolve;});const body=f.build();const first=f.call(body);
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await f.call(body)).status,202);assert.equal((await f.call({...body,build:{...body.build,text:description+' changed'}})).status,409);assert.equal((await f.call(f.build())).status,429);release();assert.equal((await first).status,200);assert.equal(f.state.calls.length,1);
});
test('invalid or truncated routine output records known usage without saving a draft',async t=>{
 const f=fixture(t);await f.setup();f.state.result={...providerResult,text:JSON.stringify({...output,routines:[{...output.routines[0],exercises:[{...output.routines[0].exercises[0],restSeconds:-1}]}]})};
 const first=await (await f.call(f.build())).json();assert.equal(first.build.status,'failed');assert.equal(first.build.result,null);
 f.state.result={...providerResult,finishReason:'MAX_TOKENS'};assert.equal((await (await f.call(f.build())).json()).build.status,'failed');assert.equal(f.raw.prepare('SELECT SUM(cost_micros) n FROM life_ai_usage').get().n,1000);
});
test('unknown routine outcomes keep reservations, prevent reissue and block new builds',async t=>{
 const f=fixture(t);await f.setup();f.state.hook=()=>{throw Error('Synthetic transport failure');};const body=f.build();assert.equal((await f.call(body)).status,502);assert.equal((await (await f.call(body)).json()).build.status,'uncertain');assert.equal((await f.call(f.build())).status,429);assert.equal(f.state.calls.length,1);
 const row=f.raw.prepare('SELECT * FROM life_ai_usage').get();assert.equal(row.cost_micros,null);assert.equal(row.reserved_micros,RESERVATION_MICROS);
 assert.ok((await previewMigration(await (await f.call(null,'a','?export')).text())).blockers.includes('usage_reconciliation_required'));
});
test('deletion during routine generation discards private drafts and settles only archived usage',async t=>{
 const f=fixture(t);await f.setup();f.state.hook=()=>f.raw.prepare('INSERT INTO life_account_deletions VALUES(?,?)').run('a',now.toISOString());
 assert.equal((await f.call(f.build())).status,410);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM life_routine_builds').get().n,0);assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM life_profiles').get().n,0);assert.equal(f.raw.prepare('SELECT cost_micros FROM life_deleted_ai_usage').get().cost_micros,500);
 assert.throws(()=>f.raw.prepare("INSERT INTO life_routine_builds(user_id,request_id,status,input_snapshot,model,price_version,reserved_micros,created_at) VALUES('a','routine:stale','generating','secret','synthetic','synthetic',200000,?)").run(now.toISOString()),/Account has been deleted/);
});
test('cost-bound circuit breaker includes routine attempts even after account deletion',async t=>{
 const f=fixture(t);await f.setup();await f.setup('b');f.state.result={...providerResult,costMicros:RESERVATION_MICROS+1};assert.equal((await (await f.call(f.build())).json()).build.status,'failed');f.raw.prepare('INSERT INTO life_account_deletions VALUES(?,?)').run('a',now.toISOString());assert.equal((await f.call(f.build(),'b')).status,429);assert.equal((await f.call(f.analysis(),'b')).status,429);
});
test('Gemini receives a fixed routine instruction only for routine requests',async()=>{
 const sent=[];const provider=geminiProvider('synthetic',async(_url,options)=>{sent.push(JSON.parse(options.body));return Response.json({candidates:[{content:{parts:[{text:'{}'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:10,totalTokenCount:20,candidatesTokenCount:10}});});
 await provider.generate('synthetic','routine');await provider.generate('synthetic');assert.match(sent[0].systemInstruction.parts[0].text,/editable routine drafts/);assert.match(sent[1].systemInstruction.parts[0].text,/personal analysis assistant/);assert.equal(sent[0].generationConfig.maxOutputTokens,8192);
});
test('0009 preserves existing data, eligibility and usage when added to a populated database',()=>{
 const raw=new DatabaseSync(':memory:');try{
 for(const name of readdirSync('drizzle').filter(f=>/^000[0-8]_.*\.sql$/.test(f)).sort())raw.exec(readFileSync('drizzle/'+name,'utf8'));
 raw.exec("INSERT INTO life_profiles VALUES('synthetic','{\"goal\":\"preserve\"}',8,'2026-09-14'); INSERT INTO life_deleted_ai_usage(user_id,request_id,status,model,price_version,reserved_micros,created_at) VALUES('retired','old','uncertain','synthetic','synthetic',200000,'2026-09-14');");
 const usage=raw.prepare('SELECT * FROM life_ai_usage').all(),profile=raw.prepare('SELECT * FROM life_profiles').all(),eligibility=raw.prepare("SELECT sql FROM sqlite_master WHERE name IN ('life_daily_job_status','life_daily_reminder_intent') ORDER BY name").all();
 raw.exec(readFileSync('drizzle/0009_routine_builder.sql','utf8'));assert.deepEqual(raw.prepare('SELECT * FROM life_ai_usage').all(),usage);assert.deepEqual(raw.prepare('SELECT * FROM life_profiles').all(),profile);assert.deepEqual(raw.prepare("SELECT sql FROM sqlite_master WHERE name IN ('life_daily_job_status','life_daily_reminder_intent') ORDER BY name").all(),eligibility);assert.throws(()=>raw.exec(readFileSync('drizzle/0009_routine_builder.sql','utf8')),/already exists/);
 }finally{raw.close();}
});
