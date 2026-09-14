"use client";
import {useContext,useEffect,useRef,useState} from 'react';
import {WorkoutToolVisible} from './shared';
import {Mic,Square} from 'lucide-react';
import {Button} from '@/components/ui/button';
type Recognition={lang:string;continuous:boolean;interimResults:boolean;onresult:((event:{results:ArrayLike<{isFinal:boolean;0:{transcript:string}}>})=>void)|null;onerror:((event:{error:string})=>void)|null;onend:(()=>void)|null;start:()=>void;stop:()=>void;abort:()=>void};
type SpeechWindow=Window&{SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition};
export default function Dictation({value,onChange,onListening,disabled=false,maxLength=5000}:{value:string;onChange:(text:string)=>void;onListening:(v:boolean)=>void;disabled?:boolean;maxLength?:number}){
 const visible=useContext(WorkoutToolVisible);
 const [supported,setSupported]=useState(false),[listening,setListening]=useState(false),[error,setError]=useState('');const recognition=useRef<Recognition|null>(null),callback=useRef(onChange);callback.current=onChange;
 useEffect(()=>{const w=window as SpeechWindow;setSupported(!!(w.SpeechRecognition||w.webkitSpeechRecognition));return()=>{const r=recognition.current;if(r){r.onresult=null;r.onend=null;r.onerror=null;r.abort();}};},[]);
 useEffect(()=>{onListening(listening);return()=>onListening(false);},[listening,onListening]);
 useEffect(()=>{if(!visible){const r=recognition.current;if(r){r.onresult=null;r.onend=null;r.onerror=null;r.abort();recognition.current=null;}setListening(false);setError('');}},[visible]);
 function start(){setError('');const w=window as SpeechWindow,Ctor=w.SpeechRecognition||w.webkitSpeechRecognition;if(!Ctor)return;const r=new Ctor(),prefix=value.trim()?value.trim()+'\n':'';recognition.current=r;r.lang=navigator.language||'en-US';r.continuous=true;r.interimResults=false;
  r.onresult=event=>{const text=prefix+Array.from(event.results).filter(x=>x.isFinal).map(x=>x[0].transcript).join(' ');if(text.length>maxLength){setError('The text limit was reached. Shorten the text before continuing dictation.');r.stop();return;}callback.current(text);};
  r.onerror=e=>{setError(e.error==='not-allowed'?'Microphone access was not allowed. You can type or use keyboard dictation.':'Dictation stopped. Your text is still here.');setListening(false);};r.onend=()=>setListening(false);
  try{r.start();setListening(true);}catch{setError('Dictation could not start. You can type or use keyboard dictation.');}
 }
 return <div className="dictation-controls">{supported?<><Button variant="ghost" disabled={disabled&&!listening} onClick={()=>listening?recognition.current?.stop():start()}>{listening?<Square/>:<Mic/>}{listening?'Stop dictation':'Dictate'}</Button><small>{listening?'Listening…':'Uses your browser’s speech service.'}</small></>:<small>Type or use your keyboard’s microphone to dictate.</small>}{error&&<small role="status">{error}</small>}</div>;
}
