"use client";
import {useId,useRef,useState,type AriaAttributes} from 'react';
import {CalendarDays,X} from 'lucide-react';
import {Calendar} from '@/components/ui/calendar';
import {Popover,PopoverAnchor,PopoverContent} from '@/components/ui/popover';
import {Button} from '@/components/ui/button';
import {formatDate,formatMonth,isCalendarDate} from '@/lib/life/date-display';

type Props=Pick<AriaAttributes,'aria-label'|'aria-labelledby'|'aria-describedby'> & {
 label?:string;value:string;onValueChange:(value:string)=>void;id?:string;name?:string;
 min?:string;max?:string;disabled?:boolean;required?:boolean;clearable?:boolean;
 title?:string;className?:string;
};
const localDate=(value:string)=>{
 const date=new Date(0);
 date.setFullYear(Number(value.slice(0,4)),Number(value.slice(5,7))-1,Number(value.slice(8,10)));
 date.setHours(12,0,0,0);
 return date;
};
const dateValue=(date:Date)=>`${String(date.getFullYear()).padStart(4,'0')}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const validValue=(value:string,type:'date'|'month')=>type==='date'?isCalendarDate(value):/^\d{4}-(0[1-9]|1[0-2])$/.test(value);

// The visible value has a stable format even when Firefox/Android formats the
// native date control differently. The actual picker keeps canonical ISO data.
// Only a complete, in-range selection can call the parent; cancelling the
// picker cannot leave a hidden invalid draft or save an earlier date by mistake.
function CalendarInput({type,label:fieldLabel,value,onValueChange,id,name,min,max,disabled,required,clearable=false,title,className,...aria}:Props&{type:'date'|'month'}){
 const generatedId=useId(),controlId=id||generatedId,native=useRef<HTMLInputElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const [open,setOpen]=useState(false),[choice,setChoice]=useState(value.slice(0,7));
 const today=dateValue(new Date()),shown=type==='date'?formatDate(value):formatMonth(value);
 const selected=validValue(value,type)?value:type==='date'?today:today.slice(0,7);
 const fromYear=Math.min(Number(selected.slice(0,4)),min?Number(min.slice(0,4)):1900);
 const throughYear=Math.max(Number(selected.slice(0,4)),max?Number(max.slice(0,4)):new Date().getFullYear()+100);
 const inRange=(next:string)=>validValue(next,type)&&(!min||next>=min)&&(!max||next<=max);
 function change(next:string){
  if(next===value)return;
  if(!next){if(clearable&&!required)onValueChange('');return;}
  if(inRange(next))onValueChange(next);
 }
 function openPicker(){
  if(disabled||trigger.current?.matches(':disabled'))return;
  const input=native.current;
  if(input&&input.type===type&&typeof input.showPicker==='function'){
   try{input.showPicker();return;}catch{/* Accessible fallback if the platform has no picker. */}
  }
  setChoice(selected.slice(0,7));setOpen(true);
 }
 function openFallback(){if(!disabled&&!trigger.current?.matches(':disabled')){setChoice(selected.slice(0,7));setOpen(true);}}
 const label=aria['aria-label']||fieldLabel||(type==='date'?'Choose date':'Choose month');
 return <>{fieldLabel&&<label htmlFor={controlId}>{fieldLabel}</label>}<Popover open={open} onOpenChange={setOpen}>
  <PopoverAnchor asChild><span className={`calendar-input ${className||''}`} style={{display:'block',position:'relative',width:'100%',minWidth:0}}>
   <input ref={native} type={type} name={name} value={value} min={min} max={max} disabled={disabled} required={required} tabIndex={-1} aria-hidden="true" onInput={event=>change(event.currentTarget.value)} onChange={()=>{}} style={{position:'absolute',inset:0,opacity:0,pointerEvents:'none',width:'100%',height:'100%',minWidth:0}}/>
   <button ref={trigger} id={controlId} type="button" className="calendar-input-trigger" aria-label={aria['aria-label']?`${aria['aria-label']}: ${value?shown:type==='date'?'MM/DD/YYYY':'MM/YYYY'}`:undefined} aria-labelledby={aria['aria-labelledby']} aria-describedby={aria['aria-describedby']} aria-haspopup="dialog" aria-expanded={open||undefined} disabled={disabled} title={title} onClick={openPicker} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();openFallback();}}} style={{position:'relative',display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,width:'100%',minHeight:44,padding:'10px 12px',border:'1px solid var(--input)',borderRadius:4,background:'var(--card)',color:'var(--foreground)',font:'inherit',textAlign:'left'}}>
    <span>{value?shown:type==='date'?'MM/DD/YYYY':'MM/YYYY'}</span><CalendarDays aria-hidden="true" size={18} style={{marginLeft:clearable&&!required&&value?36:0,flexShrink:0}}/>
   </button>
   {clearable&&!required&&value&&<button type="button" className="calendar-input-clear" aria-label={`Clear ${aria['aria-label']||type}`} disabled={disabled} onClick={()=>change('')} style={{position:'absolute',right:32,top:0,bottom:0,width:36,display:'grid',placeItems:'center',border:0,background:'transparent',color:'var(--muted-foreground)'}}><X aria-hidden="true" size={16}/></button>}
  </span></PopoverAnchor>
  <PopoverContent container={trigger.current?.closest('dialog')||undefined} className="calendar-input-popover" align="start" aria-label={label} onEscapeKeyDown={event=>{event.preventDefault();event.stopPropagation();setOpen(false);}} onCloseAutoFocus={event=>{event.preventDefault();trigger.current?.focus({preventScroll:true});}} style={{width:'max-content',maxWidth:'calc(100vw - 24px)',padding:8}}>
   {type==='date'?<Calendar mode="single" captionLayout="dropdown" month={undefined} defaultMonth={localDate(selected)} selected={value&&isCalendarDate(value)?localDate(value):undefined} startMonth={localDate(`${String(fromYear).padStart(4,'0')}-01-01`)} endMonth={localDate(`${String(throughYear).padStart(4,'0')}-12-31`)} disabled={[...(min?[{before:localDate(min)}]:[]),...(max?[{after:localDate(max)}]:[])]} onSelect={date=>{if(date){change(dateValue(date));setOpen(false);}}}/>:<div className="calendar-month-options" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,padding:8}}>
    <label>Month<select aria-label="Month" value={choice.slice(5,7)} onInput={event=>setChoice(choice.slice(0,4)+'-'+event.currentTarget.value)} onChange={event=>setChoice(choice.slice(0,4)+'-'+event.target.value)}>{Array.from({length:12},(_,index)=>String(index+1).padStart(2,'0')).map(month=><option key={month} value={month}>{month}</option>)}</select></label>
    <label>Year<select aria-label="Year" value={choice.slice(0,4)} onInput={event=>setChoice(event.currentTarget.value+choice.slice(4))} onChange={event=>setChoice(event.target.value+choice.slice(4))}>{Array.from({length:throughYear-fromYear+1},(_,index)=>String(fromYear+index).padStart(4,'0')).map(year=><option key={year} value={year}>{year}</option>)}</select></label>
    <Button disabled={!inRange(choice)} onClick={()=>{change(choice);setOpen(false);}}>Choose month</Button>
   </div>}
   <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>{clearable&&!required&&<Button variant="ghost" onClick={()=>{change('');setOpen(false);}}>Clear</Button>}<Button variant="ghost" onClick={()=>setOpen(false)}>Cancel</Button></div>
  </PopoverContent>
 </Popover></>;
}

export function DateInput(props:Props){return <CalendarInput {...props} type="date"/>;}
export function MonthInput(props:Props){return <CalendarInput {...props} type="month"/>;}
