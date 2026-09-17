"use client";
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {parseMoney} from '@/lib/life/modules';

export type DirtyReporter=(id:string,dirty:boolean)=>void;
// Authentication on a later attempt cannot settle an earlier lost write.
export function definiteBudgetRejection(status:number|undefined,retrying:boolean){return !!status&&status>=400&&status<500&&!(retrying&&(status===401||status===403));}
export function useBudgetDirty(id:string,dirty:boolean,report:DirtyReporter){useEffect(()=>{report(id,dirty);return()=>report(id,false);},[id,dirty,report]);}
export function CurrencyInput({label,value,onChange,placeholder='0.00',ariaLabel}:{label:string;value:string;onChange:(value:string)=>void;placeholder?:string;ariaLabel?:string}){
 return <label className="compact-field">{label}<span className="currency-input"><span aria-hidden="true">$</span><input aria-label={ariaLabel} inputMode="decimal" placeholder={placeholder} value={value} onChange={e=>onChange(e.target.value.replace(/^\s*\$\s*/, '').replaceAll(',',''))} onBlur={()=>{try{if(value.trim())onChange((parseMoney(value)/100).toFixed(2));}catch{}}}/></span></label>;
}
export function useItemSave<T,R>(save:(item:T)=>Promise<R>){
 const [busy,setBusy]=useState(false),[pending,setPending]=useState<T|null>(null),[error,setError]=useState('');
 async function submit(item:T){const retrying=!!pending,submitted=pending||item;setBusy(true);setPending(submitted);setError('');try{const result=await save(submitted);setPending(null);return result;}catch(e){setError((e as Error).message);const status=(e as {status?:number}).status;if(definiteBudgetRejection(status,retrying))setPending(null);return null;}finally{setBusy(false);}}
 return {busy,pending,error,setError,submit};
}
export function SaveItemButton<T,R>({id,label,item,save,onDirty}:{id:string;label:string;item:T;save:(item:T)=>Promise<R>;onDirty:DirtyReporter}){
 const operation=useItemSave(save);useBudgetDirty(id,operation.busy||!!operation.pending,onDirty);
 return <span className="item-restore"><Button variant="ghost" disabled={operation.busy} onClick={()=>void operation.submit(operation.pending||item)}>{operation.busy?'Saving…':operation.pending?'Retry save':label}</Button>{operation.error&&<small className="error" role="alert">{operation.error}</small>}</span>;
}
