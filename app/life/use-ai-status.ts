"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {createAIStatusPoll} from '@/lib/life/ai-status-poll';

export function useAIStatus<T>({load,onData,shouldPoll,active=false,scope='',enabled=true}:{load:()=>Promise<T>;onData:(data:T)=>void;shouldPoll:(data:T)=>boolean;active?:boolean;scope?:string;enabled?:boolean}){
 const latest=useRef({load,onData,shouldPoll,active});latest.current={load,onData,shouldPoll,active};
 const controller=useRef<ReturnType<typeof createAIStatusPoll<T>>|null>(null),[state,setState]=useState({checking:false,error:'',delayed:false});
 useEffect(()=>{
  if(!enabled){setState({checking:false,error:'',delayed:false});return;}
  const poll=createAIStatusPoll<T>({load:()=>latest.current.load(),onData:data=>latest.current.onData(data),active:()=>latest.current.active,onState:setState});controller.current=poll;
  poll.start(data=>latest.current.shouldPoll(data));
  const focus=()=>{if(document.visibilityState!=='hidden')void poll.check();};
  window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
  return()=>{poll.stop();if(controller.current===poll)controller.current=null;window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
 },[scope,enabled]);
 useEffect(()=>{if(active)void controller.current?.check();},[active]);
 const check=useCallback(async()=>{await controller.current?.check();},[]);
 const stop=useCallback(()=>{controller.current?.stop();controller.current=null;setState({checking:false,error:'',delayed:false});},[]);
 return {...state,check,stop};
}
