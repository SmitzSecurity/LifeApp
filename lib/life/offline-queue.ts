import {emptyEntry,entryInputSchema,profileSchema,type Entry} from './domain.ts';
import {resourceSchemas,type ResourceKind} from './modules.ts';

type ObjectValue=Record<string,unknown>;
export type CachedRead={url:string;body?:string;value:ObjectValue;at:number};
export type LocalWrite={id:string;url:string;body:string;scope:string;result:ObjectValue;createdAt:string;attempted:boolean;blocked?:string;status?:number};
export type OfflineData={account:string;reads:CachedRead[];writes:LocalWrite[];revision?:number};
const object=(value:unknown):ObjectValue=>value&&typeof value==='object'&&!Array.isArray(value)?value as ObjectValue:{};
const resources=new Set(['budget','transaction','routine','workout','cardio','workout-note']);
export function freshOfflineData(account:string):OfflineData{return {account,reads:[],writes:[]};}
export function readKey(url:string,body?:string){return url+'\n'+(body||'');}
export function cacheRead(state:OfflineData,url:string,value:ObjectValue,body?:string){
 if(new TextEncoder().encode(JSON.stringify(value)).length>2_000_000)return;
 const key=readKey(url,body);state.reads=state.reads.filter(item=>readKey(item.url,item.body)!==key);
 state.reads.push({url,body,value:structuredClone(value),at:Date.now()});
 // Bound browser storage; queued writes are never evicted.
 const evict=()=>{const index=state.reads.findIndex(item=>item.url!=='/api/life'||!!item.body);state.reads.splice(index<0?0:index,1);};
 while(state.reads.length>100)evict();
 while(state.reads.length>1&&new TextEncoder().encode(JSON.stringify(state.reads)).length>8_000_000)evict();
}
export function isOfflineRead(url:string,body?:string){
 const params=new URL(url,'https://life.invalid').searchParams;
 if(params.has('export')||params.has('access'))return false;
 if(!body)return true;
 try{return object(JSON.parse(body)).action==='history';}catch{return false;}
}
function applyWrite(value:ObjectValue,url:string,body:string|undefined,write:Pick<LocalWrite,'body'|'result'>):ObjectValue{
 const request=object(JSON.parse(write.body)),params=new URL(url,'https://life.invalid').searchParams,result=write.result;
 if(request.action==='resource'){
  const resource=object(request.record),record=object(result.record);
  if(params.get('kind')===resource.kind&&Array.isArray(value.records)){
   const month=params.get('month'),data=object(record.data),period=resource.kind==='budget'?record.id:String(data.date||'').slice(0,7);
   if(month&&month!==period)return value;
   return {...value,records:[record,...value.records.filter(item=>object(item).id!==record.id)]};
  }
 }
 if(request.action==='entry'){
  const entry=object(result.entry);
  if(params.get('date')===entry.date)return {...value,entry};
  if(Array.isArray(value.entries)){
   if(body){
    const filters=object(object(JSON.parse(body)).filters),date=String(entry.date);
    const match=(!filters.from||date>=String(filters.from))&&(!filters.through||date<=String(filters.through))&&(!filters.before||date<String(filters.before))&&(!filters.query||String(entry.journal).toLocaleLowerCase().includes(String(filters.query).toLocaleLowerCase()))&&(filters.status!=='complete'||entry.complete)&&(filters.status!=='draft'||!entry.complete)&&!filters.deleted;
    return {...value,entries:[...(match?[entry]:[]),...value.entries.filter(item=>object(item).date!==date)].sort((a,b)=>String(object(b).date).localeCompare(String(object(a).date)))};
   }
   return {...value,entries:[entry,...value.entries.filter(item=>object(item).date!==entry.date)].sort((a,b)=>String(object(b).date).localeCompare(String(object(a).date)))};
  }
 }
 return value;
}
export function projectRead(state:OfflineData,url:string,body?:string):ObjectValue|null{
 const found=state.reads.find(item=>readKey(item.url,item.body)===readKey(url,body));
 let value=found?.value;
 const params=new URL(url,'https://life.invalid').searchParams;
 if(!value&&params.has('date')){
  const root=state.reads.find(item=>item.url==='/api/life'&&!item.body)?.value;
  if(root&&Array.isArray(root.entries)){
   const date=params.get('date')!,entry=root.entries.find(item=>object(item).date===date),oldest=root.entries.map(item=>String(object(item).date)).sort()[0];
   // The initial API returns at most 366 rows. An older uncached date is
   // unknown, so it must not be presented as a new empty response offline.
   if(entry||root.entries.length<366||date>=oldest)value={entry:entry||null};
  }
 }
 if(!value&&body){
  const root=state.reads.find(item=>item.url==='/api/life'&&!item.body)?.value;
  if(root&&Array.isArray(root.entries)&&object(JSON.parse(body)).action==='history'){
   // The offline history is explicitly labelled cached by the global banner.
   value={entries:[],nextCursor:null};
   for(const entry of root.entries)value=applyWrite(value,url,body,{body:JSON.stringify({action:'entry'}),result:{entry}});
  }
 }
 if(!value)return null;
 return state.writes.reduce((current,write)=>applyWrite(current,url,body,write),structuredClone(value));
}
export function validWriteAcknowledgement(write:LocalWrite,result:ObjectValue){
 const request=object(JSON.parse(write.body));
 if(request.action==='resource'){
  const expected=object(request.record),record=object(result.record),kind=String(expected.kind) as ResourceKind;
  if(record.id!==expected.id||!Number.isSafeInteger(record.version)||Number(record.version)<=0)return false;
  const parsed=resourceSchemas[kind]?.safeParse(record.data);if(!parsed?.success)return false;
  let submitted=object(expected.data);
  if(kind==='transaction')submitted={...submitted,categoryId:submitted.kind==='expense'?submitted.categoryId:'',categoryName:object(parsed.data).categoryName,...(submitted.planned?{expectedDate:submitted.expectedDate||submitted.date}:{})};
  const normalized=resourceSchemas[kind].safeParse(submitted);
  return normalized.success&&JSON.stringify(normalized.data)===JSON.stringify(parsed.data);
 }
 if(request.action==='entry'){
  const expected=object(request.entry),entry=object(result.entry);
  if(entry.date!==expected.date||entry.mutationId!==expected.mutationId||!Number.isSafeInteger(entry.version)||Number(entry.version)<=0||!Array.isArray(entry.habits))return false;
  return entry.journal===expected.journal&&!!entry.complete===!!expected.complete&&JSON.stringify(entry.context)===JSON.stringify(expected.context)&&JSON.stringify(entry.habits.map(item=>({id:object(item).id,status:object(item).status})))===JSON.stringify(expected.statuses);
 }
 return false;
}
export function acknowledgeWrite(state:OfflineData,write:LocalWrite,result:ObjectValue){
 if(!validWriteAcknowledgement(write,result))return false;
 const acknowledged={...write,result};
 state.reads=state.reads.map(item=>({...item,value:applyWrite(item.value,item.url,item.body,acknowledged)}));
 state.writes=state.writes.filter(item=>item.id!==write.id);
 const expected=object(write.result.record||write.result.entry).version,actual=object(result.record||result.entry).version;
 if(actual!==expected){
  const next=state.writes.find(item=>item.scope===write.scope);
  if(next){next.blocked='The cloud acknowledged a different revision. Review your local changes before continuing.';next.status=409;}
 }
 return true;
}
export function updateOnlineWriteCache(state:OfflineData,body:string,result:ObjectValue){
 const request=object(JSON.parse(body));
 if(result.profile){
  const parsed=profileSchema.safeParse(result.profile);
  if(parsed.success)state.reads=state.reads.map(item=>item.url==='/api/life'&&!item.body?{...item,value:{...item.value,profile:parsed.data}}:item);
 }
 if(request.action==='budget-item'){
  const change=object(request.change),record=object(result.record),parsed=resourceSchemas.budget.safeParse(record.data);
  if(record.id===change.month&&parsed.success){
   const records=[record,...(Array.isArray(result.plans)?result.plans.map(object).filter(plan=>plan.id!==record.id&&resourceSchemas.budget.safeParse(plan.data).success):[])];
   for(const saved of records){const write={body:JSON.stringify({action:'resource',record:{kind:'budget'}}),result:{record:saved}};
    state.reads=state.reads.map(item=>({...item,value:applyWrite(item.value,item.url,item.body,write)}));}
  }
 }
 if(request.action==='record-deletion'||request.action==='trash')state.reads=[];
}
export function prepareLocalWrite(state:OfflineData,url:string,body:string,now=new Date()):LocalWrite|null{
 if(new TextEncoder().encode(body).length>65536||new URL(url,'https://life.invalid').search)return null;
 const request=object(JSON.parse(body)),createdAt=now.toISOString();let result:ObjectValue,scope:string;
 if(request.action==='resource'){
  const record=object(request.record),kind=String(record.kind),data=object(record.data);
  if(!resources.has(kind)||data.deleted||data.voided||data.archived||!Number.isSafeInteger(record.version)||Number(record.version)<0||typeof record.id!=='string')return null;
  const parsed=resourceSchemas[kind as ResourceKind].safeParse(data);if(!parsed.success)return null;
  result={record:{id:record.id,version:Number(record.version)+1,data:parsed.data,updatedAt:createdAt}};scope=kind+':'+record.id;
 }else if(request.action==='entry'){
  const parsed=entryInputSchema.safeParse(request.entry);if(!parsed.success||!parsed.data.mutationId)return null;
  const input=parsed.data,root=projectRead(state,'/api/life'),profile=profileSchema.safeParse(root?.profile);if(!profile.success)return null;
  const existing=projectRead(state,'/api/life?date='+encodeURIComponent(input.date))?.entry;
  const base=existing?existing as Entry:emptyEntry(profile.data,input.date);
  if(base.deleted||base.version!==input.version)return null;
  const statuses=new Map(input.statuses.map(item=>[item.id,item.status]));
  if(statuses.size!==base.habits.length||base.habits.some(item=>!statuses.has(item.id)))return null;
  result={entry:{...base,...input,habits:base.habits.map(item=>({...item,status:statuses.get(item.id)})),version:input.version+1,updatedAt:createdAt}};scope='entry:'+input.date;
  delete object(result.entry).statuses;
 }else return null;
 return {id:crypto.randomUUID(),url,body,scope,result,createdAt,attempted:false};
}
export function accountMatches(expected:string,response:Response){return response.headers.get('X-Life-Account')===expected;}

// Replays immutable bytes in order. The caller holds the cross-tab browser lock
// and durably saves before/after each network request. No provider action can
// enter this queue, and the server checks the account header on every write.
export async function replayLocalWrites(state:OfflineData,send:(url:string,body?:string)=>Promise<Response>,persist:()=>Promise<void>){
 const identity=await send('/api/life?offline-account=1');
 if(!identity.ok||!accountMatches(state.account,identity))return {paused:'Sign in to the same account to sync your local changes.'};
 for(const write of [...state.writes]){
  if(write.blocked)return {paused:write.blocked};
  write.attempted=true;await persist();
  let response:Response;try{response=await send(write.url,write.body);}catch{return {paused:'Offline. Changes are saved on this device.'};}
  if(!accountMatches(state.account,response))return {paused:'The signed-in account changed. Local changes have not been sent to another account.'};
  let value:ObjectValue;try{value=object(await response.json());}catch{return {paused:'Waiting to confirm the cloud save. Your local changes are safe.'};}
  if(!response.ok){
   if(response.status>=400&&response.status<500){write.blocked=String(value.error||'This save needs your review.');write.status=response.status;await persist();}
   return {paused:write.blocked||'Waiting to confirm the cloud save. Your local changes are safe.'};
  }
  if(!acknowledgeWrite(state,write,value))return {paused:'Waiting for a valid acknowledgement of this exact save. Your local changes are safe.'};
  await persist();
 }
 return {paused:''};
}
