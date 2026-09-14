import type {Exercise,Routine,Workout,Saved} from './modules.ts';
import {muscleIds,type MuscleId,type MuscleTargets} from './muscle-groups.ts';
// Curated movement-based defaults, not individualized measurements. Stabilization
// alone is not automatically credited. Explicit user mappings take precedence.
const mapping:Record<string,MuscleTargets>={};
function assign(names:string[],direct:MuscleId[],indirect:MuscleId[]=[]){for(const name of names)mapping[name.toLowerCase()]={direct,indirect};}
assign(['Squat','Front squat','Leg press','Hack squat','Goblet squat','Lunge','Reverse lunge','Bulgarian split squat','Step-up'],['quads','glutes'],['adductors']);
assign(['Deadlift','Trap-bar deadlift'],['glutes'],['quads','hamstrings','lower-back']);
assign(['Romanian deadlift','Dumbbell Romanian deadlift'],['hamstrings','glutes'],['lower-back']);
assign(['Hip thrust','Glute bridge'],['glutes']);
assign(['Bench press','Incline bench press','Dumbbell bench press','Incline dumbbell press','Machine chest press','Push-up'],['chest'],['triceps','shoulders']);
assign(['Overhead press','Seated dumbbell press','Machine shoulder press'],['shoulders'],['triceps']);
assign(['Dip','Assisted dip'],['chest','triceps'],['shoulders']);
assign(['Pull-up','Chin-up','Assisted pull-up','Lat pulldown'],['lats'],['biceps','upper-back']);
assign(['Barbell row','Pendlay row','Cable row','Dumbbell row','Chest-supported row','Machine row','Inverted row'],['upper-back','lats'],['biceps','shoulders']);
assign(['Biceps curl','Dumbbell curl','Preacher curl','Cable curl'],['biceps']);
assign(['Hammer curl'],['biceps'],['forearms']);
assign(['Triceps extension','Triceps pushdown','Overhead triceps extension','Skull crusher'],['triceps']);
assign(['Leg curl','Seated leg curl'],['hamstrings']);assign(['Leg extension'],['quads']);
assign(['Standing calf raise','Calf raise','Seated calf raise'],['calves']);
assign(['Hip abduction'],['glutes']);assign(['Hip adduction'],['adductors']);
assign(['Lateral raise','Cable lateral raise','Rear-delt fly','Reverse pec deck'],['shoulders']);
assign(['Face pull'],['shoulders','upper-back']);assign(['Shrug'],['upper-back']);
assign(['Cable fly','Pec deck','Dumbbell fly'],['chest']);
assign(['Cable crunch','Crunch','Reverse crunch','Hanging knee raise','Dead bug','Pallof press'],['abs']);
assign(['Bird dog'],['abs'],['lower-back','glutes']);
export function exerciseTargets(exercise:Pick<Exercise,'name'|'muscles'>):MuscleTargets|null{
 const targets=exercise.muscles||mapping[exercise.name.trim().toLowerCase().replace(/[–—]/g,'-').replace(/\s+/g,' ')];
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
 const inWindow=workouts.filter(w=>w.data.date>=from&&w.data.date<=through),items:{routineId:string;exercise:Exercise;sets:number}[]=[];let warmups=0,zeroRepSets=0;
 for(const w of inWindow){for(const e of w.data.exercises){const logged=w.data.sets.filter(s=>s.exerciseId===e.id);warmups+=logged.filter(s=>s.warmup).length;zeroRepSets+=logged.filter(s=>!s.warmup&&s.reps===0).length;items.push({routineId:w.data.routineId,exercise:e,sets:logged.filter(s=>!s.warmup&&s.reps>0).length});}}
 return {...tallyVolume(items),from,through,sessions:inWindow.filter(w=>w.data.sets.some(s=>!s.warmup&&s.reps>0)).length,warmups,zeroRepSets};
}
export function volumeEvidence(workouts:Saved<Workout>[],from:string,through:string){const result=recordedVolume(workouts,from,through);return {from,through,muscles:result.muscles,workingSets:result.sets,unmappedSets:result.unmapped.reduce((n,e)=>n+e.sets,0),excludedWarmups:result.warmups,interpretation:'Estimated muscle volume = direct sets + half of indirect sets. Curated or user-selected mappings are estimates, not measured stimulus. Warmups and zero-rep sets are excluded; unmarked historical sets are treated as working sets. Written notes and cardio are not inferred into set counts. Around 10 weekly sets is a broad hypertrophy reference, not an individual optimum or a requirement for every small muscle. Do not scale this weekly reference to monthly/annual totals or interpret incomplete logging as failure.'};}
