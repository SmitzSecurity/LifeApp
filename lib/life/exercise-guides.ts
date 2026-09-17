import {resolveExerciseName} from './exercise-names.ts';

export type ExerciseGuide={url:string;provider:string;label:string;isSearch?:boolean};

// These are reviewed pages, not exercise names converted into guessed URL slugs.
// Keep equipment/grip distinctions: an unsupported variant uses the search below.
const muscleWikiGuides:[string,string][]=[
 ['Squat','barbell-squat'],
 ['Front squat','barbell-front-squat-olympic'],
 ['Deadlift','barbell-deadlift'],
 ['Bench press','barbell-bench-press'],
 ['Incline bench press','barbell-incline-bench-press'],
 ['Dumbbell bench press','dumbbell-bench-press'],
 ['Incline dumbbell press','dumbbell-incline-bench-press'],
 ['Overhead press','barbell-overhead-press'],
 ['Seated dumbbell press','dumbbell-seated-overhead-press'],
 ['Pull-up','pull-ups'],
 ['Chin-up','chin-ups'],
 ['Assisted pull-up','machine-assisted-pull-up'],
 ['Barbell row','barbell-bent-over-row'],
 ['Pendlay row','barbell-pronated-pendlay-row'],
 ['Leg press','machine-leg-press'],
 ['Hack squat','machine-hack-squat'],
 ['Goblet squat','dumbbell-goblet-squat'],
 ['Romanian deadlift','barbell-romanian-deadlift'],
 ['Dumbbell Romanian deadlift','dumbbell-romanian-deadlift'],
 ['Hip thrust','barbell-hip-thrust'],
 ['Glute bridge','glute-bridge'],
 ['Lunge','dumbbell-forward-lunge'],
 ['Reverse lunge','dumbbell-reverse-lunge'],
 ['Bulgarian split squat','dumbbell-bulgarian-split-squat'],
 ['Step-up','dumbbell-step-up'],
 ['Lat pulldown','machine-pulldown'],
 ['Cable row','machine-seated-cable-row'],
 ['Dumbbell row','dumbbell-row-unilateral'],
 ['Chest-supported row','dumbbell-laying-incline-row'],
 ['Machine row','machine-plate-loaded-row'],
 ['Machine chest press','machine-chest-press'],
 ['Push-up','push-up'],
 ['Inverted row','inverted-row'],
 ['Biceps curl','barbell-curl'],
 ['Dumbbell curl','dumbbell-curl'],
 ['Hammer curl','dumbbell-hammer-curl'],
 ['Preacher curl','ez-bar-preacher-curl'],
 ['Cable curl','cable-bar-curl'],
 ['Triceps extension','dumbbell-overhead-tricep-extension'],
 ['Triceps pushdown','cable-rope-pushdown'],
 ['Overhead triceps extension','dumbbell-overhead-tricep-extension'],
 ['Skull crusher','barbell-skullcrusher'],
 ['Leg curl','machine-hamstring-curl'],
 ['Seated leg curl','machine-seated-leg-curl'],
 ['Leg extension','machine-leg-extension'],
 ['Standing calf raise','machine-standing-calf-raises'],
 ['Calf raise','calf-raises'],
 ['Seated calf raise','machine-seated-calf-raises'],
 ['Hip abduction','machine-hip-abduction'],
 ['Hip adduction','machine-hip-adduction'],
 ['Lateral raise','dumbbell-lateral-raise'],
 ['Cable lateral raise','cable-low-single-arm-lateral-raise'],
 ['Rear-delt fly','dumbbell-rear-delt-fly'],
 ['Reverse pec deck','machine-reverse-fly'],
 ['Cable fly','cable-pec-fly'],
 ['Pec deck','machine-pec-fly'],
 ['Dumbbell fly','dumbbell-chest-fly'],
 ['Shrug','dumbbell-shrug'],
 ['Cable crunch','cable-rope-kneeling-crunch'],
 ['Crunch','crunches'],
 ['Hanging knee raise','hanging-knee-raises'],
 ['Dead bug','dead-bug'],
 ['Bird dog','bird-dog'],
 ['Pallof press','cable-pallof-press'],
 ['Assisted neutral-grip chin-up','machine-assisted-neutral-chin-up'],
 ['Seated dip machine','machine-dips'],
 ['Reverse curl','barbell-reverse-curl'],
 ['Wrist curl','dumbbell-wrist-curl'],
];

const otherGuides:[string,string,string][]=[
 ['Trap-bar deadlift','Simply Fitness','https://www.simplyfitness.com/pages/trap-bar-deadlift'],
 ['Reverse wrist curl','Simply Fitness','https://www.simplyfitness.com/pages/seated-barbell-wrist-extension'],
 ['Dip','Muscle & Strength','https://www.muscleandstrength.com/exercises/tricep-dip.html'],
 ['Assisted dip','Macros Inc','https://macrosinc.net/exercises/arms/assisted-machine-dip/'],
 ['Machine shoulder press','Muscle & Strength','https://www.muscleandstrength.com/exercises/machine-shoulder-press'],
 ['Face pull','Muscle & Strength','https://www.muscleandstrength.com/exercises/cable-face-pull'],
 ['Neutral-grip chin-up','StrengthLog','https://www.strengthlog.com/pull-ups-with-a-neutral-grip/'],
 ['Reverse crunch','Weight Training Guide','https://weighttraining.guide/exercises/reverse-crunch/'],
];
const guides=new Map<string,ExerciseGuide>(muscleWikiGuides.map(([name,slug])=>[resolveExerciseName(name),{
 url:`https://musclewiki.com/exercise/${slug}`,provider:'MuscleWiki',label:`${name} demonstration and technique on MuscleWiki`,
}]));
for(const [name,provider,url] of otherGuides)guides.set(resolveExerciseName(name),{
 url,provider,label:`${name} demonstration and technique on ${provider}`,
});

/** Static outbound links only; opening the workout never contacts the provider. */
export function exerciseGuide(name:string):ExerciseGuide|null{
 const clean=name.normalize('NFKC').replace(/\s+/g,' ').trim();
 if(!clean)return null;
 return guides.get(resolveExerciseName(clean))||{
  url:`https://www.google.com/search?q=${encodeURIComponent(`${clean} exercise technique video`)}`,
  provider:'Web search',label:`Find a demonstration and technique guide for ${clean}`,isSearch:true,
 };
}
