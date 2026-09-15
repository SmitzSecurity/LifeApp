// Calendar dates are identifiers, not instants: never pass YYYY-MM-DD through
// the device timezone when presenting a journal, payment or workout date.
export function isCalendarDate(value:string):boolean {
 const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
 if(!match)return false;
 const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
 if(month<1||month>12||day<1)return false;
 const leap=year%4===0&&(year%100!==0||year%400===0);
 return day<=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][month-1];
}

export function formatDate(value:string|null|undefined):string {
 return value&&isCalendarDate(value)?`${value.slice(5,7)}/${value.slice(8,10)}/${value.slice(0,4)}`:'—';
}

export function formatMonth(value:string|null|undefined):string {
 return value&&/^\d{4}-(0[1-9]|1[0-2])$/.test(value)?`${value.slice(5,7)}/${value.slice(0,4)}`:'—';
}

// Return null for unfinished or invalid text. Callers must preserve that draft
// and block saving; they must not silently submit an earlier valid date.
export function parseDisplayDate(value:string):string|null {
 const match=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
 if(!match)return null;
 const iso=`${match[3]}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`;
 return isCalendarDate(iso)?iso:null;
}

export function parseDisplayMonth(value:string):string|null {
 const match=/^(\d{1,2})\/(\d{4})$/.exec(value.trim());
 if(!match||Number(match[1])<1||Number(match[1])>12)return null;
 return `${match[2]}-${match[1].padStart(2,'0')}`;
}

export function formatTimestampDate(value:string,timeZone?:string):string {
 const date=new Date(value);
 if(!Number.isFinite(date.valueOf()))return '—';
 return new Intl.DateTimeFormat('en-US',{timeZone,month:'2-digit',day:'2-digit',year:'numeric'}).format(date);
}

export function formatDateTime(value:string,timeZone?:string):string {
 const date=new Date(value);
 if(!Number.isFinite(date.valueOf()))return '—';
 return new Intl.DateTimeFormat('en-US',{timeZone,month:'2-digit',day:'2-digit',year:'numeric',hour:'numeric',minute:'2-digit'}).format(date);
}
