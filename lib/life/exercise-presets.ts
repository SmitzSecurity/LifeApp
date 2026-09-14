import {exerciseTargets} from './muscle-volume.ts';
import type {Exercise} from './modules.ts';
import {exerciseNameKey,resolveExerciseName} from './exercise-names.ts';
// Editable starting points for hypertrophy with strength secondary. Exercise-level
// assignments are practical applications of the evidence, not proven optima.
export const trainingSources=[
 {title:'ACSM resistance training guidelines (2026)',url:'https://acsm.org/resistance-training-guidelines-update-2026/'},
 {title:'IUSCA hypertrophy position stand',url:'https://journal.iusca.org/index.php/Journal/article/view/81'},
 {title:'Rest interval meta-analysis (2024)',url:'https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2024.1429789/full'},
];
const groups=[
 {group:'Heavy lower-body lifts',reps:5,repMax:8,restSeconds:180,names:['Squat','Front squat','Deadlift','Trap-bar deadlift']},
 {group:'Presses',reps:6,repMax:10,restSeconds:150,names:['Bench press','Incline bench press','Dumbbell bench press','Incline dumbbell press','Overhead press','Seated dumbbell press','Dip','Assisted dip']},
 {group:'Pulls',reps:6,repMax:10,restSeconds:150,names:['Pull-up','Chin-up','Assisted pull-up','Barbell row','Pendlay row']},
 {group:'Lower-body accessories',reps:8,repMax:12,restSeconds:120,names:['Leg press','Hack squat','Goblet squat','Romanian deadlift','Dumbbell Romanian deadlift','Hip thrust','Glute bridge','Lunge','Reverse lunge','Bulgarian split squat','Step-up']},
 {group:'Machine, cable & bodyweight compounds',reps:8,repMax:12,restSeconds:120,names:['Lat pulldown','Cable row','Dumbbell row','Chest-supported row','Machine row','Machine chest press','Machine shoulder press','Push-up','Inverted row']},
 {group:'Arms & legs',reps:10,repMax:15,restSeconds:90,names:['Biceps curl','Dumbbell curl','Hammer curl','Preacher curl','Cable curl','Triceps extension','Triceps pushdown','Overhead triceps extension','Skull crusher','Leg curl','Seated leg curl','Leg extension','Standing calf raise','Calf raise','Seated calf raise','Hip abduction','Hip adduction']},
 {group:'Shoulders & chest isolation',reps:12,repMax:20,restSeconds:90,names:['Lateral raise','Cable lateral raise','Rear-delt fly','Reverse pec deck','Face pull','Cable fly','Pec deck','Dumbbell fly','Shrug']},
 {group:'Core',reps:10,repMax:20,restSeconds:60,names:['Cable crunch','Crunch','Reverse crunch','Hanging knee raise','Dead bug','Bird dog','Pallof press']},
 {group:'Grip-specific pulls and high rows',reps:8,repMax:12,restSeconds:150,names:['Medium-grip lat pulldown','Neutral-grip lat pulldown','Chest-supported high row','Assisted neutral-grip chin-up','Neutral-grip chin-up']},
 {group:'Machine triceps work',reps:8,repMax:12,restSeconds:150,names:['Seated dip machine']},
 {group:'Forearms',reps:10,repMax:15,restSeconds:90,names:['Reverse curl','Wrist curl','Reverse wrist curl']},
];
export const exercisePresets=groups.flatMap(({names,...settings})=>names.map(name=>({name,sets:3,...settings})));
export function presetExercise(name='New exercise'):Exercise{
 const key=resolveExerciseName(name),preset=exercisePresets.find(e=>exerciseNameKey(e.name)===key),muscles=exerciseTargets({name});
 return {id:crypto.randomUUID(),name,...(muscles?{muscles}:{}),sets:preset?.sets||3,reps:preset?.reps||8,repMax:preset?.repMax||12,restSeconds:preset?.restSeconds||120,load:0,unit:'lb'};
}
export const repTarget=(exercise:Exercise)=>exercise.repMax&&exercise.repMax!==exercise.reps?`${exercise.reps}–${exercise.repMax}`:String(exercise.reps);
