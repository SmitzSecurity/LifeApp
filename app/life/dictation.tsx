"use client";
import {useCallback,useContext,useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore,type RefObject} from 'react';
import {WorkoutToolVisible} from './shared';
import {Mic,Square} from 'lucide-react';
import {Button} from '@/components/ui/button';
type Recognition={lang:string;continuous:boolean;interimResults:boolean;onresult:((event:{results:ArrayLike<{isFinal:boolean;0:{transcript:string}}>})=>void)|null;onerror:((event:{error:string})=>void)|null;onend:(()=>void)|null;onspeechstart:(()=>void)|null;onspeechend:(()=>void)|null;start:()=>void;stop:()=>void;abort:()=>void};
type SpeechWindow=Window&{SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition};
type Props={value:string;onChange:(text:string)=>void;onListening:(v:boolean)=>void;disabled?:boolean;maxLength?:number;compact?:boolean;cancelRef?:RefObject<(()=>void)|null>};
const subscribeToCapability=()=>()=>{};
const supportsRecognition=()=>{const w=window as SpeechWindow;return !!(w.SpeechRecognition||w.webkitSpeechRecognition);};
const noServerRecognition=()=>false;
export default function Dictation(props:Props){
 const visible=useContext(WorkoutToolVisible);
 return visible?<DictationControl {...props}/>:null;
}
function DictationControl({value,onChange,onListening,disabled=false,maxLength=5000,compact=false,cancelRef}:Props){
 const supported=useSyncExternalStore(subscribeToCapability,supportsRecognition,noServerRecognition);
 const [listening,setListening]=useState(false),[receiving,setReceiving]=useState(false),[error,setError]=useState('');const recognition=useRef<Recognition|null>(null),callback=useRef(onChange),quietTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useLayoutEffect(()=>{callback.current=onChange;},[onChange]);
 const detach=useCallback((r:Recognition)=>{r.onresult=null;r.onend=null;r.onerror=null;r.onspeechstart=null;r.onspeechend=null;if(quietTimer.current)clearTimeout(quietTimer.current);},[]);
 const abort=useCallback(()=>{const r=recognition.current;recognition.current=null;if(r){detach(r);r.abort();}setListening(false);setReceiving(false);},[detach]);
 useLayoutEffect(()=>{if(cancelRef)cancelRef.current=abort;return()=>{if(cancelRef)cancelRef.current=null;const r=recognition.current;recognition.current=null;if(r){detach(r);r.abort();}};},[cancelRef,abort,detach]);
 useEffect(()=>{onListening(listening);return()=>onListening(false);},[listening,onListening]);
 function start(){setError('');const w=window as SpeechWindow,Ctor=w.SpeechRecognition||w.webkitSpeechRecognition;if(!Ctor)return;const r=new Ctor(),prefix=value?value+(/\s$/.test(value)?'':'\n'):'';recognition.current=r;r.lang=navigator.language||'en-US';r.continuous=true;r.interimResults=true;
  const finish=()=>{detach(r);if(recognition.current===r){recognition.current=null;setListening(false);setReceiving(false);}};
  const heard=()=>{if(recognition.current!==r)return;if(quietTimer.current)clearTimeout(quietTimer.current);setReceiving(true);};
  r.onspeechstart=heard;r.onspeechend=()=>{if(recognition.current===r)setReceiving(false);};
  // Results include the whole session. Replace the provisional phrase as the
  // browser refines it; appending each event would duplicate spoken words.
  r.onresult=event=>{if(recognition.current!==r)return;const transcript=Array.from(event.results).map(x=>x[0].transcript).join(' ');if(!transcript)return;heard();quietTimer.current=setTimeout(()=>{if(recognition.current===r)setReceiving(false);},1200);const text=prefix+transcript;if(text.length>maxLength){setError('The text limit was reached. Shorten the text before continuing dictation.');finish();r.abort();return;}callback.current(text);};
  r.onerror=e=>{setError(e.error==='not-allowed'?'Microphone access was not allowed. You can type or use keyboard dictation.':'Dictation stopped. Your text is still here.');finish();r.abort();};r.onend=finish;
  try{r.start();setListening(true);}catch{finish();setError('Dictation could not start. You can type or use keyboard dictation.');}
 }
 return <div className={`dictation-controls${compact?' compact-dictation':''}${receiving?' receiving-voice':''}`} data-listening={listening} data-receiving={receiving}>{listening&&!compact&&<span className="voice-activity" aria-hidden="true"><i/><i/><i/></span>}<Button type="button" variant="ghost" disabled={!supported||disabled&&!listening} title={supported?(listening?'Stop dictation':'Dictate using your browser’s speech service'):'Use your keyboard’s microphone to dictate in this browser.'} aria-label={listening?'Stop dictation':'Dictate'} aria-pressed={listening} onClick={()=>listening?recognition.current?.stop():start()}>{compact?<Mic aria-hidden="true"/>:listening?<Square/>:<Mic/>}{!compact&&(listening?'Stop dictation':'Dictate')}</Button>{(!compact||!supported||listening)&&<small className={compact?'sr-only':'dictation-message'} role={listening?'status':undefined}>{supported?(listening?receiving?'Hearing you…':'Listening…':'Uses your browser’s speech service.'):'Use your keyboard’s microphone to dictate in this browser.'}</small>}{error&&<small className="dictation-message dictation-error" role="status">{error}</small>}</div>;
}
