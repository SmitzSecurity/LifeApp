// Drafts must preserve an empty/unfinished number instead of turning it into 0.
// NaN is a local invalid marker; it must never reach JSON, which coerces it to null.
export function numericDraftValue(text:string,optional=false):number|null{
 const raw=text.trim();
 if(!raw)return optional?null:NaN;
 if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw))return NaN;
 const value=Number(raw);return Number.isFinite(value)?value:NaN;
}
export function numericDraftText(value:number|null|undefined){return typeof value==='number'&&Number.isFinite(value)?String(value):'';}
export function assertFiniteNumbers(value:unknown):void{
 if(typeof value==='number'&&!Number.isFinite(value))throw Object.assign(new Error('Complete the unfinished number fields before saving.'),{status:400});
 if(Array.isArray(value)){for(const item of value)assertFiniteNumbers(item);}
 else if(value&&typeof value==='object'){for(const item of Object.values(value))assertFiniteNumbers(item);}
}
