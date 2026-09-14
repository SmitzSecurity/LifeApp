// Match known exercise names, not substrings or arbitrary stripped qualifiers.
// Preserve grip/equipment distinctions while tolerating typographic punctuation.
export function exerciseNameKey(name:string){return name.normalize('NFKC').toLowerCase().replace(/[\u2010-\u2015\u2212-]/g,' ').replace(/[()/]/g,' ').replace(/\s+/g,' ').trim();}
const variants:[string,string[]][]=[
 ['Incline dumbbell press',['Incline dumbbell presses','Incline DB press','Incline DB presses','Incline dumbbell bench press']],
 ['Lat pulldown',['Lat pull down','Lat pulldowns','Lat pull downs','Seated lat pulldown']],
 ['Medium-grip lat pulldown',['Lat pulldown (Mag/Medium Grip)','Lat pulldown (medium grip)','Mag grip lat pulldown','Medium grip pulldown']],
 ['Neutral-grip lat pulldown',['Neutral grip pulldown','Lat pulldown (neutral grip)','Medium/Neutral-Grip Lat Pulldown']],
 ['Leg press',['Leg presses','Leg press (machine)','Machine leg press']],
 ['Cable lateral raise',['Cable lateral raises','Single-arm cable lateral raise','Single arm cable lateral raises']],
 ['Lateral raise',['Lateral raises','Dumbbell lateral raises']],
 ['Standing calf raise',['Standing calf raises','Standing calf raise (machine)']],
 ['Calf raise',['Calf raises']],
 ['Seated calf raise',['Seated calf raises','Seated calf raise (machine)']],
 ['Cable crunch',['Cable crunches','Kneeling cable crunch','Kneeling cable crunches','Cable rope crunches']],
 ['Romanian deadlift',['Romanian deadlifts','RDL','RDLs']],
 ['Dumbbell Romanian deadlift',['Dumbbell Romanian deadlifts','Dumbbell RDL','Dumbbell RDLs']],
 ['Seated leg curl',['Seated leg curls','Seated leg curl (machine)','Machine seated leg curl','Seated machine leg curls']],
 ['Leg curl',['Leg curls']],
 ['Chest-supported high row',['Chest supported high rows','Chest-supported high row (machine)','Machine chest-supported high row']],
 ['Chest-supported row',['Chest supported rows']],
 ['Assisted dip',['Assisted dips','Assisted dip / dip machine','Assisted dip machine','Assisted machine dips']],
 ['Seated dip machine',['Dip machine','Machine dip','Machine dips','Seated machine dip']],
 ['Hammer curl',['Hammer curls','Dumbbell hammer curl','Dumbbell hammer curls']],
 ['Assisted neutral-grip chin-up',['Assisted neutral grip chin ups','Assisted neutral-grip pull-up','Assisted neutral grip pull ups','Neutral grip assisted chin up']],
 ['Neutral-grip chin-up',['Neutral grip chin ups','Neutral-grip pull-up','Neutral grip pull ups']],
 ['Leg extension',['Leg extensions','Leg extensions (machine)','Leg extension (machine)','Machine leg extension','Machine leg extensions']],
 ['Dumbbell curl',['Dumbbell curls','Dumbbell bicep curl','Dumbbell bicep curls','Dumbbell biceps curl','Dumbbell biceps curls']],
 ['Biceps curl',['Bicep curl','Bicep curls','Biceps curls']],
 ['Reverse curl',['Reverse curls','Reverse biceps curl','Reverse biceps curls']],
 ['Wrist curl',['Wrist curls','Dumbbell wrist curl','Dumbbell wrist curls']],
 ['Reverse wrist curl',['Reverse wrist curls','Wrist extension','Wrist extensions']],
];
export const exerciseAliases=new Map(variants.flatMap(([canonical,names])=>names.map(name=>[exerciseNameKey(name),exerciseNameKey(canonical)] as const)));
export function resolveExerciseName(name:string){const key=exerciseNameKey(name);return exerciseAliases.get(key)||key;}
