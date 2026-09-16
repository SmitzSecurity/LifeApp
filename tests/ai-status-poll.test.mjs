import test from 'node:test';
import assert from 'node:assert/strict';
import {createAIStatusPoll} from '../lib/life/ai-status-poll.ts';

function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(load,active=()=>false){
 const data=[],states=[],timers=new Map(),delays=[];let next=0;
 const poll=createAIStatusPoll({load,onData:value=>data.push(value),onState:value=>states.push(value),active,schedule:(fn,ms)=>{timers.set(++next,fn);delays.push(ms);return next;},cancel:id=>timers.delete(id)});
 async function tick(){const first=timers.entries().next().value;if(!first)return false;timers.delete(first[0]);first[1]();await flush();return true;}
 return {poll,data,states,timers,delays,tick};
}

test('AI status reconciliation automatically follows generating to completion using reads only',async()=>{
 let reads=0;const f=fixture(async()=>({status:++reads<3?'generating':'complete'}));f.poll.start(data=>data.status==='generating');await flush();
 assert.equal(reads,1);assert.equal(f.timers.size,1);await f.tick();await f.tick();
 assert.equal(reads,3);assert.equal(f.data.at(-1).status,'complete');assert.equal(f.timers.size,0);assert.deepEqual(f.delays,[1000,2000]);
});

test('local pending admission continues reads before the server row appears, then stops at uncertain',async()=>{
 let active=true,reads=0;const f=fixture(async()=>{reads++;if(reads===1)return {builds:[]};active=false;return {builds:[{status:'uncertain'}]};},()=>active);
 f.poll.start(data=>data.builds.some(build=>build.status==='generating'));await flush();await f.tick();assert.equal(reads,2);assert.equal(f.timers.size,0);
});

test('cancel ignores late read replies and schedules no further work',async()=>{
 const pending=deferred(),f=fixture(()=>pending.promise);f.poll.start(()=>true);f.poll.stop();pending.resolve({status:'complete'});await flush();
 assert.deepEqual(f.data,[]);assert.equal(f.timers.size,0);assert.equal(f.states.length,1);await f.poll.check();assert.equal(f.states.length,1);
});

test('checks after a mutation ignore the old snapshot and share one fresh trailing read',async()=>{
 const old=deferred(),fresh=deferred();let reads=0;const f=fixture(()=>++reads===1?old.promise:fresh.promise);f.poll.start(()=>false);
 const a=f.poll.check(),b=f.poll.check();assert.equal(a,b);assert.equal(reads,1);
 old.resolve({builds:[{id:'deleted-draft',status:'complete'}]});await flush();assert.equal(reads,2);assert.deepEqual(f.data,[]);
 let checked=false;a.then(()=>{checked=true;});await flush();assert.equal(checked,false);
 fresh.resolve({builds:[]});await Promise.all([a,b]);assert.equal(checked,true);assert.deepEqual(f.data,[{builds:[]}]);assert.equal(reads,2);assert.equal(f.timers.size,0);
});

test('post success reconciliation receives completed data even after the old read saw no job',async()=>{
 const old=deferred();let reads=0;const f=fixture(()=>++reads===1?old.promise:Promise.resolve({status:'complete'}));f.poll.start(()=>false);
 const checked=f.poll.check();old.resolve({status:'not-yet-admitted'});await checked;
 assert.equal(reads,2);assert.deepEqual(f.data,[{status:'complete'}]);assert.equal(f.timers.size,0);
});

test('cancel also discards a queued trailing read and releases its waiting callers',async()=>{
 const old=deferred();let reads=0;const f=fixture(()=>{reads++;return old.promise;});f.poll.start(()=>false);
 const checked=f.poll.check();f.poll.stop();await checked;old.resolve({status:'complete'});await flush();
 assert.equal(reads,1);assert.deepEqual(f.data,[]);assert.equal(f.timers.size,0);
});

test('errors retry a bounded number of reads and a later focus check can recover',async()=>{
 let failing=true,reads=0;const f=fixture(async()=>{reads++;if(failing)throw Error('Offline');return {status:'complete'};});f.poll.start(()=>false);await flush();await f.tick();await f.tick();
 assert.equal(reads,3);assert.equal(f.timers.size,0);assert.equal(f.states.at(-1).delayed,true);assert.equal(f.states.at(-1).error,'Offline');
 failing=false;await f.poll.check();assert.equal(reads,4);assert.equal(f.states.at(-1).error,'');assert.equal(f.states.at(-1).delayed,false);
});

test('a long running request stops polling at its bound without declaring it canceled or complete',async()=>{
 let reads=0;const f=fixture(async()=>{reads++;return {status:'generating'};});f.poll.start(()=>true);await flush();while(await f.tick()){}
 assert.equal(reads,16);assert.equal(f.timers.size,0);assert.deepEqual(f.states.at(-1),{checking:false,error:'',delayed:true});assert.equal(f.data.at(-1).status,'generating');
 assert.ok(f.delays.reduce((sum,value)=>sum+value,0)<=120000);
});
