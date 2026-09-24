import {accountMatches,acknowledgeWrite,cacheRead,freshOfflineData,isOfflineRead,prepareLocalWrite,projectRead,replayLocalWrites,updateOnlineWriteCache,type OfflineData,type LocalWrite} from './offline-queue.ts';

export type OfflineStatusSnapshot={offline:boolean;pending:number;syncing:boolean;message:string;blocked:LocalWrite|null;available:boolean;invalidated:boolean};
const initial:OfflineStatusSnapshot={offline:false,pending:0,syncing:false,message:'',blocked:null,available:true,invalidated:false};
let account='',sessionCleared=false,status=initial,channel:BroadcastChannel|null=null,flushing:Promise<void>|null=null,sessionGeneration:Promise<string>|null=null;
const listeners=new Set<()=>void>();
const requests=new Set<AbortController>();
export const getOfflineStatus=()=>status;
export const getServerOfflineStatus=()=>initial;
export function subscribeOffline(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
function publish(next:Partial<OfflineStatusSnapshot>){status={...status,...next};for(const listener of listeners)listener();}
function summarize(state:OfflineData){publish({pending:state.writes.length,blocked:state.writes.find(item=>item.blocked)||null});}
let database:Promise<IDBDatabase>|null=null;
function openDatabase(){
 database??=new Promise<IDBDatabase>((resolve,reject)=>{
  const request=indexedDB.open('lifeapp-offline-v1',2);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('accounts'))request.result.createObjectStore('accounts');if(!request.result.objectStoreNames.contains('metadata'))request.result.createObjectStore('metadata');};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });return database;
}
async function readSessionGeneration(){const db=await openDatabase();return new Promise<string>((resolve,reject)=>{const request=db.transaction('metadata').objectStore('metadata').get('generation');request.onsuccess=()=>resolve(request.result||'initial');request.onerror=()=>reject(request.error);});}
async function readData(id:string):Promise<OfflineData>{
 const db=await openDatabase();return new Promise((resolve,reject)=>{const request=db.transaction('accounts').objectStore('accounts').get(id);request.onsuccess=()=>resolve(request.result||freshOfflineData(id));request.onerror=()=>reject(request.error);});
}
async function writeData(state:OfflineData,changed=true){
 if(state.account!==account)throw Error('The account changed before local storage was updated.');
 if(changed)state.revision=(state.revision||0)+1;
 const db=await openDatabase();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('accounts','readwrite');tx.objectStore('accounts').put(state,state.account);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
 if(state.account===account)summarize(state);channel?.postMessage({account:state.account});
}
async function locked<T>(id:string,operation:()=>Promise<T>):Promise<T>{
 const expected=await (sessionGeneration??=readSessionGeneration());
 return navigator.locks.request('lifeapp-offline-session',{mode:'shared'},()=>navigator.locks.request('lifeapp-offline:'+id,async()=>{
  if(await readSessionGeneration()!==expected){sessionCleared=true;account='';publish({...initial,available:false,invalidated:true,message:'Your account was signed out in another tab. Reload to continue.'});throw Error('The account was signed out in another tab. Reload before continuing.');}
  return await operation();
 })) as Promise<T>;
}
async function nativeFetch(id:string,url:string,init?:RequestInit){
 if(sessionCleared||id!==account)return unavailable('Your account was signed out. Reload LifeApp before continuing.');
 const headers=new Headers(init?.headers);headers.set('X-Life-Account',id);
 const controller=new AbortController(),abort=()=>controller.abort();requests.add(controller);
 const timer=setTimeout(abort,20000);init?.signal?.addEventListener('abort',abort,{once:true});if(init?.signal?.aborted)abort();
 try{const response=await fetch(url,{...init,headers,signal:controller.signal,cache:'no-store'});return id===account?response:unavailable('The signed-in account changed. Reload LifeApp before continuing.');}finally{clearTimeout(timer);requests.delete(controller);init?.signal?.removeEventListener('abort',abort);}
}
function sender(id:string){return (url:string,body?:string)=>nativeFetch(id,url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body});}
const localResponse=(value:unknown)=>Response.json(value,{headers:{'X-Life-Local':'pending'}});
const unavailable=(message:string)=>Response.json({error:message},{status:503});
async function refreshStatus(){const id=account;if(!id)return;try{const state=await readData(id);if(id===account)summarize(state);}catch{if(id===account)publish({available:false,message:'Local storage is unavailable. Keep this page open until your cloud save is confirmed.'});}}
export function startOfflineSync(id:string){
 if(!id||typeof window==='undefined')return()=>{};
 account=id;sessionCleared=false;publish({...initial,offline:!navigator.onLine});
 if(!window.indexedDB||!navigator.locks){publish({available:false,message:'This browser cannot save offline. Use a current browser with local storage enabled.'});return()=>{};}
 sessionGeneration=readSessionGeneration();
 channel=new BroadcastChannel('lifeapp-offline');channel.onmessage=event=>{if(event.data?.clear){sessionCleared=true;account='';publish({...initial,available:false,invalidated:true,message:'Your account was signed out in another tab. Reload to continue.'});}else void refreshStatus();};
 const online=()=>{publish({offline:false});void syncOfflineWrites();},offline=()=>publish({offline:true});
 window.addEventListener('online',online);window.addEventListener('offline',offline);
 const visible=()=>{if(document.visibilityState==='visible'&&navigator.onLine)void syncOfflineWrites();};document.addEventListener('visibilitychange',visible);
 const timer=setInterval(()=>{if(navigator.onLine)void syncOfflineWrites();},30000);
 void refreshStatus();void syncOfflineWrites();
 if('serviceWorker' in navigator)void navigator.serviceWorker.register('/life-sw.js',{scope:'/'}).then(async registration=>{
  await navigator.serviceWorker.ready;
  const assets=performance.getEntriesByType('resource').map(item=>item.name).filter(url=>new URL(url).origin===window.location.origin);
  (registration.active||navigator.serviceWorker.controller)?.postMessage({type:'life:cache-shell',assets});
 }).catch(()=>{publish({message:'Offline saves work in this tab; reopening offline is unavailable in this browser.'});});
 return()=>{clearInterval(timer);window.removeEventListener('online',online);window.removeEventListener('offline',offline);document.removeEventListener('visibilitychange',visible);channel?.close();channel=null;};
}
export async function syncOfflineWrites(force=false){
 if(!account||!status.available||!navigator.onLine&&!force||flushing)return flushing;
 const id=account;
 flushing=locked(id,async()=>{
  const state=await readData(id);if(!state.writes.length){summarize(state);return;}
  // Authentication and payment pauses can be retried after the user resolves
  // them; conflicts/validation failures always require explicit review.
  for(const write of state.writes)if([401,402,403].includes(write.status||0)){delete write.blocked;delete write.status;}
  publish({syncing:true});
  try{const result=await replayLocalWrites(state,sender(id),()=>writeData(state));if(id===account)publish({message:result.paused,...(!result.paused?{offline:false}:{})});}
  catch{if(id===account)publish({message:'Offline. Changes are saved on this device.'});}
  finally{if(id===account){summarize(state);publish({syncing:false});}}
 }).catch(()=>{if(id===account)publish({available:false,message:'Your browser could not store this save. Keep the editor open and retry online.'});}).finally(()=>{flushing=null;});
 return flushing;
}
export async function lifeFetch(input:string,init?:RequestInit):Promise<Response>{
 // An uninitialized app may use its normal network startup. A formerly bound
 // tab whose session was cleared must never fall back to unbound requests:
 // the browser cookie may now belong to somebody else.
 if(sessionCleared)return unavailable('Your account was signed out. Reload LifeApp before continuing.');
 if(!account||typeof window==='undefined'||!input.startsWith('/api/life')||new URL(input,window.location.origin).pathname!=='/api/life')return fetch(input,init);
 if(!status.available)return nativeFetch(account,input,init);
 const id=account,body=typeof init?.body==='string'?init.body:undefined,isRead=isOfflineRead(input,body);
 if(isRead){
  let revision=0;try{revision=(await readData(id)).revision||0;}catch{publish({available:false,message:'Local storage is unavailable. Cloud reads remain available.'});return nativeFetch(id,input,init);}
  let response:Response|null=null;
  try{if(navigator.onLine)response=await nativeFetch(id,input,init);}catch{}
  if(response){
   if(!response.ok){
    if(response.status<500)return response;
    publish({offline:true});
    try{const cached=await locked(id,async()=>projectRead(await readData(id),input,body));if(cached)return localResponse(cached);}catch{}
    return response;
   }
   if(!accountMatches(id,response))return unavailable('The signed-in account changed. Reload LifeApp before continuing.');
   publish({offline:false});
   try{
    const value=await response.clone().json();
    return await locked(id,async()=>{
     const state=await readData(id);
     // A response that began before a local/cloud acknowledgement cannot
     // replace that newer record when it finally acquires the storage lock.
     if((state.revision||0)!==revision){const current=projectRead(state,input,body);if(current)return localResponse(current);}
     cacheRead(state,input,value,body);await writeData(state,false);return state.writes.length?localResponse(projectRead(state,input,body)||value):response;
    });
   }catch{return id===account?response:unavailable('The signed-in account changed. Reload LifeApp before continuing.');}
  }
  publish({offline:true});
  try{return await locked(id,async()=>{const state=await readData(id),value=projectRead(state,input,body);return value?localResponse(value):unavailable('This page has not been saved on this device yet. Reconnect to open it.');});}
  catch{return unavailable('Local storage is unavailable. Reconnect to open this page.');}
 }
 if(!body)return nativeFetch(id,input,init);
 return locked(id,async()=>{
  const state=await readData(id);
  const same=state.writes.find(item=>item.url===input&&item.body===body);
  if(same)return localResponse(same.result);
  if(state.writes.some(item=>item.blocked))return unavailable('Review your pending offline changes before making another save.');
  const local=prepareLocalWrite(state,input,body);
  if(!local){
   if(state.writes.length||!navigator.onLine)return unavailable('This action needs a connection and confirmed local saves. Your draft is still here.');
   const response=await nativeFetch(id,input,init);
   if(response.ok&&accountMatches(id,response))try{
    const value=await response.clone().json();updateOnlineWriteCache(state,body,value);await writeData(state);
    const action=(JSON.parse(body) as {action?:string}).action;
    if(action==='record-deletion'||action==='trash'){
     // A deleted/purged snapshot must not remain readable from an old cache.
     // Refresh only the account overview; do not replay the mutation if this
     // optional read fails after the cloud already acknowledged deletion.
     const current=await nativeFetch(id,'/api/life');
     if(current.ok&&accountMatches(id,current)){cacheRead(state,'/api/life',await current.json());await writeData(state,false);}
    }
   }catch{}
   return id===account?response:unavailable('The signed-in account changed. Reload LifeApp before continuing.');
  }
  if(state.writes.length>=500)return unavailable('This device has 500 pending saves. Reconnect and sync before adding more. Your current draft is still here.');
  if(new TextEncoder().encode(JSON.stringify([...state.writes,local])).length>8_000_000)return unavailable('This device has reached its local save limit. Reconnect and sync before adding more. Your draft is still here.');
  state.writes.push(local);
  try{await writeData(state);}catch{return unavailable('Your browser could not store this save. Keep the editor open and retry online.');}
  if(state.writes.length>1||!navigator.onLine)return localResponse(local.result);
  local.attempted=true;await writeData(state);
  let response:Response;
  try{response=await nativeFetch(id,input,init);}catch{publish({offline:true,message:'Changes saved on this device. They will sync when you reconnect.'});return localResponse(local.result);}
  if(!accountMatches(id,response)){local.blocked='Sign in to the same account to sync your local changes.';local.status=401;await writeData(state);return localResponse(local.result);}
  if(response.ok){
   try{const result=await response.clone().json();const acknowledged=acknowledgeWrite(state,local,result);await writeData(state);return acknowledged?response:localResponse(local.result);}catch{return id===account?localResponse(local.result):unavailable('The signed-in account changed. Reload LifeApp before continuing.');}
  }
  if(response.status>=400&&response.status<500){
   // This request has never had an ambiguous attempt. Its explicit rejection
   // belongs in the original editor, whose local draft remains unchanged.
   state.writes=state.writes.filter(item=>item.id!==local.id);await writeData(state);return response;
  }
  return localResponse(local.result);
 }).catch(()=>unavailable('Local storage is unavailable. Keep your draft open and retry.'));
}
export async function downloadOfflineChanges(){
 if(!account)return;const data=await locked(account,()=>readData(account));
 const url=URL.createObjectURL(new Blob([JSON.stringify({format:'LifeApp local saves',savedAt:new Date().toISOString(),changes:data.writes.map(item=>({createdAt:item.createdAt,request:JSON.parse(item.body),localResult:item.result,error:item.blocked||null}))},null,2)],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;link.download='LifeApp-local-changes.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function discardRejectedOfflineChanges(){
 const id=account;if(!id)return;
 await locked(id,async()=>{const data=await readData(id);if(!data.writes.some(item=>item.status&&item.status>=400&&item.status<500&&![401,402,403].includes(item.status)))throw Error('Confirm your pending saves before discarding them.');data.writes=[];data.reads=[];await writeData(data);});
 publish({message:''});
}
export async function hasOfflineChanges(){
 if(typeof indexedDB==='undefined')return false;
 const db=await openDatabase();return new Promise<boolean>((resolve,reject)=>{const request=db.transaction('accounts').objectStore('accounts').getAll();request.onsuccess=()=>resolve(request.result.some((item:OfflineData)=>item.writes.length));request.onerror=()=>reject(request.error);});
}
async function clearOfflineDataUnlocked(){
 const notice=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('lifeapp-offline'):null;notice?.postMessage({clear:true});
 account='';sessionCleared=true;publish({...initial,invalidated:true});
 for(const request of requests)request.abort();
 if(typeof indexedDB!=='undefined'){
  const db=await openDatabase();
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction(['accounts','metadata'],'readwrite');tx.objectStore('accounts').clear();tx.objectStore('metadata').put(crypto.randomUUID(),'generation');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
 }
 if(typeof caches!=='undefined')for(const name of await caches.keys())if(name.startsWith('lifeapp-'))await caches.delete(name);
 navigator.serviceWorker?.controller?.postMessage({type:'life:clear-private'});notice?.close();
}
export async function clearOfflineData(){
 for(const request of requests)request.abort();
 if(navigator.locks)await navigator.locks.request('lifeapp-offline-session',clearOfflineDataUnlocked);
 else await clearOfflineDataUnlocked();
}
export async function signOutWithOfflineProtection(signOut:()=>Promise<void>){
 const run=async()=>{
  if(await hasOfflineChanges())throw Error('You have saves stored only on this device. Return to LifeApp and sync or review them before signing out.');
  await signOut();await clearOfflineDataUnlocked();
 };
 // The exclusive session lock closes the gap between checking pending saves
 // and signing out. Another tab cannot enqueue a new save during this boundary.
 if(navigator.locks)await navigator.locks.request('lifeapp-offline-session',run);else await run();
}
