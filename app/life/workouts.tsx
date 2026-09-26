"use client";
import TrainingAnalysis from './training-analysis';
import CardioLog from "./cardio";
import WorkoutNotes from './workout-notes';
import RoutineBuilder from './routine-builder';
import {presetExercise,repTarget,trainingSources} from '@/lib/life/exercise-presets';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ChevronDown, Pencil, Sparkles } from 'lucide-react';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { todayIn, type Profile } from '@/lib/life/domain';
import { formatDate } from '@/lib/life/date-display';
import { nextSet, restRemaining, workoutTotals, routineSchema, workoutSchema, type Routine, type Workout, type Saved } from '@/lib/life/modules';
import { request, saveRecord, useUnsaved } from './shared';
import WorkoutPanel from './workout-panel';
import RoutineEditor from './routine-editor';
import RoutineConflict from './routine-conflict';
import {copyRoutineDraft} from '@/lib/life/routine-recovery';
import MuscleCoverage from './muscle-coverage';
import RoutinePreview from './routine-preview';
import WorkoutSession from './workout-session';
import WorkoutReview from './workout-review';
import ExerciseSetupNotes from './exercise-setup-notes';
import {useWorkoutTimer,WorkoutNotificationControl} from './workout-timer';
import {createWorkoutSession,extendWorkoutRest,skipCurrentSet,restoreSkippedSet,reviseWorkoutSet,removeWorkoutSet,sameRoutinePlan,definiteWorkoutRejection,workingLoad,matchingProgramExercise,weightReviewReason} from '@/lib/life/workout-session';
import type {ExercisePerformance,ExerciseHistory} from '@/lib/life/exercise-performance';
import {volumeSources} from '@/lib/life/muscle-groups';
import type {TrainingSummary} from '@/lib/life/training-summary';
import './workouts.css';
import './workout-flow.css';
const newExercise=presetExercise;
const newRoutine=():Saved<Routine>=>({id:crypto.randomUUID(),version:0,data:{name:'My workout',preferences:'',exercises:[newExercise()],archived:false}});
const subscribeCapabilities=()=>()=>{};
const vibrationAvailable=()=>typeof navigator.vibrate==='function';
const serverVibration=()=>false;
export default function Workouts({profile,onDirty,active:visible=true,refreshKey=0}:{refreshKey?:number;active?:boolean;profile:Profile;onDirty:(v:boolean)=>void}){
 const {setWorkoutTimer}=useWorkoutTimer();
 const [reviewingId,setReviewingId]=useState<string|null>(null),[reviewDirty,setReviewDirty]=useState(false),[setupNotesDirty,setSetupNotesDirty]=useState(false);
 const [previews,setPreviews]=useState<Record<string,Saved<Routine>>>({});
 const [sessionDraft,setSessionDraft]=useState<Saved<Routine>|null>(null),[sessionDraftError,setSessionDraftError]=useState(''),[sessionExerciseId,setSessionExerciseId]=useState<string|undefined>();
 const [startChoice,setStartChoice]=useState<Saved<Routine>|null>(null),[templateName,setTemplateName]=useState(''),[startError,setStartError]=useState(''),[startPending,setStartPending]=useState<{record:Saved<Routine>;sourceId:string}|null>(null);
 const [routineConflict,setRoutineConflict]=useState<Saved<Routine>|null>(),[startConflict,setStartConflict]=useState<Saved<Routine>|null>();
 const [saveWeight,setSaveWeight]=useState(true),[weightEdited,setWeightEdited]=useState(false),[weightPending,setWeightPending]=useState<{program:Saved<Routine>;workout:Saved<Workout>;exerciseId:string;unconfirmed:boolean}|null>(null),[weightConflict,setWeightConflict]=useState<Saved<Routine>|null>(),[weightError,setWeightError]=useState('');
 const [loadReview,setLoadReview]=useState<{routine:Saved<Routine>;changed:boolean;histories:Record<string,ExerciseHistory|null>|null;loads:Record<string,string>;error:string}|null>(null),loadReviewEpoch=useRef(0);
 const [sound,setSound]=useState(false),audioContext=useRef<AudioContext|null>(null);
 const pendingEffect=useRef<'preserve'|'advance'|'end'>('preserve');
 const writeLock=useRef(false),sessionView=useRef<HTMLDivElement>(null);
 const readLock=useRef(false),dataEpoch=useRef(0),summaryEpoch=useRef(0),readGuard=useRef(false),reloadLatest=useRef<()=>Promise<void>>(async()=>{});
 const [performance,setPerformance]=useState<{key:string;value:ExercisePerformance|null;history:ExerciseHistory|null;loading:boolean;unavailable:boolean}>({key:'',value:null,history:null,loading:false,unavailable:false});
 const [cardioHistory,setCardioHistory]=useState(false);
 const programMenuButton=useRef<HTMLButtonElement>(null),programBuildChoice=useRef<'manual'|'ai'|null>(null);
 const [cardioDirty,setCardioDirty]=useState(false),[notesDirty,setNotesDirty]=useState(false),[builderDirty,setBuilderDirty]=useState(false),[trainingBusy,setTrainingBusy]=useState(false);
 const [editorExerciseId,setEditorExerciseId]=useState<string|undefined>(),[panel,setPanel]=useState<string|null>(null),[selectedId,setSelectedId]=useState(''),[incomplete,setIncomplete]=useState(false),[summary,setSummary]=useState<TrainingSummary|null>(null),[summaryError,setSummaryError]=useState(''),[warmup,setWarmup]=useState(false),[routinePending,setRoutinePending]=useState<Saved<Routine>|null>(null),[routineError,setRoutineError]=useState('');
 async function refreshSummary(){const ticket=++summaryEpoch.current;try{const next=await request('?training-summary');if(ticket!==summaryEpoch.current)return;setSummary(next);setSummaryError('');}catch{if(ticket!==summaryEpoch.current)return;setSummary(null);setSummaryError('Weekly totals could not be loaded.');}}
 function openEditor(r:Saved<Routine>,exercise?:string){if(routine){setPanel('editor');setRoutineError('Finish or cancel the current program draft first.');return;}const draft=structuredClone(r);if(exercise&&draft.data.exercises.length<30)draft.data.exercises.push(newExercise(exercise));setEditorExerciseId(exercise?draft.data.exercises.at(-1)?.id:undefined);setRoutine(draft);setRoutineDirty(!!exercise||draft.version===0);setRoutineError('');setRoutineConflict(undefined);setPanel('editor');}

 const [routines,setRoutines]=useState<Saved<Routine>[]>([]),[sessions,setSessions]=useState<Saved<Workout>[]>([]),[routine,setRoutine]=useState<Saved<Routine>|null>(null),[routineDirty,setRoutineDirty]=useState(false),[setDirty,setSetDirty]=useState(false),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reps,setReps]=useState(''),[load,setLoad]=useState(''),[clock,setClock]=useState(Date.now),[vibration,setVibration]=useState(false),[pending,setPending]=useState<Saved<Workout>|null>(null),[editingSet,setEditingSet]=useState<{exerciseId:string;setNumber:number}|null>(null);
 const supportsVibration=useSyncExternalStore(subscribeCapabilities,vibrationAvailable,serverVibration);
 const alerted=useRef<string|null>(null),active=sessions.find(s=>!s.data.finishedAt&&!s.data.deleted),current=active?nextSet(active.data):null;
 const timerWorkoutId=active?.id,timerRestUntil=active?.data.restUntil??null;
 useEffect(()=>{setWorkoutTimer(timerWorkoutId?{id:timerWorkoutId,restUntil:timerRestUntil}:null);},[timerWorkoutId,timerRestUntil,setWorkoutTimer]);
 // The tab stays mounted: a set draft may travel around the app with its session.
 // Actual pending writes and independent editors keep their existing navigation lock.
 useUnsaved(trainingBusy||notesDirty||builderDirty||cardioDirty||routineDirty||setupNotesDirty||!!sessionDraft||!!loadReview||(busy&&loaded)||!!pending||!!routinePending||!!startPending||!!weightPending,onDirty);
 const previewDirty=Object.values(previews).some(draft=>!sameRoutinePlan(draft.data,routines.find(r=>r.id===draft.id)?.data));
 useEffect(()=>{if(!setDirty&&!previewDirty&&!reviewDirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[setDirty,previewDirty,reviewDirty]);
 useLayoutEffect(()=>{readGuard.current=busy||!!pending||!!routinePending||!!startPending||!!weightPending||!!loadReview||!!sessionDraft||previewDirty||setDirty||routineDirty||reviewDirty||setupNotesDirty;},[busy,pending,routinePending,startPending,weightPending,loadReview,sessionDraft,previewDirty,setDirty,routineDirty,reviewDirty,setupNotesDirty]);
 async function reload(discardSetDraft=false){
  const blocked=()=>discardSetDraft?busy||!!pending||!!routinePending||!!startPending||!!weightPending||!!loadReview||!!sessionDraft||routineDirty:readGuard.current;
  if(readLock.current||writeLock.current||blocked())return;
  const ticket=++dataEpoch.current,initial=!loaded;readLock.current=true;if(initial||discardSetDraft)setBusy(true);
  try{
   const [r,w]=await Promise.all([request('?kind=routine'),request('?kind=workout')]);
   if(ticket!==dataEpoch.current||writeLock.current||(!initial&&blocked()))return;
   setRoutines(r.records);setIncomplete(r.hasMore);setSelectedId(id=>id||r.records.find((x:Saved<Routine>)=>!x.data.archived)?.id||'');setSessions(w.records);setLoaded(true);setError('');
   if(discardSetDraft){const saved=w.records.find((s:Saved<Workout>)=>!s.data.finishedAt&&!s.data.deleted),next=saved?nextSet(saved.data):null;setEditingSet(null);setReps(String(next?.exercise.reps??0));setLoad(String(workingLoad(saved?.data,next?.exercise)));setWarmup(false);setWeightEdited(false);setSetDirty(false);}
   void refreshSummary();
  }catch(e){if(ticket===dataEpoch.current)setError((e as Error).message);}finally{readLock.current=false;if(initial||discardSetDraft)setBusy(false);}
 }
 useLayoutEffect(()=>{reloadLatest.current=reload;});
 useEffect(()=>{void reloadLatest.current();},[refreshKey]);
 // Returning to Workouts and the browser reconciles read-only state. Never
 // replace an entered set, pending write or program draft with a background read.
 useEffect(()=>{
  if(!visible)return;
  const reconcile=()=>{if(document.visibilityState!=='hidden')void reloadLatest.current();};
  reconcile();window.addEventListener('focus',reconcile);document.addEventListener('visibilitychange',reconcile);
  const timer=setInterval(reconcile,30_000);
  return()=>{window.removeEventListener('focus',reconcile);document.removeEventListener('visibilitychange',reconcile);clearInterval(timer);};
 },[visible]);
 const currentKey=active?.id+':'+current?.exercise.id+':'+current?.setNumber+':'+current?.workingSetNumber;
 const [draftKey,setDraftKey]=useState(currentKey);
 if(draftKey!==currentKey){setDraftKey(currentKey);setReps(String(current?.exercise.reps??0));setLoad(String(workingLoad(active?.data,current?.exercise)));if(!draftKey.startsWith(active?.id+':'+current?.exercise.id+':'))setSaveWeight(true);setWeightEdited(false);setSetDirty(false);setEditingSet(null);setWarmup(false);}
 function chime(){const context=audioContext.current;if(!context||context.state!=='running')return;const tone=context.createOscillator(),gain=context.createGain(),now=context.currentTime;tone.type='sine';tone.frequency.value=660;gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(.12,now+.02);gain.gain.exponentialRampToValueAtTime(.001,now+.45);tone.connect(gain);gain.connect(context.destination);tone.start(now);tone.stop(now+.5);tone.onended=()=>{tone.disconnect();gain.disconnect();};}
 async function toggleSound(){if(sound){setSound(false);return;}try{const context=audioContext.current||new AudioContext();audioContext.current=context;await context.resume();if(context.state!=='running')throw new Error();setSound(true);chime();}catch{setError('Sound is unavailable in this browser.');}}
 function toggleVibration(){if(!supportsVibration)return;setVibration(value=>!value);if(!vibration)navigator.vibrate(100);}
 useEffect(()=>()=>{void audioContext.current?.close();},[]);
 useEffect(()=>{if(!active?.data.restUntil)return;const tick=()=>{const now=Date.now();setClock(now);const end=active.data.restUntil!;if(restRemaining(end,now)===0&&document.visibilityState==='visible'&&alerted.current!==end){alerted.current=end;if(vibration&&typeof navigator.vibrate==='function')navigator.vibrate([200,100,200]);if(sound)chime();}};tick();const timer=setInterval(tick,250);document.addEventListener('visibilitychange',tick);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',tick);};},[active?.data.restUntil,vibration,sound]);
 function reviewDraft(draft:Saved<Routine>){openEditor(routines.find(r=>r.id===draft.id)||draft);}
 function cancelRoutine(){if(busy||routinePending)return;setRoutine(null);setRoutineDirty(false);setRoutineError('');setRoutineConflict(undefined);setEditorExerciseId(undefined);setPanel(null);}
 function editRoutine(data:Routine){if(routine)setRoutine({...routine,data});setRoutineDirty(true);setNotice('');}
 async function readSavedProgram(id:string):Promise<Saved<Routine>|null>{
  try{const result=await request('?kind=routine'),saved=result.records.find((record:Saved<Routine>)=>record.id===id);if(!saved)return null;const parsed=routineSchema.safeParse(saved.data);if(!parsed.success||!Number.isInteger(saved.version)||saved.version<1)return null;const latest={...saved,data:parsed.data};setRoutines(previous=>[latest,...previous.filter(record=>record.id!==id)]);return latest;}catch{return null;}
 }
 async function readSavedWorkout(id:string):Promise<Saved<Workout>|null>{
  try{const result=await request('?kind=workout'),saved=result.records.find((record:Saved<Workout>)=>record.id===id);if(!saved)return null;const parsed=workoutSchema.safeParse(saved.data);return parsed.success&&Number.isInteger(saved.version)&&saved.version>0?{...saved,data:parsed.data}:null;}catch{return null;}
 }
 async function checkProgramConflict(source:'editor'|'start'){
  const draft=source==='editor'?routine:startChoice;if(!draft||writeLock.current||routinePending||startPending||pending)return;
  writeLock.current=true;dataEpoch.current++;setBusy(true);
  try{const saved=await readSavedProgram(draft.id);if(source==='editor')setRoutineConflict(saved);else setStartConflict(saved);}finally{writeLock.current=false;setBusy(false);}
 }
 function acceptSavedProgram(source:'editor'|'start'){
  if(busy||writeLock.current||routinePending||startPending||pending)return;
  const saved=source==='editor'?routineConflict:startConflict;if(!saved)return;
  if(source==='editor'){setRoutine(structuredClone(saved));setRoutineDirty(false);setRoutineConflict(undefined);setRoutineError('');setEditorExerciseId(undefined);}
  else{resetPreview(startChoice?.id||saved.id);setSelectedId(saved.id);setStartChoice(null);setStartConflict(undefined);setStartError('');setPanel(null);}
 }
 async function saveRoutine(asCopy=false){
  const draft=routinePending||routine;if(!draft||writeLock.current||asCopy&&routinePending||!asCopy&&routineConflict!==undefined)return;
  const retrying=!!routinePending,record=asCopy?copyRoutineDraft(draft):draft;
  writeLock.current=true;dataEpoch.current++;setBusy(true);setRoutineError('');setRoutinePending(record);
  if(asCopy){setRoutine(record);setRoutineConflict(undefined);}
  try{const saved=await saveRecord('routine',record);setRoutines(prev=>[saved,...prev.filter(r=>r.id!==saved.id)]);setSelectedId(saved.id);setRoutine(null);setRoutinePending(null);setRoutineConflict(undefined);setRoutineDirty(false);setPanel(null);setNotice('');}
  catch(e){const status=(e as {status?:number}).status;setRoutineError((e as Error).message);const latest=status===409?await readSavedProgram(record.id):null;if(definiteWorkoutRejection(status,retrying,record.version,latest?.version)){setRoutinePending(null);if(status===409){setRoutineConflict(latest);setRoutineError('');}}}
  finally{writeLock.current=false;setBusy(false);}
 }
 async function persistWorkout(record:Saved<Workout>,effect:'preserve'|'advance'|'end'='preserve'):Promise<boolean>{
  if(writeLock.current)return false;
  const retrying=!!pending;
  writeLock.current=true;dataEpoch.current++;pendingEffect.current=effect;setPending(record);setBusy(true);setError('');
  try{
   const saved=await saveRecord('workout',record);
   setSessions(prev=>[saved,...prev.filter(s=>s.id!==saved.id)]);setPending(null);
   if(effect!=='preserve'){
    setWarmup(false);setWeightEdited(false);setSetDirty(false);setEditingSet(null);
    const next=nextSet(saved.data);setReps(String(next?.exercise.reps??0));setLoad(String(workingLoad(saved.data,next?.exercise)));
    if(!next&&!saved.data.finishedAt&&!saved.data.deleted)setReviewingId(saved.id);
   }
   if(effect==='end')setPanel(null);
   if(effect==='advance'&&record.version===0){resetPreview(saved.data.routineId);setStartChoice(null);setPanel(null);}
   void refreshSummary();
   setNotice(saved.data.deleted?'Workout moved to Trash.':saved.data.finishedAt?'Workout saved to your history.':'');
   return true;
  }catch(e){
   setError((e as Error).message);
   const status=(e as {status?:number}).status,latest=retrying&&status===409?await readSavedWorkout(record.id):null;
   if(definiteWorkoutRejection(status,retrying,record.version,latest?.version))setPending(null);
   return false;
  }finally{writeLock.current=false;setBusy(false);}
 }
 function start(r:Saved<Routine>){if(active||busy||pending||startPending||writeLock.current)return;try{const record=createWorkoutSession(r,todayIn(profile.timezone));setStartChoice(null);setStartConflict(undefined);setPanel(null);void persistWorkout(record,'advance');}catch{setStartError('Complete the workout name and exercise targets before starting.');}}
 function resetPreview(id:string){setPreviews(previous=>{const next={...previous};delete next[id];return next;});}
 function updatePreview(draft:Saved<Routine>){setPreviews(previous=>{const next={...previous},saved=routines.find(r=>r.id===draft.id);if(saved&&sameRoutinePlan(saved.data,draft.data))delete next[draft.id];else next[draft.id]=draft;return next;});}
 function openSessionEditor(r:Saved<Routine>,exerciseId?:string,addExercise?:string){const draft=structuredClone(previews[r.id]||r);if(addExercise&&draft.data.exercises.length<30)draft.data.exercises.push(newExercise(addExercise));setSessionDraft(draft);setSessionExerciseId(addExercise?draft.data.exercises.at(-1)?.id:exerciseId);setSessionDraftError('');setPanel('session-editor');}
 function closeSessionEditor(){if(busy)return;setSessionDraft(null);setSessionDraftError('');setPanel(null);}
 function applySession(){if(!sessionDraft)return;const parsed=routineSchema.safeParse(sessionDraft.data);if(!parsed.success){setSessionDraftError('Complete the name and exercise targets. Use whole sets and reps, an upper rep target at least as high as the lower target, and valid load and rest values.');return;}updatePreview({...sessionDraft,data:parsed.data});closeSessionEditor();}
 function continueStart(r:Saved<Routine>,changed:boolean){setLoadReview(null);if(!changed){start(r);return;}setStartChoice(structuredClone(r));setTemplateName((r.data.name===selected?.data.name?r.data.name+' (copy)':r.data.name).slice(0,100));setStartError('');setStartConflict(undefined);setPanel('start-options');}
 async function requestStart(r:Saved<Routine>,changed:boolean){
  if(busy||pending||startPending||weightPending||writeLock.current)return;
  const ticket=++loadReviewEpoch.current,draft=structuredClone(r);setStartError('');setStartConflict(undefined);setLoadReview({routine:draft,changed,histories:null,loads:{},error:''});setPanel('weight-review');
  try{const result=await request(`?exercise-performance&routineId=${r.id}`);if(ticket!==loadReviewEpoch.current)return;const histories=result.histories||{};
   if(!draft.data.exercises.some(exercise=>weightReviewReason(exercise,histories[exercise.id]))){continueStart(draft,changed);return;}
   setLoadReview({routine:draft,changed,histories,loads:Object.fromEntries(draft.data.exercises.map(e=>[e.id,String(e.load)])),error:''});
  }catch{if(ticket===loadReviewEpoch.current)setLoadReview({routine:draft,changed,histories:{},loads:{},error:'Previous performance could not be loaded. You can still start with your current weights.'});}
 }
 function closeLoadReview(){if(busy||startPending||pending)return;loadReviewEpoch.current++;setLoadReview(null);setStartChoice(null);setPanel(null);}
 function applyReviewedWeights(){
  if(!loadReview||!loadReview.histories)return;
  const source=loadReview.routine,exercises=source.data.exercises.map(exercise=>({...exercise,load:Number(loadReview.loads[exercise.id]??exercise.load)}));
  if(source.data.exercises.some(exercise=>{const value=loadReview.loads[exercise.id]??String(exercise.load);return !/^\d+(\.\d{1,2})?$/.test(value)||Number(value)>2000;})){setLoadReview({...loadReview,error:'Enter a weight from 0–2000 with at most two decimal places.'});return;}
  const updated={...source,data:{...source.data,exercises}};
  if(sameRoutinePlan(updated.data,source.data)){continueStart(source,loadReview.changed);return;}
  if(loadReview.changed){continueStart(updated,true);return;}
  setStartChoice(updated);setLoadReview(null);setPanel('start-options');void saveTemplateAndStart('overwrite',updated);
 }
 async function saveTemplateAndStart(mode:'new'|'overwrite'|'retry',reviewed?:Saved<Routine>){
  if(writeLock.current||active||pending)return;
  const retrying=!!startPending;
  let attempt=startPending;
  if(mode!=='retry'){
   const choice=reviewed||startChoice;if(!choice||startPending||busy||mode==='overwrite'&&startConflict!==undefined)return;
   const data={...structuredClone(choice.data),archived:false,...(mode==='new'?{name:templateName.trim()}: {})},parsed=routineSchema.safeParse(data);
   if(!parsed.success){setStartError('Enter a template name and valid exercise targets.');return;}
   attempt={sourceId:choice.id,record:mode==='new'?copyRoutineDraft({...choice,data:parsed.data},templateName.trim()):{...choice,data:parsed.data}};
  }
  if(!attempt)return;
  writeLock.current=true;dataEpoch.current++;setBusy(true);setStartPending(attempt);setStartError('');
  let saved:Saved<Routine>|null=null;
  try{saved=await saveRecord('routine',attempt.record);setRoutines(previous=>[saved!,...previous.filter(r=>r.id!==saved!.id)]);setSelectedId(saved.id);setStartPending(null);setStartConflict(undefined);resetPreview(attempt.sourceId);setStartChoice(null);setPanel(null);}
  catch(e){const status=(e as {status?:number}).status;setStartError((e as Error).message);const latest=status===409?await readSavedProgram(attempt.record.id):null;if(definiteWorkoutRejection(status,retrying,attempt.record.version,latest?.version)){setStartPending(null);if(status===409){setStartConflict(latest);setStartError('');}}}
  finally{writeLock.current=false;setBusy(false);}
  if(saved)void persistWorkout(createWorkoutSession(saved,todayIn(profile.timezone)),'advance');
 }
 async function persistWeightAndSet(attempt=weightPending){
  if(!attempt||writeLock.current||pending||weightConflict!=null)return;
  writeLock.current=true;dataEpoch.current++;setBusy(true);setWeightPending(attempt);setWeightError('');let acknowledged=false;
  try{const saved=await saveRecord('routine',attempt.program);setRoutines(previous=>[saved,...previous.filter(r=>r.id!==saved.id)]);acknowledged=true;}
  catch(e){const status=(e as {status?:number}).status;setWeightError((e as Error).message);const latest=status===409?await readSavedProgram(attempt.program.id):null;
   if(latest&&latest.version>attempt.program.version&&sameRoutinePlan(latest.data,attempt.program.data))acknowledged=true;
   else if(definiteWorkoutRejection(status,attempt.unconfirmed,attempt.program.version,latest?.version)){setWeightPending({...attempt,unconfirmed:false});if(status===409){setWeightConflict(latest);setWeightError('');}}
   else setWeightPending({...attempt,unconfirmed:true});
  }finally{writeLock.current=false;setBusy(false);}
  if(acknowledged){setWeightPending(null);setWeightConflict(undefined);setWeightError('');setPanel(null);void persistWorkout(attempt.workout,'advance');}
  else setPanel('weight-save');
 }
 function keepWeightOnLatest(){
  if(!weightPending||!weightConflict||weightPending.unconfirmed||weightConflict.data.archived)return;
  const exercise=weightPending.workout.data.exercises.find(e=>e.id===weightPending.exerciseId),match=exercise&&matchingProgramExercise(weightConflict.data,exercise),chosen=exercise&&matchingProgramExercise(weightPending.program.data,exercise);
  if(!match||!chosen)return;
  setWeightPending({...weightPending,program:{...weightConflict,data:{...weightConflict.data,exercises:weightConflict.data.exercises.map(e=>e.id===match.id?{...e,load:chosen.load}:e)}},unconfirmed:false});setWeightConflict(undefined);setWeightError('');
 }
 function saveSetOnly(){if(!weightPending||busy||weightPending.unconfirmed)return;const record=weightPending.workout;setWeightPending(null);setWeightConflict(undefined);setWeightError('');setPanel(null);void persistWorkout(record,'advance');}
 async function compareWeightProgram(){
  if(!weightPending||writeLock.current)return;const attempt=weightPending;writeLock.current=true;setBusy(true);let acknowledged=false;
  try{const latest=await readSavedProgram(attempt.program.id);if(latest&&latest.version>attempt.program.version){if(sameRoutinePlan(latest.data,attempt.program.data))acknowledged=true;else{setWeightPending({...attempt,unconfirmed:false});setWeightConflict(latest);setWeightError('');}}else{setWeightConflict(null);setWeightError('The saved program could not confirm this change. Your exact save remains available to retry.');}}
  finally{writeLock.current=false;setBusy(false);}
  if(acknowledged){setWeightPending(null);setWeightConflict(undefined);setWeightError('');setPanel(null);void persistWorkout(attempt.workout,'advance');}
 }
 function completeSet(){if(!active||busy||pending||weightPending||writeLock.current)return;const target=editingSet?{exercise:active.data.exercises.find(e=>e.id===editingSet.exerciseId)!,setNumber:editingSet.setNumber}:current;if(!target)return;
 if(!/^\d+$/.test(reps)||!/^\d+(\.\d{1,2})?$/.test(load)||Number(reps)>100||Number(load)>2000){setError('Enter 0–100 whole reps and a load from 0–2000.');return;}
 try{const data=reviseWorkoutSet(active.data,{exerciseId:target.exercise.id,...(editingSet?{setNumber:editingSet.setNumber}:!warmup?{workingSetNumber:current?.workingSetNumber}:{}),reps:Number(reps),load:Number(load),warmup});
 data.restUntil=editingSet?active.data.restUntil:nextSet(data)&&target.exercise.restSeconds?new Date(Date.parse(data.sets.at(-1)!.completedAt)+target.exercise.restSeconds*1000).toISOString():null;
 const program=routines.find(r=>r.id===active.data.routineId&&!r.data.archived),match=program&&matchingProgramExercise(program.data,target.exercise);
 if(!warmup&&!editingSet&&weightEdited&&saveWeight&&program&&match&&match.load!==Number(load)){
  void persistWeightAndSet({program:{...program,data:{...program.data,exercises:program.data.exercises.map(e=>e.id===match.id?{...e,load:Number(load)}:e)}},workout:{...active,data},exerciseId:target.exercise.id,unconfirmed:false});
 }else void persistWorkout({...active,data},'advance');}catch(e){setError(e instanceof Error&&e.message.includes('40 set identities')?e.message:'Keep at most 20 working sets and 20 warm-ups per exercise.');}
 }
 const remaining=restRemaining(active?.data.restUntil||null,clock),target=editingSet&&active?{exercise:active.data.exercises.find(e=>e.id===editingSet.exerciseId)!,setNumber:editingSet.setNumber}:current;
 const performanceKey=active&&current&&!editingSet?`${active.id}:${current.exercise.id}:${current.workingSetNumber}`:'';
 const performanceQuery=active&&current&&!editingSet?`?exercise-performance&workoutId=${active.id}&exerciseId=${current.exercise.id}&workingSetNumber=${current.workingSetNumber}`:'';
 useEffect(()=>{
  if(!performanceQuery||!visible)return;
  let cancelled=false;
  void request(performanceQuery).then(data=>{if(!cancelled)setPerformance({key:performanceKey,value:data.performance,history:data.history||null,loading:false,unavailable:false});}).catch(()=>{if(!cancelled)setPerformance({key:performanceKey,value:null,history:null,loading:false,unavailable:true});});
  return()=>{cancelled=true;};
 },[performanceKey,performanceQuery,visible]);
 const selected=routines.find(r=>r.id===selectedId&&!r.data.archived)||routines.find(r=>!r.data.archived);
 const selectedPreview=selected?(previews[selected.id]||selected):undefined;
 const previewChanged=!!selected&&!!selectedPreview&&!sameRoutinePlan(selected.data,selectedPreview.data);
 const programExercise=active&&target?matchingProgramExercise(routines.find(r=>r.id===active.data.routineId&&!r.data.archived)?.data||{name:'',preferences:'',archived:false,exercises:[]},target.exercise):undefined;
 const programWeightChanged=weightEdited&&!!programExercise&&/^\d+(\.\d{1,2})?$/.test(load)&&Number(load)<=2000&&Number(load)!==programExercise.load;
 const focused=!!active;
 useEffect(()=>{if(visible&&focused)sessionView.current?.scrollIntoView({block:'start'});},[visible,focused,active?.id]);
 function resetSetDraft(){setEditingSet(null);setReps(String(current?.exercise.reps??0));setLoad(String(workingLoad(active?.data,current?.exercise)));setWarmup(false);setWeightEdited(false);setSetDirty(false);}
 function changeRest(extend=false){if(!active)return;setClock(Date.now());void persistWorkout({...active,data:{...active.data,restUntil:extend?extendWorkoutRest(active.data.restUntil):null}});}
 function skipSet(){if(!active||busy||pending||editingSet)return;void persistWorkout({...active,data:skipCurrentSet(active.data)},'advance');}
 function finish(discardDraft=false,notes=active?.data.notes){if(!active||busy||pending||(!discardDraft&&setDirty))return;void persistWorkout({...active,data:{...active.data,...(notes!==undefined?{notes}:{}),restUntil:null,finishedAt:new Date().toISOString()}},'end');}
 const dialogSaveFeedback=<>{error&&<p className="error" role="alert">{error}</p>}{pending&&<p className="notice">{busy?'Saving workout…':<>Workout save unconfirmed. <Button onClick={()=>persistWorkout(pending,pendingEffect.current)}>Retry workout save</Button></>}</p>}</>;
 return <section className={`module-workspace training-workspace workout-flow${focused?' workout-in-session':''}`}>
 {error&&<div role="alert" className="error">{error}{!pending&&<Button variant="secondary" disabled={busy} onClick={()=>void reload(setDirty||previewDirty)}>{setDirty?'Discard set draft and reload':'Reload saved workout'}</Button>}</div>}{notice&&<p role="status" className="analysis-note">{notice}</p>}
 {pending&&<p className="notice">{busy?'Saving workout…':<>Workout save unconfirmed. <Button onClick={()=>persistWorkout(pending,pendingEffect.current)}>Retry workout save</Button></>}</p>}
 <div className="workout-analysis" hidden={focused}><TrainingAnalysis onBusy={setTrainingBusy} subtitle={<><strong>{summary?`This week · ${summary.current.sets} sets · ${summary.current.sessions} session${summary.current.sessions===1?'':'s'}`:'Your training week'}</strong><small>{summary?`${formatDate(summary.current.from)} – ${formatDate(summary.today)} · Last week: ${summary.previous.sets} sets`:summaryError||'Loading your logged training…'}</small></>}/></div>
 {focused&&active?<div ref={sessionView} className="workout-session-view"><WorkoutSession workout={active} target={target} visible={visible&&!panel} reviewing={reviewingId===active.id&&!editingSet} review={<WorkoutReview key={active.id} workout={active} busy={busy||!!pending} onSave={persistWorkout} onFinish={notes=>finish(false,notes)} onContinue={current?()=>setReviewingId(null):undefined} onDirty={setReviewDirty}/>} previousHistory={performance.key===performanceKey?performance.history:null} saveWeight={saveWeight} onSaveWeight={setSaveWeight} programWeightChanged={programWeightChanged} previousPerformance={performance.key===performanceKey?performance.value:null} previousPerformanceLoading={!!performanceKey&&(performance.key!==performanceKey||performance.loading)} previousPerformanceUnavailable={performance.key===performanceKey&&performance.unavailable} reps={reps} load={load} warmup={warmup} remaining={remaining} editing={!!editingSet} busy={busy} pending={!!pending||!!weightPending} setDirty={setDirty}
  onReps={value=>{setReps(value);setSetDirty(true);}} onLoad={value=>{setLoad(value);setWeightEdited(true);setSetDirty(true);}} onWarmup={value=>{setWarmup(value);if(!value){setLoad(String(workingLoad(active?.data,current?.exercise)));setWeightEdited(false);}setSetDirty(true);}}
  onSaveSet={completeSet} onSkipSet={skipSet} onSkipRest={()=>changeRest()} onExtendRest={()=>changeRest(true)} onPlan={()=>setPanel('sets')} onFinish={()=>finish()} onExit={()=>setPanel('exit-session')} onCancelCorrection={resetSetDraft} sound={sound} onSound={()=>void toggleSound()} vibration={vibration} onVibration={toggleVibration} supportsVibration={supportsVibration}/></div>:<>

 <div className="workout-selector-heading"><div><h2>Choose your workout</h2><p className="muted">Preview your exercises and muscle coverage, then make the session yours.</p></div><DropdownMenu modal={false}><DropdownMenuTrigger asChild><Button ref={programMenuButton} variant="secondary" disabled={busy||!!pending||!!startPending} aria-label="New program">+ New<ChevronDown aria-hidden="true"/></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="life-menu" onCloseAutoFocus={event=>{const choice=programBuildChoice.current;programBuildChoice.current=null;if(!choice)return;event.preventDefault();programMenuButton.current?.focus();if(choice==='ai')setPanel('builder');else if(routine)setPanel('editor');else openEditor(newRoutine());}}><DropdownMenuItem onSelect={()=>{programBuildChoice.current='manual';}}><Pencil aria-hidden="true"/><span>Manual Build{routine&&<small className="muted"> · Resume edit</small>}</span></DropdownMenuItem><DropdownMenuItem onSelect={()=>{programBuildChoice.current='ai';}}><Sparkles aria-hidden="true"/><span>AI Build{builderDirty&&<small className="muted"> · Resume AI builder</small>}</span></DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
 {!loaded?<Button disabled={busy} onClick={()=>void reload()}>{busy?'Opening workouts…':'Retry workouts'}</Button>:<>
 <section className="workout-programs" aria-label="Your programs"><div className="program-list">{!selected&&<p className="empty-inline">Create a program with + New, or write a workout below.</p>}{routines.filter(r=>!r.data.archived).map(r=><article className={selected?.id===r.id?'program-row selected':'program-row'} key={r.id}><button className="program-select" disabled={busy||!!pending||!!startPending} aria-pressed={selected?.id===r.id} onClick={()=>{if(selected?.id!==r.id){setSelectedId(r.id);}}}><strong>{r.data.name}</strong><small>{r.data.exercises.length} exercises · {r.data.exercises.reduce((n,e)=>n+e.sets,0)} sets{r.data.weeklySessions===undefined?' · set frequency':` · ${r.data.weeklySessions}× / week`}</small></button><Button variant="ghost" size="icon" disabled={busy||!!pending||!!startPending} onClick={()=>openEditor(r)} aria-label={'Edit '+r.data.name} title="Edit program"><Pencil aria-hidden="true"/></Button></article>)}</div>{routines.some(r=>r.data.archived)&&<Button variant="ghost" onClick={()=>setPanel('archived')}>Archived programs</Button>}</section>
 <div className="workout-preview-grid"><MuscleCoverage hideProgramChoice sessionPreview={previewChanged?selectedPreview:undefined} active={visible&&!focused} routines={routines.filter(r=>!r.data.archived)} selectedId={selected?.id||''} onSelect={setSelectedId} summary={summary} incomplete={incomplete} onEdit={(id,exercise,session)=>{const r=routines.find(r=>r.id===id);if(r){if(session)openSessionEditor(r,undefined,exercise);else openEditor(r,exercise);}}} onGuide={()=>setPanel('guide')}/>
 {selectedPreview&&<RoutinePreview routine={selectedPreview} changed={previewChanged} busy={busy} disabled={!!active||!!pending||!!startPending} onReset={()=>resetPreview(selectedPreview.id)} onEdit={exerciseId=>openSessionEditor(selectedPreview,exerciseId)} onStart={()=>requestStart(selectedPreview,previewChanged)}/>}</div></>}

 <footer className="workout-footer" aria-label="Workout tools"><Button variant="ghost" onClick={()=>setPanel('notes')}>{notesDirty?'Resume note':'Write workout'}</Button><Button variant="ghost" onClick={()=>{setCardioHistory(false);setPanel('cardio');}}>{cardioDirty?'Resume cardio':'Log cardio'}</Button><Button variant="ghost" onClick={()=>setPanel('history')}>History</Button></footer>
 </>}

 <WorkoutPanel open={panel==='weight-review'} title="Review your working weights" onClose={closeLoadReview} closeDisabled={busy||!!startPending||!!pending}>{loadReview&&<div className="workout-weight-review">{!loadReview.histories?<p role="status">Checking your last working sets…</p>:<><p>Keep your weight or choose a new one for every working set. Warm-ups stay separate.</p>{loadReview.routine.data.exercises.map(exercise=>{const history=loadReview.histories?.[exercise.id],reason=weightReviewReason(exercise,history);return reason&&history?<label key={exercise.id}><strong>{exercise.name}</strong><span>{reason==='increase'?`All ${exercise.sets} working sets reached ${exercise.repMax??exercise.reps} reps last time.`:`A working set was below ${exercise.reps} reps last time.`}</span><small>{formatDate(history.date)} · {history.sets.map(set=>`Set ${set.workingSetNumber}: ${set.reps} × ${set.load} ${history.unit}`).join(' · ')}</small><span>Working weight ({exercise.unit})</span><input aria-label={`${exercise.name} working weight (${exercise.unit})`} inputMode="decimal" value={loadReview.loads[exercise.id]??String(exercise.load)} onChange={event=>setLoadReview({...loadReview,loads:{...loadReview.loads,[exercise.id]:event.target.value},error:''})}/></label>:null;})}{loadReview.error&&<p role="alert" className="error">{loadReview.error}</p>}<Button disabled={busy||!!startPending} onClick={applyReviewedWeights}>{loadReview.changed?'Review session & begin':'Save weights & start'}</Button><Button variant="secondary" disabled={busy||!!startPending} onClick={()=>continueStart(loadReview.routine,loadReview.changed)}>Start with current weights</Button></>}<Button variant="ghost" disabled={busy||!!startPending} onClick={closeLoadReview}>Back to preview</Button></div>}</WorkoutPanel>
 <WorkoutPanel open={panel==='weight-save'} title="Save working weight" onClose={()=>{if(busy||weightPending?.unconfirmed)return;setWeightPending(null);setWeightConflict(undefined);setWeightError('');setPanel(null);}} closeDisabled={busy||!!weightPending?.unconfirmed}>{weightPending&&<div className="workout-weight-save"><p>Your set is ready to save. The program weight is saved first, then this exact set.</p>{weightError&&<p className="error" role="alert">{weightError}</p>}{weightPending.unconfirmed&&<p className="notice">The program save is unconfirmed. Retry the same change or check the saved program.</p>}{weightConflict&&<><p>The program changed elsewhere. Review both weights before choosing.</p>{(()=>{const exercise=weightPending.workout.data.exercises.find(e=>e.id===weightPending.exerciseId)!,local=matchingProgramExercise(weightPending.program.data,exercise),saved=matchingProgramExercise(weightConflict.data,exercise);return <><p><strong>{exercise.name}</strong> · Your weight: {local?.load} {exercise.unit} · Saved: {saved?`${saved.load} ${saved.unit}`:'Exercise unavailable'}</p><Button disabled={busy||weightPending.unconfirmed||!saved||weightConflict.data.archived} onClick={keepWeightOnLatest}>Keep my weight for review</Button></>;})()}</>}{weightConflict==null&&<Button disabled={busy} onClick={()=>void persistWeightAndSet()}>{busy?'Saving…':weightPending.unconfirmed?'Retry weight & set save':'Save weight & set'}</Button>}<Button variant="secondary" disabled={busy} onClick={()=>void compareWeightProgram()}>Check saved program</Button>{!weightPending.unconfirmed&&<Button variant="secondary" disabled={busy} onClick={saveSetOnly}>Save set without updating program</Button>}</div>}</WorkoutPanel>
 <WorkoutPanel open={panel==='exit-session'} title="Leave workout?" onClose={()=>setPanel(null)} closeDisabled={busy||!!pending}>{active&&<div className="workout-exit-options"><p>Finish with your logged sets, or cancel this workout and move it to Trash.</p>{(setDirty||reviewDirty)&&<p className="muted">Your current unsaved set entry or workout notes will be discarded. Only saved sets and notes are included when finishing.</p>}{error&&<p role="alert" className="error">{error}</p>}{pending&&<Button disabled={busy} onClick={()=>persistWorkout(pending,pendingEffect.current)}>Retry workout save</Button>}<Button disabled={busy||!!pending} onClick={()=>finish(true)}>Finish with logged sets</Button><Button variant="destructive" disabled={busy||!!pending} onClick={()=>persistWorkout({...active,data:{...active.data,restUntil:null,deleted:true}},'end')}>Cancel workout</Button></div>}</WorkoutPanel>
 <WorkoutPanel open={panel==='session-editor'} title="Edit this session" onClose={closeSessionEditor} closeDisabled={busy}>{sessionDraft&&<RoutineEditor session key={sessionDraft.id} initialExerciseId={sessionExerciseId} routine={sessionDraft} onChange={data=>{setSessionDraft({...sessionDraft,data});setSessionDraftError('');}} onSave={applySession} onCancel={closeSessionEditor} busy={busy} pending={false} error={sessionDraftError}/>}</WorkoutPanel>
 <WorkoutPanel open={panel==='start-options'} title="Start your edited workout" onClose={()=>{setStartChoice(null);setStartConflict(undefined);setStartError('');setPanel(null);}} closeDisabled={busy||!!startPending||!!pending}>{startChoice&&<div className="workout-start-options"><p>Use these changes for today, or save them as a template for next time.</p>{startConflict!==undefined&&<RoutineConflict saved={startConflict} busy={busy||!!startPending||!!pending} session onReload={()=>void checkProgramConflict('start')} onUseSaved={()=>acceptSavedProgram('start')}/ >}{startError&&<p className="error" role="alert">{startError}</p>}{startPending&&<p className="notice">{busy?'Saving template…':'Template save unconfirmed.'}{!busy&&<Button onClick={()=>void saveTemplateAndStart('retry')}>Retry template save & begin</Button>}</p>}<fieldset disabled={busy||!!startPending||!!pending}><Button disabled={!!startConflict?.data.archived} onClick={()=>start(startChoice)}>Begin without saving template</Button><Button variant="secondary" disabled={startConflict!==undefined} onClick={()=>void saveTemplateAndStart('overwrite')}>Overwrite existing template & begin</Button><label className="compact-field">New template name<input maxLength={100} value={templateName} onChange={event=>setTemplateName(event.target.value)}/></label><Button variant="secondary" disabled={!templateName.trim()} onClick={()=>void saveTemplateAndStart('new')}>Save as new template & begin</Button><Button variant="ghost" onClick={()=>{setStartChoice(null);setStartConflict(undefined);setPanel(null);}}>Back to preview</Button></fieldset></div>}</WorkoutPanel>
 <WorkoutPanel open={panel==='editor'} title={routine?.version?'Edit program':'New program'} onClose={cancelRoutine} closeDisabled={busy||!!routinePending}>{routine&&<RoutineEditor key={routine.id} initialExerciseId={editorExerciseId} routine={routine} onChange={editRoutine} onSave={()=>void saveRoutine()} onCancel={cancelRoutine} busy={busy} pending={!!routinePending} error={routineError} conflict={routineConflict} onReloadConflict={()=>void checkProgramConflict('editor')} onUseSaved={()=>acceptSavedProgram('editor')} onSaveCopy={()=>void saveRoutine(true)}/>}</WorkoutPanel>
 <WorkoutPanel open={panel==='notes'} title="Write workout" onClose={()=>setPanel(null)}><WorkoutNotes profile={profile} onDirty={setNotesDirty} onSaved={()=>void refreshSummary()}/></WorkoutPanel>
 <WorkoutPanel open={panel==='cardio'} title="Cardio" onClose={()=>setPanel(null)}><CardioLog onCancel={()=>setPanel(null)} onSaved={()=>void refreshSummary()} profile={profile} onDirty={setCardioDirty} active={panel==='cardio'&&!cardioHistory}/></WorkoutPanel>
 <WorkoutPanel open={panel==='builder'} title="Build programs with AI" onClose={()=>setPanel(null)}><RoutineBuilder embedded onDirty={setBuilderDirty} onReview={reviewDraft} reviewDisabled={!!routine||busy||!!pending||setDirty}/></WorkoutPanel>
 <WorkoutPanel scrollBody open={panel==='sets'} title="Your session" onClose={()=>setPanel(null)} closeDisabled={busy||!!pending}>{dialogSaveFeedback}{active&&<><fieldset disabled={busy||!!pending||setupNotesDirty}><div className="session-information-summary"><h3>{active.data.name}</h3><p>{formatDate(active.data.date)} · {active.data.sets.filter(s=>!s.warmup).length} working sets logged · {active.data.skippedSets?.length||0} skipped · {active.data.sets.filter(s=>s.warmup).length} warm-ups</p><progress value={active.data.sets.filter(s=>!s.warmup).length+(active.data.skippedSets?.length||0)} max={active.data.exercises.reduce((total,e)=>total+e.sets,0)} aria-label="Planned working sets logged or skipped"/></div><Button variant="secondary" disabled={setDirty||reviewDirty} onClick={()=>{setReviewingId(active.id);setPanel(null);}}>Review sets and workout notes</Button>{active.data.exercises.map(e=><div className="exercise-log" key={e.id}><strong>{e.name}</strong><small>{e.sets} sets × {repTarget(e)} target reps · {e.unit}</small>{active.data.skippedSets?.filter(s=>s.exerciseId===e.id).map(s=><div className="ledger-row" key={'skip-'+s.workingSetNumber}><span>Working set {s.workingSetNumber} · Skipped</span><Button variant="ghost" disabled={setDirty} onClick={()=>{setReviewingId(null);void persistWorkout({...active,data:restoreSkippedSet(active.data,e.id,s.workingSetNumber)},'advance');}}>Undo skip</Button></div>)}{active.data.sets.filter(s=>s.exerciseId===e.id).sort((a,b)=>a.setNumber-b.setNumber).map(s=><div className="ledger-row" key={s.setNumber}><span>{s.warmup?"Warm-up":"Logged set"} {s.setNumber}: {s.reps} reps × {s.load} {e.unit}</span><Button variant="ghost" disabled={setDirty||reviewDirty} onClick={()=>{setEditingSet({exerciseId:e.id,setNumber:s.setNumber});setReps(String(s.reps));setLoad(String(s.load));setWarmup(!!s.warmup);setPanel(null);setSetDirty(true);}}>Correct</Button><Button variant="ghost" disabled={setDirty||reviewDirty} onClick={()=>persistWorkout({...active,data:removeWorkoutSet(active.data,e.id,s.setNumber)})}>Delete set</Button></div>)}</div>)}</fieldset>{routines.find(r=>r.id===active.data.routineId)&&<ExerciseSetupNotes key={active.id} routine={routines.find(r=>r.id===active.data.routineId)!} workout={active.data} disabled={busy||!!pending} onSaved={saved=>setRoutines(previous=>previous.map(r=>r.id===saved.id?saved:r))} onDirty={setSetupNotesDirty}/>}<WorkoutNotificationControl/><p className="muted">Sound and vibration alert you when rest ends. Keep LifeApp open and your screen unlocked. Availability depends on your browser and device.</p></>}</WorkoutPanel>
 <WorkoutPanel open={panel==='history'} title="Workout history" onClose={()=>setPanel(null)} closeDisabled={busy||!!pending}>{dialogSaveFeedback}<div className="module-card"><div className="section-heading"><Button variant="ghost" onClick={()=>{setCardioHistory(true);setPanel('cardio');}}>Cardio history</Button><h3>Recent workout history</h3></div><p className="muted">Review recorded sets, restore skipped sets and update workout notes.</p>{!sessions.some(s=>s.data.finishedAt)&&<p className="empty-inline">Finished workouts will appear here.</p>}<Accordion type="single" collapsible>{sessions.filter(s=>s.data.finishedAt&&!s.data.deleted).map(s=>{const totals=workoutTotals(s.data);return <AccordionItem value={s.id} key={s.id}><AccordionTrigger>{formatDate(s.data.date)} · {s.data.name} · {totals.sets} sets / {totals.reps} reps</AccordionTrigger><AccordionContent><WorkoutReview workout={s} busy={busy||!!pending} onSave={persistWorkout}/><Button variant="ghost" disabled={busy||!!pending} onClick={()=>persistWorkout({...s,data:{...s.data,deleted:true}})}>Delete workout</Button></AccordionContent></AccordionItem>;})}</Accordion></div></WorkoutPanel>
 <WorkoutPanel open={panel==='archived'} title="Archived programs" onClose={()=>setPanel(null)}>{routines.filter(r=>r.data.archived).map(r=><div className="ledger-row" key={r.id}><span>{r.data.name}</span><Button onClick={()=>openEditor(r)}>Edit / restore</Button></div>)}</WorkoutPanel>
 <WorkoutPanel open={panel==='guide'} title="Understanding muscle coverage" onClose={()=>setPanel(null)}><div className="training-guidance"><p>The map estimates broad muscle groups. Direct work counts as one set; assisting work counts as half a set. Exercise technique, effort and individual anatomy change the actual stimulus. Select Muscle groups while editing any exercise to adjust its assignments.</p><p>ACSM’s 2026 guidance suggests around 10 weekly sets per muscle group for hypertrophy, with individualization and major muscle groups trained at least twice weekly. This is a reference, not a target everyone must meet or a reason to keep adding volume. The half-set estimate comes from separate research by Pelland and colleagues.</p><p>Program shows one session. Weekly plan multiplies saved sets by your chosen sessions per week; unset frequencies are excluded. This week counts only logged positive-rep working sets, including those in an ongoing workout. Warm-ups, unlogged sets, cardio and unstructured notes do not add to the map. Confirmed sets from written workouts count once. Older sets without a warm-up label are treated as working sets. Shoulders and core are grouped; coverage of one region does not mean every part received the same work.</p><p>Presets favor muscle growth with strength secondary: heavier lifts use lower rep ranges and longer rest. Adjust targets, starting loads and rest to maintain controlled, challenging sets and recover well.</p><ul>{[...volumeSources,...trainingSources.slice(1)].map(source=><li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></li>)}</ul></div></WorkoutPanel>
 </section>;
}
