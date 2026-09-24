import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transpileModule,ModuleKind,JsxEmit} from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as timer from '../lib/life/workout-timer.ts';

const start=Date.parse('2026-09-24T12:00:00.000Z');
const rest=(seconds=90,id='workout-a')=>({id,restUntil:new Date(start+seconds*1000).toISOString()});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('rest countdown derives from its saved deadline after reload and never rounds down early',()=>{
 const saved=rest();
 assert.equal(timer.timerSeconds(saved,start),90);
 assert.equal(timer.timerSeconds(JSON.parse(JSON.stringify(saved)),start+31750),59);
 assert.equal(timer.timerSeconds(saved,start+89999),1);
 assert.equal(timer.timerSeconds(saved,start+90000),0);
 assert.equal(timer.timerSeconds(saved,start+200000),0);
 assert.equal(timer.timerSeconds(null,start),0);
 assert.equal(timer.timerSeconds({id:'workout-a',restUntil:null},start),0);
 assert.equal(timer.timerSeconds({id:'workout-a',restUntil:'invalid'},start),0);
 assert.equal(timer.timerText(0),'0:00');
 assert.equal(timer.timerText(61),'1:01');
 assert.equal(timer.timerText(600),'10:00');
});

test('phone rest notifications change only for deadline, workout identity or completion',()=>{
 const notice=timer.restNotification(rest(),start);
 assert.equal(timer.restNotification(rest(),start+40000).key,notice.key);
 assert.notEqual(timer.restNotification(rest(120),start).key,notice.key);
 assert.notEqual(timer.restNotification(rest(90,'workout-b'),start).key,notice.key);
 const finished=timer.restNotification(rest(),start+90000);
 assert.notEqual(finished.key,notice.key);
 assert.match(finished.title,/Rest complete/);
 assert.match(notice.body,/Rest ends at/);
 assert.equal(timer.restNotification(null,start),null);
 assert.equal(timer.restNotification({id:'workout-a',restUntil:'invalid'},start),null);
});

// Render the actual provider with deterministic hook, clock and browser IO
// adapters. Deferred browser promises expose cancellation and remount races.
function fixture(){
 let activeHost,now=start,intervalId=0;
 const intervals=new Map(),events=new Map(),shown=[],closed=[];
 const browser={permission:'granted',requestPermission:async()=> 'granted'};
 const registration={
  async showNotification(title,options){shown.push({title,...options});},
  async getNotifications(){return shown.map(notice=>({close(){closed.push(notice);const index=shown.indexOf(notice);if(index!==-1)shown.splice(index,1);}}));},
 };
 const worker={getRegistration:async()=>registration};
 const react={
  createContext:value=>({Provider:'Provider',value}),useContext:context=>context.value,
  useState:initial=>activeHost.useState(initial),useRef:initial=>activeHost.useRef(initial),
  useEffect:(fn,deps)=>activeHost.useEffect(fn,deps),
  useSyncExternalStore:(_subscribe,snapshot)=>snapshot(),
 };
 const document={addEventListener(type,fn){if(!events.has(type))events.set(type,new Set());events.get(type).add(fn);},removeEventListener(type,fn){events.get(type)?.delete(fn);}};
 const adapters={react,'react/jsx-runtime':jsx,'@/lib/life/workout-timer':timer};
 const output={},source=transpileModule(readFileSync('app/life/workout-timer.tsx','utf8'),{compilerOptions:{module:ModuleKind.CommonJS,jsx:JsxEmit.ReactJSX}}).outputText;
 runInNewContext(source,{exports:output,Notification:browser,navigator:{serviceWorker:worker},document,Date:class extends Date{static now(){return now;}},
  setInterval(fn){const id=++intervalId;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id),
  require:name=>adapters[name]||new Proxy({},{get:(_target,key)=>String(key)}),
 });
 function provider(){
  const slots=[],pending=new Map();let cursor=0,tree,unmounted=false,lateUpdates=0;
  const host={
   useState(initial){const index=cursor++;if(!(index in slots))slots[index]={value:typeof initial==='function'?initial():initial};return [slots[index].value,value=>{if(unmounted)lateUpdates++;slots[index].value=typeof value==='function'?value(slots[index].value):value;}];},
   useRef(initial){const index=cursor++;return slots[index]??(slots[index]={current:initial});},
   useEffect(fn,deps){const index=cursor++,previous=slots[index];if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i])))pending.set(index,{fn,deps});},
  };
  function render(){activeHost=host;cursor=0;pending.clear();tree=output.WorkoutTimerProvider({children:null});for(const [index,effect] of pending){slots[index]?.cleanup?.();slots[index]={deps:effect.deps,cleanup:effect.fn()};}return tree.props.value;}
  render();
  return {render,get value(){return tree.props.value;},get lateUpdates(){return lateUpdates;},unmount(){unmounted=true;for(const slot of slots)slot?.cleanup?.();}};
 }
 return {provider,browser,worker,registration,shown,closed,intervals,
  setTime(value,event='interval'){now=value;if(event==='interval')for(const tick of intervals.values())tick();else for(const listener of events.get(event)||[])listener();},
 };
}

test('mounted countdown catches up after background suspension and saved deadline extension',async()=>{
 const f=fixture(),p=f.provider();await flush();
 p.value.setWorkoutTimer(rest());p.render();p.render();
 assert.equal(timer.timerSeconds(p.value.timer,p.value.now),90);
 f.setTime(start+95000,'visibilitychange');p.render();
 assert.equal(timer.timerSeconds(p.value.timer,p.value.now),0);
 p.value.setWorkoutTimer(rest(120));p.render();p.render();
 assert.equal(timer.timerSeconds(p.value.timer,p.value.now),25);
 p.value.setWorkoutTimer(null);p.render();assert.equal(f.intervals.size,0);p.unmount();await flush();
});

test('a pending permission request cannot enable notifications after cancellation or unmount',async()=>{
 for(const unmount of [false,true]){
  const f=fixture(),p=f.provider(),permission=deferred();await flush();f.browser.requestPermission=()=>permission.promise;
  const enabling=p.value.toggleNotifications();
  if(unmount)p.unmount();else await p.value.toggleNotifications();
  permission.resolve('granted');await enabling;await flush();
  if(!unmount){p.render();assert.equal(p.value.enabled,false);p.unmount();}
  assert.equal(p.lateUpdates,0);assert.equal(f.shown.length,0);
 }
});

test('late service-worker lookup cannot revive cancelled notification opt-in',async()=>{
 const f=fixture(),p=f.provider(),lookup=deferred();await flush();f.worker.getRegistration=()=>lookup.promise;
 const enabling=p.value.toggleNotifications();await flush();await p.value.toggleNotifications();
 lookup.resolve(f.registration);await enabling;p.render();await flush();
 assert.equal(p.value.enabled,false);assert.equal(f.shown.length,0);p.unmount();await flush();
});

test('notification writes serialize deadline replacement, completion and cleanup',async()=>{
 const f=fixture(),p=f.provider();await flush();p.value.setWorkoutTimer(rest());p.render();await p.value.toggleNotifications();
 const firstShow=deferred();let writes=0;f.registration.showNotification=async(title,options)=>{writes++;if(writes===1)await firstShow.promise;f.shown.splice(0,f.shown.length,{title,...options});};
 p.render();await flush();assert.equal(writes,1);
 p.value.setWorkoutTimer(rest(120));p.render();await flush();assert.equal(writes,1,'new deadline waits for an outstanding browser write');
 firstShow.resolve();await flush();assert.equal(writes,2);assert.match(f.shown[0].title,/Workout rest/);
 f.setTime(start+120000);p.render();await flush();assert.equal(writes,3);assert.match(f.shown[0].title,/Rest complete/);
 f.setTime(start+125000);p.render();await flush();assert.equal(writes,3,'completion is not repeated every second');
 p.unmount();await flush();assert.equal(f.shown.length,0);
});

test('a superseded browser error cannot replace a later notification choice',async()=>{
 const f=fixture(),p=f.provider();await flush();p.value.setWorkoutTimer(rest());p.render();await p.value.toggleNotifications();
 const write=deferred(),originalShow=f.registration.showNotification;f.registration.showNotification=()=>write.promise;
 p.render();await flush();await p.value.toggleNotifications();p.render();
 write.reject(Error('Delayed browser failure'));await flush();p.render();
 assert.equal(p.value.enabled,false);assert.equal(p.value.message,'');
 f.registration.showNotification=originalShow;await p.value.toggleNotifications();p.render();await flush();
 assert.equal(p.value.enabled,true);assert.equal(f.shown.length,1);p.unmount();await flush();
});

test('an obsolete notification read cannot close a new account shell notification',async()=>{
 const f=fixture(),old=f.provider();await flush();old.value.setWorkoutTimer(rest());old.render();await old.value.toggleNotifications();old.render();await flush();
 const staleRead=deferred(),originalRead=f.registration.getNotifications;f.registration.getNotifications=()=>staleRead.promise;
 old.unmount();await flush();
 const next=f.provider();next.value.setWorkoutTimer(rest(180,'workout-b'));next.render();await next.value.toggleNotifications();next.render();
 let staleClosed=0;f.registration.getNotifications=originalRead;staleRead.resolve([{close(){staleClosed++;}}]);await flush();
 assert.equal(staleClosed,0,'the old cleanup loses authority before its delayed read returns');
 assert.equal(f.shown.at(-1).title,'LifeApp · Workout rest');assert.equal(old.lateUpdates,0);
 next.unmount();await flush();
});
