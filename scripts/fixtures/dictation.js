// Only served by the disposable loopback fixture with --dictation. No microphone/provider.
const recognition={active:null};
let lateResult;
class SyntheticRecognition {
 start(){recognition.active=this;this.results=[];lateResult=this.onresult;}
 stop(){this.onend?.();}
 abort(){if(recognition.active===this)recognition.active=null;}
}
Object.defineProperty(window,'SpeechRecognition',{value:SyntheticRecognition,configurable:true});
Object.defineProperty(window,'webkitSpeechRecognition',{value:SyntheticRecognition,configurable:true});
document.addEventListener('DOMContentLoaded',()=>{
 const panel=document.createElement('details');panel.style.cssText='position:fixed;right:10px;bottom:80px;z-index:100;background:#fff;color:#111;padding:6px;max-width:300px;border:1px solid #111';
 const summary=document.createElement('summary');summary.textContent='Synthetic speech controls';panel.append(summary);
 const text=document.createElement('textarea');text.setAttribute('aria-label','Synthetic transcript');text.value='I went for a walk today.';panel.append(text);
 const button=(title,run)=>{const b=document.createElement('button');b.textContent=title;b.style.cssText='display:block;padding:6px;color:#111;background:#eee';b.onclick=run;panel.append(b);};
 button('Emit final speech',()=>{const active=recognition.active;if(active){active.results.push({isFinal:true,0:{transcript:text.value}});active.onresult?.({results:active.results});}});
 button('Emit interim speech',()=>{const active=recognition.active;active?.onresult?.({results:[...active.results,{isFinal:false,0:{transcript:text.value}}]});});
 button('Speech detected',()=>recognition.active?.onspeechstart?.());
 button('Speech paused',()=>recognition.active?.onspeechend?.());
 button('Emit late speech',()=>lateResult?.({results:[{isFinal:true,0:{transcript:'This cancelled speech must never be saved.'}}]}));
 button('Deny microphone',()=>recognition.active?.onerror?.({error:'not-allowed'}));
 button('Unsupported browser on reload',()=>{sessionStorage.setItem('synthetic-speech-unsupported','true');location.reload();});
 document.body.append(panel);
 // Keep synthetic controls accessible inside the journal's modal focus scope.
 new MutationObserver(()=>{const target=document.querySelector('[role=dialog][data-state=open]')||document.body;if(panel.parentElement!==target){target.append(panel);panel.removeAttribute('aria-hidden');panel.removeAttribute('data-aria-hidden');}}).observe(document.body,{childList:true,subtree:true});
});
if(sessionStorage.getItem('synthetic-speech-unsupported')){
 Object.defineProperty(window,'SpeechRecognition',{value:undefined});Object.defineProperty(window,'webkitSpeechRecognition',{value:undefined});
}
