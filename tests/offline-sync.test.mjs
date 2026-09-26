import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transpileModule,ModuleKind,JsxEmit} from 'typescript';
import * as jsx from 'react/jsx-runtime';
import {freshOfflineData,cacheRead,prepareLocalWrite,projectRead,replayLocalWrites,validWriteAcknowledgement,updateOnlineWriteCache} from '../lib/life/offline-queue.ts';
import {profileSchema} from '../lib/life/domain.ts';
import * as offlineQueue from '../lib/life/offline-queue.ts';

const now=new Date('2026-09-24T12:00:00Z');
const profile=profileSchema.parse({goal:'Synthetic offline test',timezone:'UTC',modules:['reflection','fitness','money'],habits:[],version:1});
function fixture(account='account-a'){
 const state=freshOfflineData(account);cacheRead(state,'/api/life',{profile,entries:[]});return state;
}
const body=(version=0,journal='Synthetic local response')=>JSON.stringify({action:'entry',entry:{date:'2026-09-24',journal,context:{},statuses:[],version,complete:false,mutationId:randomUUID()}});
const response=(value={},status=200,account='account-a')=>Response.json(value,{status,headers:{'X-Life-Account':account}});
function add(state,text){const write=prepareLocalWrite(state,'/api/life',text,now);assert.ok(write);state.writes.push(write);return write;}

test('backdated recurring acknowledgements refresh every affected cached monthly plan',()=>{
 const state=fixture(),data={currency:'USD',categories:[],recurring:[],goals:{spending:'',saving:'',investing:''}},earlier={id:'2026-09',version:1,data},selected={id:'2026-10',version:1,data};
 cacheRead(state,'/api/life?kind=budget',{records:[selected,earlier]});cacheRead(state,'/api/life?kind=budget&month=2026-09',{records:[earlier]});
 const updated={...earlier,version:2,data:{...data,recurring:[{id:randomUUID(),title:'Income',kind:'income',categoryId:'',amountCents:100,day:1,startDate:'2026-09-01'}]}};
 updateOnlineWriteCache(state,JSON.stringify({action:'budget-item',change:{kind:'recurring',month:'2026-10'}}),{record:selected,plans:[updated]});
 assert.equal(projectRead(state,'/api/life?kind=budget&month=2026-09').records[0].data.recurring.length,1);assert.equal(projectRead(state,'/api/life?kind=budget').records.find(r=>r.id==='2026-09').version,2);
});

test('offline entry keeps its exact mutation bytes and projects local saves through reload',()=>{
 const state=fixture(),text=body(),write=add(state,text),restored=JSON.parse(JSON.stringify(state));
 assert.equal(restored.writes[0].body,text);
 const day=projectRead(restored,'/api/life?date=2026-09-24').entry;
 assert.equal(day.journal,'Synthetic local response');assert.equal(day.version,1);assert.equal(day.mutationId,JSON.parse(text).entry.mutationId);
 assert.equal(projectRead(restored,'/api/life').entries[0].date,'2026-09-24');
 const second=add(restored,body(1,'Synthetic second revision'));
 assert.equal(projectRead(restored,'/api/life?date=2026-09-24').entry.version,2);
 assert.equal(JSON.parse(second.body).entry.version,1);assert.equal(write.attempted,false);
});

test('offline replay verifies account then durably marks and replays each frozen request in order',async()=>{
 const state=fixture(),one=add(state,body()),two=add(state,body(1,'Second')),calls=[],stored=[];
 const result=await replayLocalWrites(state,async(url,text)=>{calls.push([url,text]);if(!text)return response();assert.equal(stored.at(-1).writes[0].attempted,true);const write=state.writes[0];return response(write.result);},async()=>{stored.push(structuredClone(state));});
 assert.equal(result.paused,'');assert.deepEqual(calls,[['/api/life?offline-account=1',undefined],['/api/life',one.body],['/api/life',two.body]]);
 assert.equal(state.writes.length,0);assert.equal(projectRead(state,'/api/life').entries[0].version,2);
});

test('unknown response holds the first identity and never sends later dependent writes',async()=>{
 const state=fixture(),one=add(state,body()),two=add(state,body(1)),calls=[];
 await replayLocalWrites(state,async(url,text)=>{if(!text)return response();calls.push(text);throw Error('Synthetic dropped acknowledgement');},async()=>{});
 assert.deepEqual(calls,[one.body]);assert.equal(state.writes.length,2);assert.equal(state.writes[0].attempted,true);assert.equal(state.writes[1].attempted,false);
 await replayLocalWrites(state,async(url,text)=>!text?response():response({error:'Sign in again'},401),async()=>{});
 assert.equal(state.writes[0].body,one.body);assert.equal(state.writes[1].body,two.body);assert.equal(state.writes[0].status,401);
});

test('another verified account cannot receive queued writes or read the first account cache',async()=>{
 const state=fixture(),one=add(state,body()),calls=[];
 const result=await replayLocalWrites(state,async(url,text)=>{calls.push([url,text]);return response({},200,'account-b');},async()=>{});
 assert.match(result.paused,/same account/);assert.equal(calls.length,1);assert.equal(state.writes[0].body,one.body);
 const other=fixture('account-b');assert.equal(projectRead(other,'/api/life').entries.length,0);
});

test('version conflict preserves all local saves and pauses without overwriting cloud state',async()=>{
 const state=fixture(),one=add(state,body());add(state,body(1));let writes=0;
 await replayLocalWrites(state,async(url,text)=>{if(!text)return response();writes++;return response({error:'Changed on another device'},409);},async()=>{});
 assert.equal(writes,1);assert.equal(state.writes.length,2);assert.equal(state.writes[0].status,409);assert.equal(projectRead(state,'/api/life').entries[0].version,2);
 await replayLocalWrites(state,async()=>{throw Error('Offline');},async()=>{}).catch(()=>{});
 assert.equal(state.writes[0].body,one.body);
});

test('malformed or mismatched successful responses never release the immutable queue',async()=>{
 for(const value of [{},{entry:{date:'2026-09-24',version:1,mutationId:randomUUID(),habits:[]}}]){
  const state=fixture(),write=add(state,body());
  const result=await replayLocalWrites(state,async(url,text)=>response(text?value:{}),async()=>{});
  assert.match(result.paused,/valid acknowledgement/);assert.equal(state.writes.length,1);assert.equal(state.writes[0].body,write.body);
 }
});

test('provider requests, deletion, consent, profile and imports never enter the replay queue',()=>{
 const state=fixture();
 for(const action of ['ai','routine-build','training-analysis','budget-build','record-deletion','trash','automatic-consent','period-consent','profile','checkout','transaction-import','budget-item'])assert.equal(prepareLocalWrite(state,'/api/life',JSON.stringify({action}),now),null,action);
 assert.equal(prepareLocalWrite(state,'/api/life?budget-build=1',body(),now),null);
});

test('validated ordinary workout writes project cached workout records, preserving skipped ordinals and notes',()=>{
 const state=fixture(),id=randomUUID(),exerciseId=randomUUID();cacheRead(state,'/api/life?kind=workout',{records:[]});
 const data={date:'2026-09-24',routineId:randomUUID(),name:'Synthetic workout',exercises:[{id:exerciseId,name:'Squat',sets:3,reps:8,load:20,unit:'kg',restSeconds:60}],sets:[],skippedSets:[{exerciseId,workingSetNumber:1}],restUntil:null,finishedAt:null};
 const write=add(state,JSON.stringify({action:'resource',record:{kind:'workout',id,version:1,data}}));
 assert.deepEqual(projectRead(state,'/api/life?kind=workout').records[0].data.skippedSets,data.skippedSets);
 assert.equal(JSON.parse(write.body).record.version,1);
 assert.equal(validWriteAcknowledgement(write,{record:{...write.result.record,data:{...write.result.record.data,skippedSets:[]}}}),false);
 assert.equal(prepareLocalWrite(state,'/api/life',JSON.stringify({action:'resource',record:{kind:'workout',id,version:2,data:{...data,deleted:true}}}),now),null);
});

test('cached reads stay bounded by bytes without evicting pending writes',()=>{
 const state=fixture(),write=add(state,body());
 for(let i=0;i<20;i++)cacheRead(state,'/api/life?synthetic='+i,{text:'x'.repeat(800_000)});
 assert.ok(new TextEncoder().encode(JSON.stringify(state.reads)).length<=8_000_000);
 cacheRead(state,'/api/life?oversize',{text:'x'.repeat(2_000_001)});
 assert.ok(!state.reads.some(item=>item.url.includes('oversize')));assert.equal(state.writes[0].body,write.body);
});

test('online profile saves update the cached account and deletion scrubs cached personal snapshots',()=>{
 const state=fixture();updateOnlineWriteCache(state,JSON.stringify({action:'profile'}),{profile:{...profile,goal:'Updated online',version:2}});
 assert.equal(projectRead(state,'/api/life').profile.goal,'Updated online');
 updateOnlineWriteCache(state,JSON.stringify({action:'trash'}),{deleted:true});
 assert.equal(state.reads.length,0);assert.equal(projectRead(state,'/api/life'),null);
});

test('manual Retry sync remains reachable after a network failure and forces a fresh connection attempt',()=>{
 const calls=[],output={},modules={react:{useState:value=>[value,()=>{}]},'react/jsx-runtime':jsx,'@/components/ui/button':{Button:'button'},'@/lib/life/offline-client':{syncOfflineWrites:force=>calls.push(force)}};
 const code=transpileModule(readFileSync('app/life/offline-status.tsx','utf8'),{compilerOptions:{module:ModuleKind.CommonJS,jsx:JsxEmit.ReactJSX}}).outputText;
 runInNewContext(code,{exports:output,require:name=>modules[name]||new Proxy({},{get:(_,key)=>String(key)})});
 const tree=output.default({state:{offline:true,pending:3,syncing:false,message:'',blocked:null,available:true}});
 const find=node=>node&&typeof node==='object'&&(node.type==='button'&&node.props.children==='Retry sync'?node:[node.props?.children].flat(Infinity).map(find).find(Boolean));
 const retry=find(tree);assert.ok(retry);assert.equal(retry.props.disabled,false);retry.props.onClick();assert.deepEqual(calls,[true]);
});

test('a cleared old tab cannot send unbound requests with a newly signed-in account cookie',async()=>{
 const sent=[],channels=[],output={};let signedIn='account-a';
 const request=result=>{const pending={result};queueMicrotask(()=>pending.onsuccess?.());return pending;};
 const db={transaction(){return {objectStore(){return {get:()=>request(undefined)}}};}};
 const indexedDB={open:()=>request(db)};
 class BroadcastChannel{constructor(){channels.push(this);}postMessage(){}close(){}}
 const navigator={onLine:true,locks:{request:async(...args)=>args.at(-1)()}};
 const window={indexedDB,location:{origin:'https://life.test'},addEventListener(){},removeEventListener(){}};
 const document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
 const code=transpileModule(readFileSync('lib/life/offline-client.ts','utf8'),{compilerOptions:{module:ModuleKind.CommonJS}}).outputText;
 runInNewContext(code,{exports:output,require:()=>offlineQueue,indexedDB,navigator,window,document,BroadcastChannel,Headers,Response,AbortController,TextEncoder,URL,setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},fetch:async(url,init)=>{sent.push([url,new Headers(init?.headers).get('X-Life-Account')]);return response({},200,signedIn);}});
 await output.lifeFetch('/api/life');assert.deepEqual(sent,[['/api/life',null]],'Initial unbound startup remains available');
 const stop=output.startOfflineSync('account-a');await new Promise(resolve=>setImmediate(resolve));
 channels[0].onmessage({data:{clear:true}});signedIn='account-b';
 assert.equal(output.getOfflineStatus().invalidated,true);
 const prior=sent.length;
 const result=await output.lifeFetch('/api/life',{method:'POST',body:JSON.stringify({action:'resource',record:{id:randomUUID(),version:0}})});
 assert.equal(result.status,503);assert.match((await result.json()).error,/signed out/);assert.equal(sent.length,prior,'Cleared tabs must never reach fetch with another account cookie');stop();
});

test('an invalidated LifeApp renders only the account re-entry gate, excluding direct-fetch controls',()=>{
 const output={},noop=()=>{},react={useState:initial=>[typeof initial==='function'?initial():initial,noop],useRef:value=>({current:value}),useCallback:fn=>fn,useEffect:noop};
 const modules={react,'react/jsx-runtime':jsx,'./life/offline-status':{useOfflineSync:()=>({invalidated:true})},'./life/use-draft-sync':{useDraftSync:()=>({draft:null,dirty:false,open:noop,status:'saved'})},'./life/use-appearance':{useAppearance:noop},'@/components/ui/button':{Button:'button'}};
 const code=transpileModule(readFileSync('app/life-app.tsx','utf8'),{compilerOptions:{module:ModuleKind.CommonJS,jsx:JsxEmit.ReactJSX}}).outputText;
 runInNewContext(code,{exports:output,require:name=>modules[name]||new Proxy({},{get:(_,key)=>String(key)})});
 const tree=output.default({accountId:'account-a'});
 assert.equal(tree.type,'main');assert.equal(tree.props['aria-label'],'Session changed');
 const children=[tree.props.children].flat(Infinity);assert.deepEqual(children.map(item=>item.type),['h1','p','button','a']);assert.equal(children.at(-1).props.href,'/sign-in');
});

function workerFixture(){
 const stores=new Map(),listeners=new Map(),network=new Map(),fetched=[];
 const normalize=input=>new URL(typeof input==='string'?input:input.url||input.href,'https://life.test').href;
 const caches={async open(name){if(!stores.has(name))stores.set(name,new Map());const entries=stores.get(name);return {async put(input,value){entries.set(normalize(input),value.clone());},async match(input){return entries.get(normalize(input))?.clone();}};},async delete(name){return stores.delete(name);},async match(input,{cacheName}={}){return stores.get(cacheName)?.get(normalize(input))?.clone();}};
 const self={location:{origin:'https://life.test'},addEventListener:(type,listener)=>listeners.set(type,listener),clients:{claim:async()=>{},matchAll:async()=>[]},skipWaiting:async()=>{}};
 const context={self,caches,URL,Response,TextDecoder,Set,Promise,fetch:async input=>{const url=normalize(input);fetched.push(url);if(!network.has(url))throw Error('Synthetic offline');return network.get(url).clone();}};
 runInNewContext(readFileSync('public/life-sw.js','utf8')+'\nthis.helpers={cacheShell,clearPrivate};',context);
 return {stores,listeners,network,fetched,...context};
}

test('offline shell caches only authenticated HTML and follows its same-origin asset import graph',async()=>{
 const worker=workerFixture(),html='<meta name="life-offline-account" content="google:synthetic"><script src="/assets/main.js"></script>';
 worker.network.set('https://life.test/assets/main.js',new Response('import "./child.js"; import "https://external.invalid/foreign.js";', {headers:{'Content-Type':'text/javascript'}}));
 worker.network.set('https://life.test/assets/child.js',new Response('export const synthetic=true;'));
 await worker.helpers.cacheShell(new Response(html,{headers:{'Content-Type':'text/html'}}));
 assert.ok(worker.stores.get('lifeapp-private-shell-v1').has('https://life.test/'));
 assert.ok(worker.stores.get('lifeapp-assets-v1').has('https://life.test/assets/child.js'));
 assert.ok(worker.fetched.every(url=>url.startsWith('https://life.test/')));
 await worker.helpers.clearPrivate();
 await worker.helpers.cacheShell(new Response('<h1>Sign in</h1>',{headers:{'Content-Type':'text/html'}}));
 assert.equal(worker.stores.has('lifeapp-private-shell-v1'),false);
});

test('the service worker never caches API requests and provides its cached authenticated offline shell',async()=>{
 const worker=workerFixture();let handled=false;
 worker.listeners.get('fetch')({request:{url:'https://life.test/api/life?date=2026-09-24',method:'GET',mode:'cors'},respondWith(){handled=true;}});
 assert.equal(handled,false);
 await worker.helpers.cacheShell(new Response('<meta name="life-offline-account" content="google:synthetic">',{headers:{'Content-Type':'text/html'}}));
 let pending;worker.listeners.get('fetch')({request:{url:'https://life.test/',method:'GET',mode:'navigate'},respondWith(result){pending=result;},waitUntil(){}});
 assert.match(await (await pending).text(),/google:synthetic/);
 await worker.helpers.clearPrivate();
 worker.listeners.get('fetch')({request:{url:'https://life.test/',method:'GET',mode:'navigate'},respondWith(result){pending=result;},waitUntil(){}});
 assert.equal((await pending).status,503);
});
