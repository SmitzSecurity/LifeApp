import { exerciseNameKey, resolveExerciseName } from './exercise-names.ts';

export type RasterExerciseArt = { source: string; offsets: { dx: number; dy: number }[] };
export type ExerciseArtSelection = { names: string[]; slug: string; frame: 1 | 2 | 3; motionId?: string; raster?: RasterExerciseArt };
export type ExerciseSymbolAsset = { src: string; frames: string[]; slug: string; frame: 1 | 2 | 3; presentation: 'image' | 'mask' };

// Artwork selection never changes targets, muscle assignments or saved plans.
const selections: [string[], string, (1 | 2 | 3)?][] = [
  [['Squat', 'Barbell squat'], 'squat', 3],
  [['Front squat'], 'front-squat'],
  [['Deadlift', 'Barbell deadlift'], 'deadlift'],
  [['Trap-bar deadlift'], 'trap-bar-deadlift'],
  [['Bench press', 'Barbell bench press', 'Bench presses'], 'bench-press'],
  [['Incline bench press'], 'incline-bench-press'],
  [['Dumbbell bench press'], 'dumbbell-bench-press'],
  [['Incline dumbbell press'], 'incline-dumbbell-press'],
  [['Overhead press', 'Barbell overhead press'], 'overhead-press'],
  [['Seated dumbbell press', 'Dumbbell seated shoulder press'], 'seated-dumbbell-press'],
  [['Dip'], 'dip'],
  [['Pull-up', 'Pull ups'], 'pull-up'],
  [['Chin-up', 'Chin ups'], 'chin-up'],
  [['Assisted pull-up'], 'assisted-pull-up'],
  [['Pendlay row'], 'pendlay-row'],
  [['Leg press'], 'leg-press'],
  [['Hack squat'], 'hack-squat'],
  [['Goblet squat'], 'goblet-squat'],
  [['Romanian deadlift', 'Barbell Romanian deadlift'], 'romanian-deadlift', 3],
  [['Dumbbell Romanian deadlift'], 'dumbbell-romanian-deadlift'],
  [['Hip thrust'], 'hip-thrust'],
  [['Glute bridge'], 'glute-bridge'],
  [['Lunge', 'Forward lunge'], 'forward-lunge'],
  [['Reverse lunge'], 'reverse-lunge'],
  [['Bulgarian split squat'], 'bulgarian-split-squat'],
  [['Step-up'], 'step-up'],
  [['Lat pulldown', 'Wide-grip lat pulldown'], 'wide-grip-lat-pulldown'],
  [['Cable row', 'Seated cable row'], 'seated-row'],
  [['Dumbbell row', 'One-arm dumbbell row'], 'one-arm-dumbbell-row'],
  [['Chest-supported row'], 'chest-supported-row'],
  [['Machine row'], 'machine-row'],
  [['Machine chest press'], 'machine-chest-press'],
  [['Machine shoulder press'], 'machine-shoulder-press'],
  [['Push-up', 'Push ups'], 'push-up'],
  [['Inverted row'], 'inverted-row'],
  [['Biceps curl', 'Barbell curl'], 'ez-bar-curl'],
  [['Dumbbell curl'], 'bicep-curl'],
  [['Hammer curl'], 'hammer-curl'],
  [['Preacher curl'], 'preacher-curl'],
  [['Cable curl'], 'cable-curl'],
  [['Triceps extension', 'Overhead triceps extension', 'Dumbbell overhead tricep extension'], 'dumbbell-overhead-tricep-extension'],
  [['Triceps pushdown', 'Tricep pushdown'], 'tricep-pushdown'],
  [['Skull crusher'], 'skull-crusher'],
  [['Leg curl'], 'leg-curl'],
  [['Seated leg curl'], 'seated-leg-curl'],
  [['Leg extension'], 'leg-extension'],
  [['Standing calf raise'], 'standing-calf-raise'],
  [['Calf raise', 'Bodyweight calf raise'], 'calf-raise'],
  [['Seated calf raise'], 'seated-calf-raise'],
  [['Hip abduction', 'Hip abduction machine'], 'hip-abduction-machine'],
  [['Hip adduction', 'Hip adduction machine'], 'hip-adduction-machine'],
  [['Lateral raise', 'Dumbbell lateral raise'], 'lateral-raise'],
  [['Cable lateral raise'], 'cable-lateral-raise'],
  [['Rear-delt fly'], 'rear-delt-fly'],
  [['Reverse pec deck'], 'reverse-pec-deck'],
  [['Cable fly'], 'cable-fly'],
  [['Pec deck'], 'pec-deck'],
  [['Dumbbell fly'], 'dumbbell-fly'],
  [['Shrug', 'Dumbbell shrug'], 'dumbbell-shrug'],
  [['Crunch'], 'crunch'],
  [['Reverse crunch'], 'reverse-crunch'],
  [['Hanging knee raise'], 'hanging-knee-raise'],
  [['Dead bug'], 'dead-bug'],
  [['Bird dog'], 'bird-dog'],
  [['Pallof press'], 'pallof-press'],
  [['Neutral-grip lat pulldown'], 'close-grip-lat-pulldown'],
  [['Seated dip machine'], 'assisted-dip'],
  [['Reverse curl'], 'reverse-curl'],
  [['Reverse wrist curl'], 'wrist-extension'],
];

// Original start/end drawings are enabled only after checking the apparatus
// and both poses. They share one viewBox to prevent animation scale jitter.
const motionPairs: Record<string, string> = {
  'bench-press':'0042','romanian-deadlift':'0118','squat':'0122',
  'forward-lunge':'0115','hip-abduction-machine':'0156','hip-adduction-machine':'0157',
  'ez-bar-curl':'0211','preacher-curl':'0239','reverse-curl':'0257','rear-delt-fly':'0032',
  'dumbbell-shrug':'0005','lateral-raise':'0018','seated-row':'0025','incline-bench-press':'0043',
  'cable-fly':'0048','dumbbell-bench-press':'0055','dumbbell-fly':'0056','incline-dumbbell-press':'0061',
  'machine-chest-press':'0066','push-up':'0077','inverted-row':'0086','pull-up':'0087',
  'close-grip-lat-pulldown':'0096','deadlift':'0099','glute-bridge':'0109','leg-curl':'0117',
  'seated-leg-curl':'0119','hack-squat':'0123','leg-press':'0127','reverse-lunge':'0129',
  'front-squat':'0138','leg-extension':'0142','assisted-dip':'0171','dip':'0172',
  'skull-crusher':'0183','dumbbell-overhead-tricep-extension':'0194','tricep-pushdown':'0205',
  'cable-curl':'0212','bicep-curl':'0224','hammer-curl':'0227','seated-calf-raise':'0279',
  'standing-calf-raise':'0282','reverse-crunch':'0287','crunch':'0291',
};
// Translation-only registration of original artwork keeps stationary apparatus
// stable. The machine press remains static because its redraw changes scale.
const rasterPairs: Record<string, RasterExerciseArt> = {
  'pec-deck':{source:'butterfly-machine',offsets:[{dx:0,dy:0},{dx:71,dy:31}]},
  'seated-dumbbell-press':{source:'dumbbell-shoulder-press',offsets:[{dx:0,dy:0},{dx:22,dy:-75}]},
  'chin-up':{source:'chin-ups',offsets:[{dx:0,dy:0},{dx:0,dy:-96}]},
  'wide-grip-lat-pulldown':{source:'wide-grip-lat-pull-down',offsets:[{dx:0,dy:0},{dx:-22,dy:0}]},
  'machine-shoulder-press':{source:'seated-shoulder-press-machine',offsets:[{dx:0,dy:0}]},
};
export const exerciseArtCatalog: ExerciseArtSelection[] = selections.map(([names, slug, frame = 1]) => ({ names, slug, frame, ...(motionPairs[slug] ? {motionId:motionPairs[slug]} : {}), ...(rasterPairs[slug]?{raster:rasterPairs[slug]}:{}) }));
const assets = new Map<string, ExerciseSymbolAsset>();
for (const { names, slug, frame, motionId, raster } of exerciseArtCatalog) {
  const frames = raster ? raster.offsets.map((_,index)=>`/exercise-art/everkinetic-${raster.source}-${index+1}.png`) : motionId ? ['relaxation','tension'].map(phase=>`/exercise-art/everkinetic-${motionId}-${phase}.svg`) : [`/exercise-art/${slug}-${frame}.svg`];
  const asset: ExerciseSymbolAsset = { src:frames[0], frames, slug, frame, presentation:motionId||raster?'image':'mask' };
  for (const name of names) assets.set(resolveExerciseName(name), asset);
}

/** Unknown/custom variants deliberately receive a neutral fallback. */
export function exerciseSymbol(name: string): ExerciseSymbolAsset | null {
  return assets.get(resolveExerciseName(name)) ?? assets.get(exerciseNameKey(name)) ?? null;
}
