import {z} from 'zod/v3';
export const muscleIds=['chest','lats','upper-back','shoulders','biceps','triceps','forearms','abs','lower-back','glutes','quads','hamstrings','calves','adductors'] as const;
export type MuscleId=typeof muscleIds[number];
export const muscleNames:Record<MuscleId,string>={chest:'Chest',lats:'Lats','upper-back':'Upper back',shoulders:'Shoulders',biceps:'Biceps',triceps:'Triceps',forearms:'Forearms',abs:'Abs / core','lower-back':'Lower back',glutes:'Glutes',quads:'Quads',hamstrings:'Hamstrings',calves:'Calves',adductors:'Inner thighs'};
export const muscleTargetsSchema=z.object({direct:z.array(z.enum(muscleIds)).max(14),indirect:z.array(z.enum(muscleIds)).max(14)}).strict().refine(t=>new Set([...t.direct,...t.indirect]).size===t.direct.length+t.indirect.length,'A muscle can have only one role per exercise.');
export type MuscleTargets=z.infer<typeof muscleTargetsSchema>;
export const VOLUME_REFERENCE=10;
export const volumeSources=[
 {title:'ACSM 2026 guidance',url:'https://acsm.org/resistance-training-guidelines-update-2026/'},
 {title:'Direct and indirect set counting — Pelland et al.',url:'https://pubmed.ncbi.nlm.nih.gov/41343037/'},
];
