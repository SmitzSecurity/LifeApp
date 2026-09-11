"use client";
import { useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ResourceKind, Saved } from '@/lib/life/modules';
export function Choice({label,value,onChange,options}:{label:string;value:string;onChange:(v:string)=>void;options:{value:string;label:string}[]}){return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label}><SelectValue placeholder={label}/></SelectTrigger><SelectContent>{options.map(o=><SelectItem value={o.value} key={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>;}
export async function request(path:string,body?:unknown){const r=await fetch('/api/life'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store'});const value=await r.json();if(!r.ok)throw Object.assign(new Error(value.error||'Could not save. Please try again.'),{status:r.status,record:value.record});return value;}
export async function saveRecord<T>(kind:ResourceKind,record:Saved<T>):Promise<Saved<T>>{return (await request('',{action:'resource',record:{kind,id:record.id,version:record.version,data:record.data}})).record;}
export function useUnsaved(dirty:boolean,onDirty:(v:boolean)=>void){useEffect(()=>{onDirty(dirty);return()=>onDirty(false);},[dirty,onDirty]);}
