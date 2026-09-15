"use client";
import {useState,type InputHTMLAttributes} from 'react';
import {numericDraftText,numericDraftValue} from '@/lib/life/numeric-draft';

type Props=Omit<InputHTMLAttributes<HTMLInputElement>,'type'|'value'|'defaultValue'|'onChange'|'min'|'max'> & {min?:number;max?:number} & (
 {optional?:false;value:number;onValueChange:(value:number)=>void}|
 {optional:true;value:number|null;onValueChange:(value:number|null)=>void}
);
export default function NumericInput({value,onValueChange,optional=false,min,max,step=1,inputMode,...props}:Props){
 const [draft,setDraft]=useState(()=>({source:value,text:numericDraftText(value)}));
 // Keep raw decimal/empty edits until the parent explicitly supplies another value.
 if(!Object.is(draft.source,value))setDraft({source:value,text:numericDraftText(value)});
 const invalid=typeof value==='number'&&(!Number.isFinite(value)||(min!==undefined&&value<min)||(max!==undefined&&value>max));
 function change(text:string){
  const next=numericDraftValue(text,optional);setDraft({source:next,text});
  // Required fields return NaN for unfinished input; optional empty fields return null.
  if(optional)(onValueChange as (value:number|null)=>void)(next);else (onValueChange as (value:number)=>void)(next as number);
 }
 return <input {...props} type="text" inputMode={inputMode||(step===1?'numeric':'decimal')} min={min} max={max} step={step} aria-invalid={invalid||undefined} value={Object.is(draft.source,value)?draft.text:numericDraftText(value)} onInput={e=>change(e.currentTarget.value)} onChange={e=>change(e.currentTarget.value)}/>;
}
