// Read-only reconciliation. A poll never replays an AI generation request.
export function createAIStatusPoll<T>({load,onData,onState,active=()=>false,schedule=(fn,ms)=>setTimeout(fn,ms),cancel=timer=>clearTimeout(timer)}:{load:()=>Promise<T>;onData:(data:T)=>void;onState:(state:{checking:boolean;error:string;delayed:boolean})=>void;active?:()=>boolean;schedule?:(fn:()=>void,ms:number)=>ReturnType<typeof setTimeout>;cancel?:(timer:ReturnType<typeof setTimeout>)=>void}){
 let closed=false,epoch=0,timer:ReturnType<typeof setTimeout>|undefined,inflight:Promise<void>|undefined,attempts=0,failures=0;
 let trailing:Promise<void>|undefined,finishTrailing:(()=>void)|undefined;
 let shouldPoll:(data:T)=>boolean=()=>false;
 const clear=()=>{if(timer!==undefined){cancel(timer);timer=undefined;}};
 function queue(){if(closed)return;if(attempts>=16){onState({checking:false,error:'',delayed:true});return;}const delays=[1000,2000,3000,5000,8000,10000];timer=schedule(()=>{timer=undefined;void run();},delays[Math.min(attempts-1,delays.length-1)]);}
 async function run(){
  if(closed)return;if(inflight)return inflight;clear();const current=epoch;
  const task=(async()=>{onState({checking:true,error:'',delayed:false});try{const data=await load();if(closed||current!==epoch)return;failures=0;attempts++;onData(data);onState({checking:false,error:'',delayed:false});if(active()||shouldPoll(data))queue();}
   catch(error){if(closed||current!==epoch)return;failures++;attempts++;onState({checking:false,error:error instanceof Error?error.message:'Could not check the saved result.',delayed:failures>=3||attempts>=16});if(failures<3)queue();}
  })();inflight=task;try{await task;}finally{if(inflight===task){inflight=undefined;
   if(trailing&&!closed){const finish=finishTrailing;trailing=undefined;finishTrailing=undefined;void run().then(finish,finish);}
  }}
 }
 return {
  start(poll:(data:T)=>boolean){shouldPoll=poll;void run();},
  check(){
   if(closed)return Promise.resolve();attempts=0;failures=0;clear();
   // The caller may have just completed a write. Ignore an older in-flight
   // snapshot and share one fresh trailing read across concurrent checks.
   if(inflight){epoch++;if(!trailing)trailing=new Promise<void>(resolve=>{finishTrailing=resolve;});return trailing;}
   return run();
  },
  stop(){closed=true;epoch++;clear();finishTrailing?.();trailing=undefined;finishTrailing=undefined;},
 };
}
