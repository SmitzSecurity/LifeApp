import {workoutExercises,type Exercise,type Routine,type Workout,type Saved} from './modules.ts';
import {muscleIds,type MuscleId,type MuscleTargets} from './muscle-groups.ts';
import {presetMuscleReview} from './exercise-muscle-catalog.ts';
export function exerciseTargets(exercise:Pick<Exercise,'name'|'muscles'>):MuscleTargets|null{
 // Saved assignments (including an explicit empty selection) always win.
 const targets=exercise.muscles||presetMuscleReview(exercise.name);
 return targets?{direct:[...targets.direct],indirect:[...targets.indirect]}:null;
}
export type MuscleVolume={direct:number;indirect:number;estimated:number};
export type VolumeItem={routineId:string;exerciseId:string;name:string;sets:number;direct:MuscleId[];indirect:MuscleId[]};
export function tallyVolume(items:{routineId:string;exercise:Exercise;sets:number}[]){
 const muscles=Object.fromEntries(muscleIds.map(id=>[id,{direct:0,indirect:0,estimated:0}])) as Record<MuscleId,MuscleVolume>;
 const contributors:VolumeItem[]=[],unmapped:{name:string;sets:number}[]=[];let sets=0;
 for(const item of items){if(item.sets<=0)continue;sets+=item.sets;const targets=exerciseTargets(item.exercise);
  if(!targets||!targets.direct.length&&!targets.indirect.length){unmapped.push({name:item.exercise.name,sets:item.sets});continue;}
  contributors.push({routineId:item.routineId,exerciseId:item.exercise.id,name:item.exercise.name,sets:item.sets,...targets});
  for(const id of targets.direct)muscles[id].direct+=item.sets;
  for(const id of targets.indirect)muscles[id].indirect+=item.sets;
 }
 for(const m of Object.values(muscles))m.estimated=m.direct+m.indirect*.5;
 return {muscles,contributors,unmapped,sets};
}
export function routineVolume(routine:Saved<Routine>){return tallyVolume(routine.data.exercises.map(exercise=>({routineId:routine.id,exercise,sets:exercise.sets})));}
export function plannedVolume(routines:Saved<Routine>[]){
 const active=routines.filter(r=>!r.data.archived),scheduled=active.filter(r=>r.data.weeklySessions!==undefined);
 return {...tallyVolume(scheduled.flatMap(r=>r.data.exercises.map(exercise=>({routineId:r.id,exercise,sets:exercise.sets*r.data.weeklySessions!})))),scheduled:scheduled.length,unscheduled:active.length-scheduled.length,sessions:scheduled.reduce((n,r)=>n+r.data.weeklySessions!,0)};
}
export function recordedVolume(workouts:Saved<Workout>[],from:string,through:string){
 const inWindow=workouts.filter(w=>!w.data.deleted&&w.data.date>=from&&w.data.date<=through),items:{routineId:string;exercise:Exercise;sets:number}[]=[];let warmups=0,zeroRepSets=0;
 for(const w of inWindow){for(const e of workoutExercises(w.data)){const logged=w.data.sets.filter(s=>s.exerciseId===e.id);warmups+=logged.filter(s=>s.warmup).length;zeroRepSets+=logged.filter(s=>!s.warmup&&s.reps===0).length;items.push({routineId:w.data.routineId,exercise:e,sets:logged.filter(s=>!s.warmup&&s.reps>0).length});}}
 return {...tallyVolume(items),from,through,sessions:inWindow.filter(w=>w.data.sets.some(s=>!s.warmup&&s.reps>0)).length,warmups,zeroRepSets};
}
export function volumeEvidence(workouts:Saved<Workout>[],from:string,through:string){const result=recordedVolume(workouts,from,through);return {from,through,muscles:result.muscles,workingSets:result.sets,unmappedSets:result.unmapped.reduce((n,e)=>n+e.sets,0),excludedWarmups:result.warmups,interpretation:'Estimated muscle volume = direct sets + half of indirect sets. Curated or user-selected mappings are estimates, not measured stimulus. Warmups and zero-rep sets are excluded; unmarked historical sets are treated as working sets. Written notes and cardio are not inferred into set counts. Around 10 weekly sets is a broad hypertrophy reference, not an individual optimum or a requirement for every small muscle. Do not scale this weekly reference to monthly/annual totals or interpret incomplete logging as failure.'};}
