"use client";
import {useAppearance} from "./life/use-appearance";
import {assertFiniteNumbers} from "@/lib/life/numeric-draft";
import {profileSaveAcknowledged,reviewProfileChanges} from "@/lib/life/profile-recovery";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Plus, ArrowRight, ArrowLeft, Archive, LoaderCircle, SquarePen, SlidersHorizontal, ShieldCheck, Menu, Search, RefreshCw, Wallet, Dumbbell, House, Download, LogOut, Trash2 } from "lucide-react";
import { useDraftSync } from "./life/use-draft-sync";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import Trash from "./life/trash";
import Home from "./life/home";
import Settings from "./life/settings";
import type {PeriodCadence} from "@/lib/life/analysis-periods";
import AIReview from "./life/ai-review";
import History from "./life/history";
import CheckIn from "./life/check-in";
import AccountSettings from "./life/account-settings";
import { defaultReviewPreferences, completionIssues, previousDay } from "@/lib/life/reviews";
import BudgetPanel from "./life/budget";
import Workouts from "./life/workouts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { modules, coreModules, standardHabits, todayIn, emptyEntry, dateSchema, profileSchema, type Entry, type Profile } from "@/lib/life/domain";

const freshProfile=():Profile=>({goal:"",budgetGoals:null,analysisGuidance:[],reviewPreferences:defaultReviewPreferences(),moduleGoals:{},spiritualTradition:"",timezoneMode:"automatic",timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC",modules:[...coreModules],habits:[],version:0});
async function api(body?:unknown){assertFiniteNumbers(body);const r=await fetch("/api/life",{method:body?"POST":"GET",headers:body?{"Content-Type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined,cache:"no-store"});const data=await r.json();if(!r.ok)throw Object.assign(new Error(data.error||"Unable to connect. Please try again."),{status:r.status});return data;}

export default function LifeApp({signOutHref="/signout-with-chatgpt?return_to=%2F"}:{signOutHref?:string}){
 const [profile,setProfile]=useState<Profile|null>(null),[config,setConfig]=useState<Profile|null>(null),[entries,setEntries]=useState<Entry[]>([]);
 const responseTrigger=useRef<HTMLElement|null>(null),responseScroll=useRef(0),workspace=useRef<HTMLElement|null>(null),previousTab=useRef("home"),cancelVoice=useRef<(()=>void)|null>(null);
 const [deleted,setDeleted]=useState(false),[journalListening,setJournalListening]=useState(false);
 const [initialConfig,setInitialConfig]=useState<Profile|null>(null);
 const profileWrite=useRef<{snapshot:Profile;base:Profile}|null>(null);
 const [profileUnconfirmed,setProfileUnconfirmed]=useState(false),[profileConflict,setProfileConflict]=useState<{saved:Profile;snapshot:Profile;base:Profile}|null>(null);
 const [loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[tab,setTab]=useState("home"),[step,setStep]=useState(1),[habitName,setHabitName]=useState(""),[habitModule,setHabitModule]=useState<Profile["modules"][number]>("reflection");
 const [resourceRevision,setResourceRevision]=useState(0);
 const [searchOpen,setSearchOpen]=useState(false),[historyRevision,setHistoryRevision]=useState(0),[accountOpen,setAccountOpen]=useState(false);
 const entriesEpoch=useRef(0);
 const sync=useDraftSync(entry=>{entriesEpoch.current++;setEntries(prev=>[entry,...prev.filter(e=>e.date!==entry.date)].sort((a,b)=>b.date.localeCompare(a.date)));setHistoryRevision(n=>n+1);},false);
 const {draft,dirty}=sync;
 const [navigation,setNavigation]=useState<{run:()=>void|Promise<void>}|null>(null);
 const [period,setPeriod]=useState<{cadence:PeriodCadence;date:string}|null>(null);
 const [aiBusy,setAiBusy]=useState(false);
 const [budgetDirty,setBudgetDirty]=useState(false),[gymDirty,setGymDirty]=useState(false);
 useAppearance(profile?.appearance,tab==='settings'?config?.appearance:undefined,loaded);
 const setupDirty=!!config&&!!(profile||initialConfig)&&JSON.stringify(config)!==JSON.stringify(profile||initialConfig);
 const anyDirty=dirty||setupDirty||budgetDirty||gymDirty||aiBusy||journalListening||profileUnconfirmed;
 const loadEpoch=useRef(0),openEntry=sync.open;
 const load=useCallback(async(signal?:AbortSignal)=>{
  const epoch=++loadEpoch.current;
  try{
   const data=await api();if(epoch!==loadEpoch.current||signal?.aborted)return;
   let p=data.profile as Profile|null;
   const detected=Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC";
   if(p&&p.timezoneMode==="automatic"&&p.timezone!==detected){p=(await api({action:"profile",profile:{...p,timezone:detected}})).profile;if(epoch!==loadEpoch.current||signal?.aborted)return;}
   const params=new URLSearchParams(window.location.search),requested=dateSchema.safeParse(params.get('date'));
   const date=p?(requested.success?requested.data:todayIn(p.timezone)):null;
   let entry:Entry|null=null;
   if(p&&date){
    entry=data.entries.find((e:Entry)=>e.date===date)||null;
    if(!entry){const response=await fetch('/api/life?date='+encodeURIComponent(date),{cache:'no-store'});const result=await response.json();if(epoch!==loadEpoch.current||signal?.aborted)return;if(!response.ok)throw Error(result.error||'Unable to open the saved day.');entry=result.entry;}
   }
   const initial=p||freshProfile();setProfile(p);setConfig(initial);setInitialConfig(initial);setEntries(data.entries);
   if(p&&date){openEntry(entry||emptyEntry(p,date));if(requested.success){const cadence=params.get('analysis');if(cadence&&['weekly','monthly','annual'].includes(cadence)){setPeriod({cadence:cadence as PeriodCadence,date});setTab('analysis');}else setTab('today');}}
   setError('');setLoaded(true);
  }catch(e){if(epoch===loadEpoch.current&&!signal?.aborted)setError((e as Error).message);}
 },[openEntry]);
 useEffect(()=>{const controller=new AbortController();void load(controller.signal);document.body.classList.add('life-compact-theme');return()=>{controller.abort();document.body.classList.remove('life-compact-theme');};},[load]);
 useEffect(()=>{const returning=previousTab.current==='today'&&tab==='history';workspace.current?.scrollTo({top:returning?responseScroll.current:0});if(returning)responseTrigger.current?.focus({preventScroll:true});if(tab==='today')document.querySelector<HTMLElement>('.compact-topbar h1')?.focus({preventScroll:true});previousTab.current=tab;},[tab]);
 const hasProfile=profile!==null;
 useEffect(()=>{
  if(!hasProfile)return;
  const viewport=window.visualViewport,style=document.documentElement.style;let frame=0;
  // The whole signed-in shell follows the visible viewport. The navigation is
  // a normal shell row, avoiding Firefox Android's independent fixed-footer shift.
  const fit=()=>{frame=0;if(viewport&&Math.abs(viewport.scale-1)>.01)return;style.setProperty('--app-viewport-height',(viewport?.height||window.innerHeight)+'px');style.setProperty('--app-viewport-top',(viewport?.offsetTop||0)+'px');};
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(fit);};
  fit();viewport?.addEventListener('resize',schedule);viewport?.addEventListener('scroll',schedule);window.addEventListener('resize',schedule);
  return()=>{cancelAnimationFrame(frame);viewport?.removeEventListener('resize',schedule);viewport?.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);style.removeProperty('--app-viewport-height');style.removeProperty('--app-viewport-top');};
 },[hasProfile]);
 useEffect(()=>{if(!anyDirty||deleted)return;const fn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue="";};window.addEventListener("beforeunload",fn);return()=>window.removeEventListener("beforeunload",fn);},[anyDirty,deleted]);
 function edit(next:Entry){sync.edit(next);setNotice("");}
 async function chooseDate(date:string,destination="today"){if(!profile||!date)return;entriesEpoch.current++;if(tab!=='today'&&destination==='today'){responseTrigger.current=document.activeElement as HTMLElement;responseScroll.current=tab==='history'?(workspace.current?.scrollTop||0):0;}setBusy(true);setError("");try{const r=await fetch('/api/life?date='+encodeURIComponent(date),{cache:'no-store'});const data=await r.json();if(!r.ok)throw new Error(data.error||'Unable to open this response.');const entry=data.entry as Entry|null;sync.open(entry||emptyEntry(profile,date));entriesEpoch.current++;setEntries(prev=>entry?[entry,...prev.filter(e=>e.date!==date)].sort((a,b)=>b.date.localeCompare(a.date)):prev.filter(e=>e.date!==date));setNotice("");setTab(destination);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 function acceptProfile(saved:Profile){profileWrite.current=null;setProfileUnconfirmed(false);setProfileConflict(null);setProfile(saved);setConfig(saved);setInitialConfig(saved);if(!dirty&&(!draft||draft.version===0))sync.open(emptyEntry(saved,draft?.date||todayIn(saved.timezone)));setNotice('');setError('');setTab(profile?'settings':'home');}
 async function saveProfile(){
  if(!config||profileConflict)return false;
  setBusy(true);setError('');
  try{
   const hadPending=!!profileWrite.current,parsed=profileSchema.safeParse(config);if(!parsed.success)throw new Error(parsed.error.issues[0]?.message||'Check your settings.');
   const write=profileWrite.current||{snapshot:structuredClone(parsed.data),base:structuredClone(profile||initialConfig||config)};
   profileWrite.current=write;setProfileUnconfirmed(true);
   try{const data=await api({action:'profile',profile:write.snapshot});acceptProfile(data.profile);return true;}
   catch(error){
    const code=(error as {status?:number}).status;
    if(code&&code>=400&&code<500&&code!==409&&!hadPending){profileWrite.current=null;setProfileUnconfirmed(false);throw error;}
    // A read can acknowledge the exact normalized values, but never replays a
    // write or adopts another session's settings over this local draft.
    try{
     const latest=(await api()).profile as Profile|null;
     if(latest&&profileSaveAcknowledged(write.snapshot,latest)){acceptProfile(latest);return true;}
     if(latest&&latest.version>write.snapshot.version){profileWrite.current=null;setProfileUnconfirmed(false);setProfileConflict({...write,saved:latest});setError('Settings changed in another session. Your changes are still here.');return false;}
    }catch{}
    if(code===409){profileWrite.current=null;setProfileUnconfirmed(false);}
    throw error;
   }
  }catch(error){setError((error as Error).message);return false;}finally{setBusy(false);}
 }
 async function commitEntry(){if(draft)await sync.commit(completionIssues(draft).length===0);}
 async function saveEntry(){setBusy(true);setError("");try{await commitEntry();setTab("history");setNotice("Response saved.");}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 function navigate(run:()=>void|Promise<void>){if(profileWrite.current){setError('Retry Save to confirm your settings before leaving.');return;}if(sync.status==='saving'||sync.status==='error'){setError('Retry Save to confirm this response before leaving.');return;}if(aiBusy){setError("Wait for the AI request to finish before leaving this section.");return;}if(anyDirty){setNavigation({run});return;}void run();}
 async function saveAndContinue(){if(!navigation)return;setBusy(true);setError("");try{cancelVoice.current?.();setJournalListening(false);if(dirty)await commitEntry();if(setupDirty&&!(await saveProfile()))return;if(budgetDirty||gymDirty){setError("Save or cancel changes in the open Budget or Workouts form first.");setNavigation(null);return;}const run=navigation.run;setNavigation(null);await run();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 function discardAndContinue(){if(!navigation||sync.status==='saving'||sync.status==='error'||profileWrite.current||budgetDirty||gymDirty)return;cancelVoice.current?.();setJournalListening(false);sync.discard();const saved=profileConflict?.saved||profile||initialConfig;setConfig(saved);if(profileConflict){setProfile(profileConflict.saved);setInitialConfig(profileConflict.saved);setProfileConflict(null);}if(profile){if(draft)sync.open(entries.find(e=>e.date===draft.date)||emptyEntry(profile,draft.date));}const run=navigation.run;setNavigation(null);void run();}
 function resolveProfileConflict(keepChanges:boolean){if(!profileConflict)return;try{const saved=profileConflict.saved,next=keepChanges?reviewProfileChanges(profileConflict.base,profileConflict.snapshot,saved).draft:saved;setProfile(saved);setInitialConfig(saved);setConfig(next);setProfileConflict(null);setError('');setTab('settings');}catch(error){setError((error as Error).message);}}
 const settingsConflict=profileConflict&&<div className="settings-conflict" role="alert"><p>Settings changed in another session. Your changes have not been discarded. Use saved settings to replace this draft, or keep your edited sections and review them before saving.</p><p>Saving your reviewed draft replaces any edited sections that also changed in the other session.</p><div className="action-row"><Button variant="outline" onClick={()=>resolveProfileConflict(false)}>Use saved settings</Button><Button onClick={()=>resolveProfileConflict(true)}>Review my changes</Button></div></div>;

 if(deleted)return <main className="onboarding"><h1>Your LifeApp account is deleted.</h1><p>Your saved personal records and sign-in sessions have been removed. Signing in again creates a new account.</p><a href="/sign-in">Return to sign-in</a></main>;
 const configFields=config&&<>
  <div className="field"><label htmlFor="goal">What would you like to make more room for?</label><input id="goal" maxLength={300} placeholder="e.g. Better routines and steady progress on my work" value={config.goal} onChange={e=>setConfig({...config,goal:e.target.value})}/></div>
  <p className="muted">Journal, Movement and Money are included. Write about any of them in your journal.</p><h3>Optional areas</h3><div className="module-grid">{modules.filter(m=>!coreModules.some(id=>id===m.id)).map(m=><label className={`module-choice ${config.modules.includes(m.id)?"chosen":""}`} key={m.id}><span className="module-glyph">{m.glyph}</span><span><strong>{m.name}</strong><small>{m.hint}</small></span><Checkbox aria-label={m.name} checked={config.modules.includes(m.id)} onCheckedChange={checked=>{const next=checked?[...config.modules,m.id]:config.modules.filter(id=>id!==m.id);setConfig({...config,modules:next});if(!next.includes(habitModule)&&next.length)setHabitModule(next[0]);}}/></label>)}</div>
 <div className="section-goals"><h3>Give each section a purpose</h3><p className="muted">What would progress look like? Your goals will guide future analyses across your journal, habits and section logs.</p>{modules.filter(m=>config.modules.includes(m.id)).map(m=><label className="compact-field" key={m.id}>{m.name} goal<textarea maxLength={1000} rows={2} placeholder={`What would you like to work toward in ${m.name.toLowerCase()}?`} value={config.moduleGoals[m.id]||""} onChange={e=>setConfig({...config,moduleGoals:{...config.moduleGoals,[m.id]:e.target.value}})}/></label>)}{config.modules.includes("spiritual")&&<label className="compact-field">Tradition or approach (optional)<input maxLength={200} placeholder="Describe the tradition or approach you want respected" value={config.spiritualTradition} onChange={e=>setConfig({...config,spiritualTradition:e.target.value})}/></label>}</div>
 </>;
 function addHabit(title:string,module:Profile["modules"][number]){if(!config||!title.trim())return;setConfig({...config,habits:[...config.habits,{id:crypto.randomUUID(),title:title.trim(),module,archived:false}]});setHabitName("");}
 const habitFields=config&&<>
  <p className="muted">Choose a few habits you want to keep. Suggestions only count after you add them.</p>
  <div className="habit-picker"><Select value="" onValueChange={v=>{const [module,index]=v.split(":");const id=module as Profile["modules"][number];addHabit(standardHabits[id][Number(index)],id);}}><SelectTrigger aria-label="Add a standard habit" disabled={config.habits.length>=50}><SelectValue placeholder="Add a standard habit…"/></SelectTrigger><SelectContent>{modules.filter(m=>config.modules.includes(m.id)).flatMap(m=>standardHabits[m.id].map((title,i)=><SelectItem key={m.id+":"+i} value={m.id+":"+i} disabled={config.habits.some(h=>!h.archived&&h.title.toLowerCase()===title.toLowerCase())}>{m.name} · {title}</SelectItem>))}</SelectContent></Select><small>36 starting points across six sections. Edit any habit after adding it.</small></div>
  <div className="custom-habit"><input aria-label="Custom habit" maxLength={100} placeholder="Or write your own habit…" value={habitName} onChange={e=>setHabitName(e.target.value)}/><Select value={habitModule} onValueChange={v=>setHabitModule(v as typeof habitModule)}><SelectTrigger aria-label="Habit module"><SelectValue/></SelectTrigger><SelectContent>{modules.filter(m=>config.modules.includes(m.id)).map(m=><SelectItem value={m.id} key={m.id}>{m.name}</SelectItem>)}</SelectContent></Select><Button variant="secondary" disabled={!habitName.trim()||!config.modules.includes(habitModule)||config.habits.length>=50} onClick={()=>addHabit(habitName,habitModule)}>Add</Button></div>
  <div className="chosen-habits">{config.habits.filter(h=>!h.archived).map(h=><div key={h.id}><span><input aria-label={`Habit name: ${h.title}`} maxLength={100} value={h.title} onChange={e=>setConfig({...config,habits:config.habits.map(x=>x.id===h.id?{...x,title:e.target.value}:x)})}/><small>{modules.find(m=>m.id===h.module)?.name}{!config.modules.includes(h.module)?" · module paused":""}</small></span><Button variant="ghost" aria-label={`Archive ${h.title}`} onClick={()=>setConfig({...config,habits:config.habits.map(x=>x.id===h.id?{...x,archived:true}:x)})}><Archive/></Button></div>)}</div>

 </>;
 function profileSaved(p:Profile){setProfile(p);setConfig(p);setInitialConfig(p);}
 function openPeriod(cadence:PeriodCadence,date:string){navigate(()=>{setPeriod({cadence,date});setTab("analysis");});}
 const go=(next:string)=>{if(next===tab)return;navigate(()=>{setError("");setNotice("");setTab(next);});};
 function cancelResponse(){if(busy||aiBusy||sync.status==='saving'||sync.status==='error')return;cancelVoice.current?.();sync.discard();if(profile&&draft)sync.open(entries.find(entry=>entry.date===draft.date)||emptyEntry(profile,draft.date));setTab('history');setJournalListening(false);setError('');}
 function responseDeleted(date:string){entriesEpoch.current++;setEntries(previous=>previous.filter(entry=>entry.date!==date));if(draft?.date===date){sync.discard();sync.open({...draft,deleted:true,complete:false});}setNotice('Response moved to Trash.');}
 async function trashChanged(){const epoch=++entriesEpoch.current;setResourceRevision(n=>n+1);setHistoryRevision(n=>n+1);try{const data=await api();if(epoch===entriesEpoch.current)setEntries(data.entries);}catch(error){if(epoch===entriesEpoch.current)setError((error as Error).message);}}
 const today=profile?todayIn(profile.timezone):'',yesterday=today?previousDay(today):'',prior=entries.find(entry=>entry.date===yesterday);
 const responseLocked=busy||aiBusy||sync.status==='saving'||sync.status==='error';
 const title=!profile?'LifeApp':tab==='today'?(draft?.version?'Edit response':'New response'):tab==='history'?'Responses':tab==='trash'?'Trash':tab==='settings'?'Settings':tab==='home'?'Home':tab==='analysis'?'Analysis':tab==='budget'?'Budget':'Workouts';
 return <div className={`app-shell compact-app${profile?' signed-in-app':''}`}><header className="compact-topbar">
 {tab==='today'&&profile?<Button variant="ghost" size="icon" aria-label="Back to responses" disabled={responseLocked} onClick={cancelResponse}><ArrowLeft/></Button>:tab==='analysis'&&profile?<Button variant="ghost" size="icon" aria-label="Back" disabled={busy} onClick={()=>go('home')}><ArrowLeft/></Button>:<DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Open menu" disabled={busy}><Menu/></Button></DropdownMenuTrigger><DropdownMenuContent align="start" className="life-menu"><DropdownMenuLabel>LifeApp</DropdownMenuLabel><DropdownMenuSeparator/>{profile&&<DropdownMenuItem onSelect={()=>go('settings')}><SlidersHorizontal/>Settings</DropdownMenuItem>}{profile&&<DropdownMenuItem onSelect={()=>go('trash')}><Trash2/>Trash</DropdownMenuItem>}{profile&&<DropdownMenuItem asChild><a href="/api/life?export=1" download><Download/>Download backup</a></DropdownMenuItem>}<DropdownMenuSeparator/><DropdownMenuItem asChild><a href={signOutHref} target="_top" onClick={e=>{if(anyDirty){e.preventDefault();navigate(()=>window.location.assign(signOutHref));}}}><LogOut/>Sign out</a></DropdownMenuItem></DropdownMenuContent></DropdownMenu>}
 <h1 tabIndex={-1}>{title}</h1>{profile&&tab==='history'&&<div className="toolbar-actions"><Button variant="ghost" size="icon" aria-label="Search responses" aria-pressed={searchOpen} onClick={()=>setSearchOpen(v=>!v)}><Search/></Button><Button variant="ghost" size="icon" aria-label="Refresh responses" disabled={busy} onClick={()=>setHistoryRevision(n=>n+1)}><RefreshCw/></Button></div>}
 </header>{loaded&&signOutHref==='/sign-out'&&<AccountSettings open={accountOpen} onOpenChange={setAccountOpen} disabled={busy||anyDirty} onBusy={setBusy} onDeleted={()=>{sync.discard();setDeleted(true);}}/>}
 <fieldset disabled={busy} className="contents">{!loaded?<main className="loading-state">{error?<><h1>We couldn’t open your journal.</h1><p role="alert">{error}</p><Button onClick={()=>void load()}>Try again</Button></>:<><LoaderCircle className="spin"/><p>Opening your space…</p></>}</main>:!profile?<main className="onboarding"><div className="eyebrow">YOUR LIFE, YOUR CHOICES <span>{step} / 2</span></div><h1>{step===1?"What matters to you?":"Start small. Make it yours."}</h1><p className="intro">{step===1?"Choose the areas you’d like to check in on. You can change these anytime.":"Pick the habits you want to track, or begin with a simple journal."}</p>{error&&<p className="error" role="alert">{error}</p>}{settingsConflict}<fieldset className="contents" disabled={profileUnconfirmed||!!profileConflict}>{step===1?configFields:habitFields}</fieldset><div className="onboarding-footer">{step===2&&<Button variant="ghost" disabled={profileUnconfirmed} onClick={()=>setStep(1)}>Back</Button>}<span>About 2 minutes to set up</span><Button disabled={busy||!!profileConflict||!config?.modules.length} onClick={()=>step===1?setStep(2):saveProfile()}>{busy?<LoaderCircle className="spin"/>:null}{step===1?"Choose my habits":"Open my journal"}<ArrowRight/></Button></div><p className="privacy-note"><ShieldCheck/> Your journal is private. You choose when to request AI analysis.</p></main>:<><main ref={workspace} className="workspace">
 <Tabs value={tab} data-page={tab}>
 {error&&tab!=='today'&&<p className="error" role="alert">{error}</p>}{notice&&<p className="notice" role="status"><Check/>{notice}</p>}
 <TabsContent value="home" aria-label="Home"><Home profile={profile} entries={entries} onDate={date=>navigate(()=>chooseDate(date))} onPeriod={openPeriod} onSection={go} onBusy={setAiBusy} onProfileSaved={profileSaved}/></TabsContent>
 <TabsContent value="analysis" aria-label="Period analysis">{period&&<AIReview key={period.cadence+period.date} cadence={period.cadence} date={period.date} heading={period.cadence[0].toUpperCase()+period.cadence.slice(1)+' analysis'} profile={profile} synced={!setupDirty} onBusy={setAiBusy} onProfileSaved={profileSaved} onSettings={()=>go('settings')}/>}</TabsContent>
 <TabsContent aria-label="Responses" value="history" forceMount className="data-[state=inactive]:hidden"><div className="responses-hub">
 {tab==='history'&&<AIReview key={'yesterday:'+yesterday} heading="Yesterday’s analysis" date={yesterday} entry={prior} profile={profile} synced={!setupDirty} onBusy={setAiBusy} onProfileSaved={profileSaved} onSettings={()=>go('settings')}/>}
 <div className="response-history"><div className="response-history-heading"><h2>Saved responses</h2></div><History disabled={busy||aiBusy||sync.status==='error'} searchOpen={searchOpen} refreshKey={historyRevision} onOpen={date=>navigate(()=>chooseDate(date))} onBusy={setBusy} onDeleted={responseDeleted}/></div></div>{tab==='history'&&<Button className="add-response" size="icon" aria-label="Write a response" title="Write a response" disabled={busy||aiBusy||sync.status==='error'} onClick={()=>navigate(()=>chooseDate(today))}><Plus aria-hidden="true"/></Button>}</TabsContent>
 {profile.modules.includes("money")&&<TabsContent aria-label="Budget" value="budget" forceMount className="data-[state=inactive]:hidden"><BudgetPanel key={resourceRevision} profile={profile} onDirty={setBudgetDirty} onProfileSaved={profileSaved}/></TabsContent>}
 {profile.modules.includes("fitness")&&<TabsContent aria-label="Workouts" value="workouts" forceMount className="data-[state=inactive]:hidden"><Workouts active={tab==='workouts'} refreshKey={resourceRevision} profile={profile} onDirty={setGymDirty}/></TabsContent>}
 <TabsContent value="today" aria-label="Response editor">{draft&&<fieldset className="response-page" disabled={busy||aiBusy}>{error&&error!==sync.syncError&&<p className="error" role="alert">{error}</p>}{draft.deleted?<div className="notice">This response is in Trash.</div>:<CheckIn key={draft.date} cancelVoice={cancelVoice} profile={profile} entry={draft} busy={busy||aiBusy} sync={sync} onEdit={edit} onListening={setJournalListening} onDate={date=>navigate(()=>chooseDate(date))} onSave={saveEntry} onCancel={cancelResponse} onConflictResolved={()=>setError('')} analysis={draft.version>0?<AIReview key={draft.date} entry={draft} profile={profile} synced={!dirty&&!journalListening} onBusy={setAiBusy} onProfileSaved={profileSaved} onSettings={()=>navigate(()=>{setTab('settings');})}/>:undefined}/>}</fieldset>}</TabsContent>
 <TabsContent value="trash" aria-label="Trash"><Trash onChanged={()=>void trashChanged()}/></TabsContent><TabsContent value="settings" aria-label="Settings">{config&&<Settings config={config} onChange={setConfig} focusFields={configFields} habitFields={habitFields} dirty={setupDirty} busy={busy} locked={profileUnconfirmed||!!profileConflict} savePending={profileUnconfirmed} conflict={settingsConflict} onSave={saveProfile} onCancel={()=>{if(profileConflict)resolveProfileConflict(false);else {setConfig(profile);setError('');}}} onDelete={signOutHref==='/sign-out'?()=>navigate(()=>setAccountOpen(true)):undefined}/>}</TabsContent></Tabs>
 </main>{tab!=='today'&&<nav className="bottom-nav" aria-label="Main navigation"><button aria-current={tab==='home'?'page':undefined} onClick={()=>go('home')}><House/><span>Home</span></button><button aria-current={tab==='history'?'page':undefined} onClick={()=>go('history')}><SquarePen/><span>Responses</span></button>{profile.modules.includes('money')&&<button aria-current={tab==='budget'?'page':undefined} onClick={()=>go('budget')}><Wallet/><span>Budget</span></button>}{profile.modules.includes('fitness')&&<button aria-current={tab==='workouts'?'page':undefined} onClick={()=>go('workouts')}><Dumbbell/><span>Workouts</span></button>}</nav>}</>}
 </fieldset><AlertDialog open={!!navigation} onOpenChange={open=>{if(!open)setNavigation(null);}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Save changes?</AlertDialogTitle><AlertDialogDescription>{budgetDirty||gymDirty?"The open section has unsaved changes. Stay here to save or cancel its form.":"Changes stay in this form until you save. Save them before continuing, or discard your unsaved edits."}</AlertDialogDescription></AlertDialogHeader>{sync.syncError&&<p className="error" role="alert">{sync.syncError}</p>}<AlertDialogFooter><AlertDialogCancel>Stay here</AlertDialogCancel>{!budgetDirty&&!gymDirty&&<><Button variant="outline" disabled={sync.status==="saving"||sync.status==="error"||busy||profileUnconfirmed} onClick={discardAndContinue}>Discard unsaved changes</Button><Button disabled={busy} onClick={saveAndContinue}>Save & continue</Button></>}</AlertDialogFooter></AlertDialogContent></AlertDialog></div>;
}
