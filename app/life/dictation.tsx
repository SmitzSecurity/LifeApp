"use client";
import {useContext,useEffect,useRef,useState} from 'react';
import {WorkoutToolVisible} from './shared';
import {Mic,Square} from 'lucide-react';
import {Button} from '@/components/ui/button';
type Recognition={lang:string;continuous:boolean;interimResults:boolean;onresult:((event:{results:ArrayLike<{isFinal:boolean;0:{transcript:string}}>})=>void)|null;onerror:((event:{error:string})=>void)|null;onend:(()=>void)|null;start:()=>void;stop:()=>void;abort:()=>void};
type SpeechWindow=Window&{SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition};
export default function Dictation({value,onChange,onListening,disabled=false,maxLength=5000,compact=false}:{value:string;onChange:(text:string)=>void;onListening:(v:boolean)=>void;disabled?:boolean;maxLength?:number;compact?:boolean}){
 const visible=useContext(WorkoutToolVisible);
 const [supported,setSupported]=useState(false),[listening,setListening]=useState(false),[error,setError]=useState('');const recognition=useRef<Recognition|null>(null),callback=useRef(onChange);callback.current=onChange;
 useEffect(()=>{const w=window as SpeechWindow;setSupported(!!(w.SpeechRecognition||w.webkitSpeechRecognition));return()=>{const r=recognition.current;recognition.current=null;if(r){r.onresult=null;r.onend=null;r.onerror=null;r.abort();}};},[]);
 useEffect(()=>{onListening(listening);return()=>onListening(false);},[listening,onListening]);
 useEffect(()=>{if(!visible){const r=recognition.current;if(r){r.onresult=null;r.onend=null;r.onerror=null;r.abort();recognition.current=null;}setListening(false);setError('');}},[visible]);
 function start(){setError('');const w=window as SpeechWindow,Ctor=w.SpeechRecognition||w.webkitSpeechRecognition;if(!Ctor)return;const r=new Ctor(),prefix=value?value+(/\s$/.test(value)?'':'\n'):'';recognition.current=r;r.lang=navigator.language||'en-US';r.continuous=true;r.interimResults=true;
  const finish=()=>{r.onresult=null;r.onend=null;r.onerror=null;if(recognition.current===r){recognition.current=null;setListening(false);}};
  // Results include the whole session. Replace the provisional phrase as the
  // browser refines it; appending each event would duplicate spoken words.
  r.onresult=event=>{if(recognition.current!==r)return;const transcript=Array.from(event.results).map(x=>x[0].transcript).join(' ');if(!transcript)return;const text=prefix+transcript;if(text.length>maxLength){setError('The text limit was reached. Shorten the text before continuing dictation.');finish();r.abort();return;}callback.current(text);};
  r.onerror=e=>{setError(e.error==='not-allowed'?'Microphone access was not allowed. You can type or use keyboard dictation.':'Dictation stopped. Your text is still here.');finish();r.abort();};r.onend=finish;
  try{r.start();setListening(true);}catch{finish();setError('Dictation could not start. You can type or use keyboard dictation.');}
 }
 return <div className={`dictation-controls${compact?' compact-dictation':''}`}><Button type="button" variant="ghost" disabled={!supported||disabled&&!listening} title={supported?(listening?'Stop dictation':'Dictate using your browser’s speech service'):'Use your keyboard’s microphone to dictate in this browser.'} aria-label={listening?'Stop dictation':'Dictate'} aria-pressed={listening} onClick={()=>listening?recognition.current?.stop():start()}>{compact?<Mic aria-hidden="true"/>:listening?<Square/>:<Mic/>}{!compact&&(listening?'Stop dictation':'Dictate')}</Button>{(!compact||!supported||listening)&&<small role={listening?'status':undefined}>{supported?(listening?'Listening…':'Uses your browser’s speech service.'):'Use your keyboard’s microphone to dictate in this browser.'}</small>}{error&&<small role="status">{error}</small>}</div>;
}
