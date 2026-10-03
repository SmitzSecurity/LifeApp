import {resolveExerciseName} from './exercise-names.ts';
import type {MuscleTargets} from './muscle-groups.ts';

// Reviewed October 3, 2026. Full reasoning, original/default comparisons and
// evidence limits live in docs/preset-muscle-audit.json. These are editable
// movement-based defaults, not individualized or measured stimulus.
export const presetMuscleAuditDate='2026-10-03';
type Source={title:string;url:string};
type Review=MuscleTargets & {name:string;note:string;sourceIds:string[]};
const sources:Record<string,Source>={
 "lower-anatomy-openstax": {
  "title": "Appendicular Muscles of the Pelvic Girdle and Lower Limbs — Anatomy and Physiology 2e",
  "url": "https://openstax.org/books/anatomy-and-physiology-2e/pages/11-6-appendicular-muscles-of-the-pelvic-girdle-and-lower-limbs"
 },
 "lower-squat-depth-kubo-2019": {
  "title": "Effects of squat training with different depths on lower limb muscle volumes",
  "url": "https://link.springer.com/article/10.1007/s00421-019-04181-y"
 },
 "lower-front-squat-ace": {
  "title": "Front Squat — ACE Exercise Library",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/22/front-squat/"
 },
 "lower-goblet-squat-ace": {
  "title": "Goblet Squat — ACE Exercise Library",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/362/goblet-squat/"
 },
 "lower-deadlift-nasm": {
  "title": "Barbell Deadlift — NASM Exercise Library",
  "url": "https://www.nasm.org/resource-center/exercise-library/barbell-deadlift"
 },
 "lower-hex-swinton-2011": {
  "title": "A biomechanical analysis of straight and hexagonal barbell deadlifts using submaximal loads",
  "url": "https://rke.abertay.ac.uk/en/publications/a-biomechanical-analysis-of-straight-and-hexagonal-barbell-deadli/"
 },
 "lower-deadlift-rdl-lee-2018": {
  "title": "An electromyographic and kinetic comparison of conventional and Romanian deadlifts",
  "url": "https://pubmed.ncbi.nlm.nih.gov/30662500/"
 },
 "lower-legpress-ke-kinoshita-2026": {
  "title": "Hypertrophic Effects of Single- versus Multi-Joint Exercise: A Direct Comparison between Knee Extension and Leg Press",
  "url": "https://pubmed.ncbi.nlm.nih.gov/41630124/"
 },
 "lower-legpress-nasm": {
  "title": "Leg Press — NASM Exercise Library",
  "url": "https://www.nasm.org/resource-center/exercise-library/leg-press"
 },
 "lower-hack-hammer": {
  "title": "Plate Loaded Hack Squat — Hammer Strength",
  "url": "https://www.lifefitness.com/en-us/catalog/strength-training/plate-loaded/hack-squat"
 },
 "lower-rdl-nasm": {
  "title": "Romanian Deadlift Barbell — NASM Exercise Library",
  "url": "https://www.nasm.org/resource-center/exercise-library/romanian-deadlift-barbell"
 },
 "lower-db-rdl-nasm": {
  "title": "Dumbbell Romanian Deadlift — NASM Exercise Library",
  "url": "https://www.nasm.org/resource-center/exercise-library/dumbbell-romanian-deadlift"
 },
 "lower-rdl-coratella-2022": {
  "title": "An Electromyographic Analysis of Romanian, Step-Romanian, and Stiff-Leg Deadlift: Implication for Resistance Training",
  "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC8835508/"
 },
 "lower-adductor-takahashi-2025": {
  "title": "Redefining muscular action: human \"adductor\" magnus is designed to act primarily for hip \"extension\" rather than adduction in living young individuals",
  "url": "https://pubmed.ncbi.nlm.nih.gov/40139264/"
 },
 "lower-hipthrust-plotkin-2023": {
  "title": "Hip thrust and back squat training elicit similar gluteus muscle hypertrophy and transfer similarly to the deadlift",
  "url": "https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2023.1279170/full"
 },
 "lower-bridge-ace": {
  "title": "Glute Bridge Exercise — ACE Exercise Library",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/49/glute-bridge/"
 },
 "lower-lunge-ace": {
  "title": "Forward Lunge — ACE Exercise Library",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/94/forward-lunge/"
 },
 "lower-reverse-lunge-sussex": {
  "title": "Reverse Lunge — University of Sussex Sport",
  "url": "https://www.sussex.ac.uk/sport/documents/8-reverse-lunge.pdf"
 },
 "lower-split-squat-ace": {
  "title": "Bulgarian Split Squat — ACE Exercise Library",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/366/bulgarian-split-squat/"
 },
 "lower-split-squat-schellenberg-2017": {
  "title": "Towards evidence based strength training: a comparison of muscle forces during deadlifts, goodmornings and split squats",
  "url": "https://link.springer.com/article/10.1186/s13102-017-0077-x"
 },
 "lower-stepup-catalyst": {
  "title": "Step-up — Catalyst Athletics Exercise Library",
  "url": "https://www.catalystathletics.com/exercise/560/Step-up/"
 },
 "lower-unilateral-muyor-2020": {
  "title": "Electromyographic activity in the gluteus medius, gluteus maximus, biceps femoris, vastus lateralis, vastus medialis and rectus femoris during the Monopodal Squat, Forward Lunge and Lateral Step-Up exercises",
  "url": "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0230841"
 },
 "lower-curl-nasm": {
  "title": "Lying Leg Curl — NASM Exercise Library",
  "url": "https://www.nasm.org/resource-center/exercise-library/lying-leg-curl"
 },
 "lower-seated-curl-nasm": {
  "title": "Seated Leg Curl — NASM Exercise Library",
  "url": "https://www.nasm.org/resource-center/exercise-library/seated-leg-curl"
 },
 "lower-curl-length-maeo-2021": {
  "title": "Greater Hamstrings Muscle Hypertrophy but Similar Damage Protection after Training at Long versus Short Muscle Lengths",
  "url": "https://pubmed.ncbi.nlm.nih.gov/33009197/"
 },
 "lower-calf-kinoshita-2023": {
  "title": "Triceps surae muscle hypertrophy is greater after standing versus seated calf-raise training",
  "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC10753835/"
 },
 "lower-abduction-ace": {
  "title": "Side Lying Hip Abduction — ACE Exercise Library",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/38/side-lying-hip-abduction/"
 },
 "lower-adduction-ace": {
  "title": "Standing Hip Adduction — ACE Exercise Library",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/104/standing-hip-adduction/"
 },
 "lower-curl-marchetti-2019": {
  "title": "Different Knee and Ankle Positions Affect Force and Muscle Activation During Prone Leg Curl in Trained Subjects",
  "url": "https://www.researchgate.net/profile/Paulo-Marchetti/publication/335511081_Different_Knee_and_Ankle_Positions_Affect_Force_and_Muscle_Activation_During_Prone_Leg_Curl_in_Trained_Subjects/links/5d70026ba6fdcc9961af870e/Different-Knee-and-Ankle-Positions-Affect-Force-and-Muscle-Activation-During-Prone-Leg-Curl-in-Trained-Subjects.pdf"
 },
 "pull-lehman-2004": {
  "title": "Lehman et al. (2004): Variations in muscle activation levels during traditional latissimus dorsi weight training exercises",
  "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC449729/"
 },
 "pull-ace-back-2018": {
  "title": "ACE-sponsored research: What Is the Best Back Exercise?",
  "url": "https://www.acefitness.org/continuing-education/certified/april-2018/6959/ace-sponsored-research-what-is-the-best-back-exercise/"
 },
 "pull-ace-shoulder-2014": {
  "title": "Sweeney et al. / ACE: Dynamite Delts—ACE Research Identifies Top Shoulder Exercises",
  "url": "https://www.acefitness.org/continuing-education/prosource/september-2014/4972/dynamite-delts-ace-research-identifies-top-shoulder-exercises/"
 },
 "pull-marcolin-2018": {
  "title": "Marcolin et al. (2018): Differences in electromyographic activity of biceps brachii and brachioradialis while performing three variants of curl",
  "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC6047503/"
 },
 "pull-kleiber-2015": {
  "title": "Kleiber et al. (2015): Muscular coordination of biceps brachii and brachioradialis in elbow flexion with respect to hand position",
  "url": "https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2015.00215/full"
 },
 "pull-hamill-upper-limb": {
  "title": "Hamill and Knutzen: Biomechanical Basis of Human Movement, Chapter 5—Functional Anatomy of the Upper Extremity (publisher sample)",
  "url": "https://downloads.lww.com/wolterskluwer_vitalstream_com/sample-content/9780781791281_Hamill/samples/Hamill_ch05_137-186.pdf"
 },
 "pull-exrx-barbell-curl": {
  "title": "ExRx: Barbell Curl",
  "url": "https://exrx.net/WeightExercises/Biceps/BBCurl"
 },
 "pull-exrx-cable-curl": {
  "title": "ExRx: Cable Curl",
  "url": "https://exrx.net/WeightExercises/Biceps/CBCurl"
 },
 "pull-nasm-barbell-curl": {
  "title": "NASM Exercise Library: Barbell Bicep Curl",
  "url": "https://www.nasm.org/resource-center/exercise-library/barbell-bicep-curl"
 },
 "pull-ace-hammer-curl": {
  "title": "ACE Exercise Library: Hammer Curl",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/10/hammer-curl/"
 },
 "pull-ace-reverse-curl": {
  "title": "ACE Exercise Library: Reverse Bicep Curl",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/310/reverse-bicep-curl/"
 },
 "pull-ace-wrist-flexion": {
  "title": "ACE Exercise Library: Wrist Curl—Flexion",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/30/wrist-curl-flexion/"
 },
 "pull-ace-wrist-extension": {
  "title": "ACE Exercise Library: Wrist Curl—Extension",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/29/wrist-curl-extension/"
 },
 "pull-nasm-face-pull": {
  "title": "NASM Exercise Library: Face Pull",
  "url": "https://www.nasm.org/resource-center/exercise-library/face-pull"
 },
 "pull-nasm-machine-row": {
  "title": "NASM Exercise Library: Seated Machine Row—Close Grip",
  "url": "https://www.nasm.org/resource-center/exercise-library/seated-machine-row-close-grip"
 },
 "pull-nasm-lat-pulldown": {
  "title": "NASM: The Biomechanics of the Lat Pulldown—Muscles, Grip and Form",
  "url": "https://www.nasm.org/resource-center/blog/training/the-biomechanics-of-the-lat-pulldown-muscles-grip-and-form"
 },
 "pull-ace-chin-up": {
  "title": "ACE Exercise Library: Chin-ups",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/190/chin-ups/"
 },
 "pull-ace-bent-row": {
  "title": "ACE Exercise Library: Bent-over Row",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/12/bent-over-row/"
 },
 "pull-life-optima-manual": {
  "title": "Life Fitness Optima Series Strength Owner’s Manual (2010)",
  "url": "https://www.lifefitness.com.au/wp-content/uploads/2015/02/Optima_user_manual_for_all_strength_2_585_1371787541.pdf"
 },
 "pull-life-spl-high-row": {
  "title": "Life Fitness Plate Loaded High Row (SPLHR)",
  "url": "https://www.lifefitness.com/en-us/catalog/strength-training/plate-loaded/life-fitness-high-row"
 },
 "pull-life-il-high-row": {
  "title": "Hammer Strength Plate Loaded Iso-lateral High Row (IL-HR)",
  "url": "https://www.lifefitness.com.au/commercial/iso-lateral-high-row-ilhr"
 },
 "pull-life-preacher-curl": {
  "title": "Life Fitness Plate Loaded Biceps Curl (SPLBC)",
  "url": "https://www.lifefitness.com/en-eu/catalog/strength-training/plate-loaded/life-fitness-biceps-curl"
 },
 "pull-exrx-shrug": {
  "title": "ExRx: Barbell Shrug",
  "url": "https://exrx.net/WeightExercises/TrapeziusUpper/BBShrug"
 },
 "push-openstax-upper": {
  "title": "OpenStax Anatomy and Physiology 2e: Muscles of the Pectoral Girdle and Upper Limbs",
  "url": "https://openstax.org/books/anatomy-and-physiology-2e/pages/11-5-muscles-of-the-pectoral-girdle-and-upper-limbs"
 },
 "push-ace-bench": {
  "title": "ACE Exercise Library: Chest Press (barbell)",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/5/chest-press/"
 },
 "push-ace-db-bench": {
  "title": "ACE Exercise Library: Chest Press (dumbbells)",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/19/chest-press/"
 },
 "push-ace-incline": {
  "title": "ACE Exercise Library: Incline Chest Press",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/25/incline-chest-press/"
 },
 "push-solstad-fly-2020": {
  "title": "Solstad et al. (2020): A Comparison of Muscle Activation between Barbell Bench Press and Dumbbell Flyes in Resistance-Trained Males",
  "url": "https://www.jssm.org/volume19/iss4/cap/jssm-19-645.pdf"
 },
 "push-ace-machine-chest": {
  "title": "ACE Exercise Library: Seated Chest Press",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/188/seated-chest-press/"
 },
 "push-ace-push-up": {
  "title": "ACE Exercise Library: Push-up",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/41/push-up/"
 },
 "push-coratella-ohp-2022": {
  "title": "Coratella et al. (2022): Front vs Back and Barbell vs Machine Overhead Press: An Electromyographic Analysis and Implications For Resistance Training",
  "url": "https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2022.825880/full"
 },
 "push-ace-db-ohp": {
  "title": "ACE Exercise Library: Seated Overhead Press",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/45/seated-overhead-press/"
 },
 "push-ace-shoulder-mechanics": {
  "title": "ACE Certified (September 2025): A Pro’s Guide to Muscle Mechanics: The Shoulders",
  "url": "https://www.acefitness.org/continuing-education/certified/september-2025/8951/a-pro-s-guide-to-muscle-mechanics-the-shoulders/"
 },
 "push-mckenzie-dips-2022": {
  "title": "McKenzie et al. (2022): Bench, Bar, and Ring Dips: Do Kinematics and Muscle Activity Differ?",
  "url": "https://researchportal.scu.edu.au/esploro/outputs/journalArticle/Bench-Bar-and-Ring-Dips-Do/991013054212502368"
 },
 "push-lifefitness-seated-dip": {
  "title": "Life Fitness: Hammer Strength Plate-Loaded Seated Dip",
  "url": "https://shop.lifefitness.com/products/hammer-strength-plate-loaded-seated-dip"
 },
 "push-precor-seated-dip": {
  "title": "Precor: RSL0215 Seated Dip",
  "url": "https://www.precor.com/en-GB/products/RSL0215"
 },
 "push-coratella-lateral-2020": {
  "title": "Coratella et al. (2020): An Electromyographic Analysis of Lateral Raise Variations and Frontal Raise in Competitive Bodybuilders",
  "url": "https://www.mdpi.com/1660-4601/17/17/6015"
 },
 "push-ace-lateral": {
  "title": "ACE Exercise Library: Lateral Raise",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/26/lateral-raise/"
 },
 "push-ace-fly": {
  "title": "ACE Exercise Library: Lying Chest Fly",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/21/lying-chest-fly/"
 },
 "push-ace-chest-study-2012": {
  "title": "ACE-sponsored Research (2012): Top 3 Most Effective Chest Exercises",
  "url": "https://www.acefitness.org/certifiednews/images/article/pdfs/ACE_BestChestExercises.pdf"
 },
 "push-ace-triceps-extension": {
  "title": "ACE Exercise Library: Triceps Extension",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/74/triceps-extension/"
 },
 "push-ace-triceps-pressdown": {
  "title": "ACE Exercise Library: Triceps Pressdown",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/3/triceps-pressdown/"
 },
 "push-ace-skull-crusher": {
  "title": "ACE Exercise Library: Lying Barbell Triceps Extensions",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/36/lying-barbell-triceps-extensions/"
 },
 "push-ace-cable-crunch": {
  "title": "ACE Exercise Library: Standing Crunch",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/331/standing-crunch/"
 },
 "push-ace-crunch": {
  "title": "ACE Exercise Library: Crunch",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/52/crunch/"
 },
 "push-ace-reverse-crunch": {
  "title": "ACE Exercise Library: Reverse Crunch",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/76/reverse-crunch/"
 },
 "push-ace-ab-study-2001": {
  "title": "ACE-sponsored Research (2001): New Study Puts the Crunch on Ineffective Ab Exercises",
  "url": "https://www.acefitness.org/getfit/studies/BestWorstAbExercises.pdf"
 },
 "push-ace-dead-bug": {
  "title": "ACE Exercise Library: Supine Dead Bug",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/147/supine-dead-bug/"
 },
 "push-ace-bird-dog": {
  "title": "ACE Exercise Library: Bird-dog",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/14/bird-dog/"
 },
 "push-stevens-quadruped-2007": {
  "title": "Stevens et al. (2007): Electromyographic activity of trunk and hip muscles during stabilization exercises in four-point kneeling in healthy volunteers",
  "url": "https://link.springer.com/article/10.1007/s00586-006-0181-1"
 },
 "push-ace-pallof": {
  "title": "ACE Exercise Library: Standing Anti-Rotation Press",
  "url": "https://www.acefitness.org/resources/everyone/exercise-library/332/standing-anti-rotation-press/"
 },
 "push-nasm-core-2026": {
  "title": "NASM: Best Abs Exercises: Science-Based Core Training That Delivers Results",
  "url": "https://www.nasm.org/resource-center/blog/training/best-abs-exercises"
 }
};
const reviews:Review[]=[
 {
  "name": "Squat",
  "direct": [
   "quads",
   "glutes"
  ],
  "indirect": [
   "adductors"
  ],
  "note": "Quads and glutes; inner thighs assist. Depth and stance change emphasis.",
  "sourceIds": [
   "lower-squat-depth-kubo-2019",
   "lower-adductor-takahashi-2025"
  ]
 },
 {
  "name": "Front squat",
  "direct": [
   "quads",
   "glutes"
  ],
  "indirect": [
   "adductors"
  ],
  "note": "Quads and glutes; inner thighs assist. Front loading changes emphasis, not the whole target list.",
  "sourceIds": [
   "lower-front-squat-ace",
   "lower-squat-depth-kubo-2019",
   "lower-adductor-takahashi-2025"
  ]
 },
 {
  "name": "Deadlift",
  "direct": [
   "glutes"
  ],
  "indirect": [
   "quads",
   "hamstrings",
   "lower-back"
  ],
  "note": "Conventional pull: glutes lead; quads, hamstrings and lower back assist. Stance and technique change emphasis.",
  "sourceIds": [
   "lower-deadlift-nasm",
   "lower-deadlift-rdl-lee-2018",
   "lower-adductor-takahashi-2025",
   "lower-rdl-coratella-2022"
  ]
 },
 {
  "name": "Trap-bar deadlift",
  "direct": [
   "quads",
   "glutes"
  ],
  "indirect": [
   "hamstrings",
   "lower-back"
  ],
  "note": "Quads and glutes lead; hamstrings and lower back assist. Handle height and technique matter.",
  "sourceIds": [
   "lower-hex-swinton-2011",
   "lower-deadlift-nasm",
   "lower-adductor-takahashi-2025"
  ]
 },
 {
  "name": "Bench press",
  "direct": [
   "chest"
  ],
  "indirect": [
   "triceps",
   "shoulders"
  ],
  "note": "Flat barbell chest press with a conventional grip.",
  "sourceIds": [
   "push-ace-bench",
   "push-solstad-fly-2020"
  ]
 },
 {
  "name": "Incline bench press",
  "direct": [
   "chest"
  ],
  "indirect": [
   "triceps",
   "shoulders"
  ],
  "note": "Inclined barbell chest press, rather than a near-upright shoulder press.",
  "sourceIds": [
   "push-ace-incline",
   "push-openstax-upper"
  ]
 },
 {
  "name": "Dumbbell bench press",
  "direct": [
   "chest"
  ],
  "indirect": [
   "triceps",
   "shoulders"
  ],
  "note": "Supported flat dumbbell chest press.",
  "sourceIds": [
   "push-ace-db-bench",
   "push-solstad-fly-2020"
  ]
 },
 {
  "name": "Incline dumbbell press",
  "direct": [
   "chest"
  ],
  "indirect": [
   "triceps",
   "shoulders"
  ],
  "note": "Supported incline dumbbell chest press with a chest-focused arm path.",
  "sourceIds": [
   "push-ace-incline",
   "push-openstax-upper"
  ]
 },
 {
  "name": "Overhead press",
  "direct": [
   "shoulders"
  ],
  "indirect": [
   "triceps",
   "upper-back"
  ],
  "note": "Conventional front overhead barbell press with normal scapular movement.",
  "sourceIds": [
   "push-coratella-ohp-2022",
   "push-ace-shoulder-mechanics"
  ]
 },
 {
  "name": "Seated dumbbell press",
  "direct": [
   "shoulders"
  ],
  "indirect": [
   "triceps",
   "upper-back"
  ],
  "note": "Seated upright dumbbell overhead press; no large incline-back lean.",
  "sourceIds": [
   "push-ace-db-ohp",
   "push-coratella-ohp-2022"
  ]
 },
 {
  "name": "Dip",
  "direct": [
   "chest",
   "triceps"
  ],
  "indirect": [
   "shoulders"
  ],
  "note": "Parallel-bar dip with controlled elbow and shoulder motion.",
  "sourceIds": [
   "push-mckenzie-dips-2022"
  ]
 },
 {
  "name": "Assisted dip",
  "direct": [
   "chest",
   "triceps"
  ],
  "indirect": [
   "shoulders"
  ],
  "note": "Assisted parallel-bar dip with the same arm path as a standard dip.",
  "sourceIds": [
   "push-mckenzie-dips-2022"
  ]
 },
 {
  "name": "Pull-up",
  "direct": [
   "lats"
  ],
  "indirect": [
   "biceps",
   "upper-back"
  ],
  "note": "Controlled pronated vertical pull; no kipping.",
  "sourceIds": [
   "pull-ace-back-2018",
   "pull-nasm-lat-pulldown"
  ]
 },
 {
  "name": "Chin-up",
  "direct": [
   "lats"
  ],
  "indirect": [
   "biceps",
   "upper-back"
  ],
  "note": "Controlled supinated vertical pull; no kipping.",
  "sourceIds": [
   "pull-ace-chin-up",
   "pull-ace-back-2018"
  ]
 },
 {
  "name": "Assisted pull-up",
  "direct": [
   "lats"
  ],
  "indirect": [
   "biceps",
   "upper-back"
  ],
  "note": "Assisted pronated vertical pull through the same arm path.",
  "sourceIds": [
   "pull-ace-back-2018",
   "pull-nasm-lat-pulldown"
  ]
 },
 {
  "name": "Barbell row",
  "direct": [
   "upper-back",
   "lats"
  ],
  "indirect": [
   "biceps",
   "shoulders"
  ],
  "note": "Stable hinged torso, moderate elbow path toward lower ribs.",
  "sourceIds": [
   "pull-ace-bent-row",
   "pull-ace-back-2018"
  ]
 },
 {
  "name": "Pendlay row",
  "direct": [
   "upper-back",
   "lats"
  ],
  "indirect": [
   "biceps",
   "shoulders"
  ],
  "note": "Horizontal torso; each repetition starts on the floor; pull toward lower chest.",
  "sourceIds": [
   "pull-ace-back-2018",
   "pull-hamill-upper-limb"
  ]
 },
 {
  "name": "Leg press",
  "direct": [
   "quads",
   "glutes"
  ],
  "indirect": [
   "adductors"
  ],
  "note": "Quads and glutes; inner thighs assist. Foot placement and depth change emphasis.",
  "sourceIds": [
   "lower-legpress-ke-kinoshita-2026",
   "lower-legpress-nasm"
  ]
 },
 {
  "name": "Hack squat",
  "direct": [
   "quads",
   "glutes"
  ],
  "indirect": [
   "adductors"
  ],
  "note": "Quads and glutes; inner thighs assist. Supported machines often bias quads; depth and foot placement matter.",
  "sourceIds": [
   "lower-hack-hammer",
   "lower-squat-depth-kubo-2019",
   "lower-adductor-takahashi-2025"
  ]
 },
 {
  "name": "Goblet squat",
  "direct": [
   "quads",
   "glutes"
  ],
  "indirect": [
   "adductors"
  ],
  "note": "Quads and glutes; inner thighs assist. Depth matters.",
  "sourceIds": [
   "lower-goblet-squat-ace",
   "lower-squat-depth-kubo-2019"
  ]
 },
 {
  "name": "Romanian deadlift",
  "direct": [
   "hamstrings",
   "glutes"
  ],
  "indirect": [
   "lower-back"
  ],
  "note": "Hamstrings and glutes lead; lower back assists. Keep knees nearly fixed; stance changes assistance.",
  "sourceIds": [
   "lower-rdl-nasm",
   "lower-rdl-coratella-2022",
   "lower-adductor-takahashi-2025"
  ]
 },
 {
  "name": "Dumbbell Romanian deadlift",
  "direct": [
   "hamstrings",
   "glutes"
  ],
  "indirect": [
   "lower-back"
  ],
  "note": "Hamstrings and glutes lead; lower back assists. Grip, stance and range vary.",
  "sourceIds": [
   "lower-db-rdl-nasm",
   "lower-rdl-coratella-2022",
   "lower-adductor-takahashi-2025"
  ]
 },
 {
  "name": "Hip thrust",
  "direct": [
   "glutes"
  ],
  "indirect": [],
  "note": "Glutes target; foot position can change hamstring assistance.",
  "sourceIds": [
   "lower-hipthrust-plotkin-2023"
  ]
 },
 {
  "name": "Glute bridge",
  "direct": [
   "glutes"
  ],
  "indirect": [],
  "note": "Bent-knee bridge targets glutes. Long-lever versions change hamstring involvement.",
  "sourceIds": [
   "lower-bridge-ace",
   "lower-hipthrust-plotkin-2023"
  ]
 },
 {
  "name": "Lunge",
  "direct": [
   "quads",
   "glutes"
  ],
  "indirect": [
   "adductors"
  ],
  "note": "Quads and glutes; inner thighs assist. Stride and torso angle change emphasis.",
  "sourceIds": [
   "lower-lunge-ace",
   "lower-unilateral-muyor-2020",
   "lower-adductor-takahashi-2025"
  ]
 },
 {
  "name": "Reverse lunge",
  "direct": [
   "quads",
   "glutes"
  ],
  "indirect": [
   "adductors"
  ],
  "note": "Quads and glutes; inner thighs assist. Lead-leg technique changes emphasis.",
  "sourceIds": [
   "lower-reverse-lunge-sussex",
   "lower-adductor-takahashi-2025"
  ]
 },
 {
  "name": "Bulgarian split squat",
  "direct": [
   "quads",
   "glutes"
  ],
  "indirect": [
   "adductors"
  ],
  "note": "Quads and glutes; inner thighs assist. Stance length and torso angle matter.",
  "sourceIds": [
   "lower-split-squat-ace",
   "lower-split-squat-schellenberg-2017",
   "lower-adductor-takahashi-2025"
  ]
 },
 {
  "name": "Step-up",
  "direct": [
   "quads",
   "glutes"
  ],
  "indirect": [
   "adductors"
  ],
  "note": "Quads and glutes; inner thighs assist. Box height, shin angle and trailing-leg push matter.",
  "sourceIds": [
   "lower-stepup-catalyst",
   "lower-unilateral-muyor-2020",
   "lower-adductor-takahashi-2025"
  ]
 },
 {
  "name": "Lat pulldown",
  "direct": [
   "lats"
  ],
  "indirect": [
   "biceps",
   "upper-back"
  ],
  "note": "Pronated front pulldown; stable torso with small lean.",
  "sourceIds": [
   "pull-nasm-lat-pulldown",
   "pull-lehman-2004"
  ]
 },
 {
  "name": "Cable row",
  "direct": [
   "upper-back",
   "lats"
  ],
  "indirect": [
   "biceps",
   "shoulders"
  ],
  "note": "Seated cable row to torso with moderate/tucked elbows and natural scapular movement.",
  "sourceIds": [
   "pull-lehman-2004",
   "pull-life-optima-manual"
  ]
 },
 {
  "name": "Dumbbell row",
  "direct": [
   "upper-back",
   "lats"
  ],
  "indirect": [
   "biceps",
   "shoulders"
  ],
  "note": "Supported torso; elbow travels toward hip/lower ribs without twisting.",
  "sourceIds": [
   "pull-ace-bent-row",
   "pull-nasm-machine-row"
  ]
 },
 {
  "name": "Chest-supported row",
  "direct": [
   "upper-back",
   "lats"
  ],
  "indirect": [
   "biceps",
   "shoulders"
  ],
  "note": "Chest remains on pad; moderate/tucked elbows, not a deliberately flared high row.",
  "sourceIds": [
   "pull-nasm-machine-row",
   "pull-life-optima-manual"
  ]
 },
 {
  "name": "Machine row",
  "direct": [
   "upper-back",
   "lats"
  ],
  "indirect": [
   "biceps",
   "shoulders"
  ],
  "note": "Conventional seated horizontal row to torso with moderate/tucked elbows.",
  "sourceIds": [
   "pull-nasm-machine-row",
   "pull-life-optima-manual"
  ]
 },
 {
  "name": "Machine chest press",
  "direct": [
   "chest"
  ],
  "indirect": [
   "triceps",
   "shoulders"
  ],
  "note": "Supported horizontal chest-press machine with mid-chest handles.",
  "sourceIds": [
   "push-ace-machine-chest",
   "push-ace-chest-study-2012",
   "push-openstax-upper"
  ]
 },
 {
  "name": "Machine shoulder press",
  "direct": [
   "shoulders"
  ],
  "indirect": [
   "triceps",
   "upper-back"
  ],
  "note": "Upright overhead shoulder-press machine with normal scapular movement.",
  "sourceIds": [
   "push-coratella-ohp-2022"
  ]
 },
 {
  "name": "Push-up",
  "direct": [
   "chest"
  ],
  "indirect": [
   "triceps",
   "shoulders"
  ],
  "note": "Standard horizontal push-up; no special narrow-grip or push-up-plus emphasis.",
  "sourceIds": [
   "push-ace-push-up",
   "push-ace-chest-study-2012"
  ]
 },
 {
  "name": "Inverted row",
  "direct": [
   "upper-back",
   "lats"
  ],
  "indirect": [
   "biceps",
   "shoulders"
  ],
  "note": "Controlled bodyweight row toward chest; rigid torso, moderate elbows.",
  "sourceIds": [
   "pull-ace-back-2018",
   "pull-hamill-upper-limb"
  ]
 },
 {
  "name": "Biceps curl",
  "direct": [
   "biceps"
  ],
  "indirect": [
   "forearms"
  ],
  "note": "Strict supinated barbell curl with upper arms stationary. Brachialis also contributes but has no separate app group.",
  "sourceIds": [
   "pull-exrx-barbell-curl",
   "pull-nasm-barbell-curl"
  ]
 },
 {
  "name": "Dumbbell curl",
  "direct": [
   "biceps"
  ],
  "indirect": [
   "forearms"
  ],
  "note": "Strict supinated or supinating dumbbell curl; no shoulder swing. Brachialis also contributes but has no separate app group.",
  "sourceIds": [
   "pull-marcolin-2018",
   "pull-hamill-upper-limb"
  ]
 },
 {
  "name": "Hammer curl",
  "direct": [
   "biceps"
  ],
  "indirect": [
   "forearms"
  ],
  "note": "Neutral palms and stationary upper arms. Brachioradialis (Forearms) assists elbow flexion; brachialis also contributes but has no separate app group. Grip alone does not establish a precise stimulus split.",
  "sourceIds": [
   "pull-ace-hammer-curl",
   "pull-kleiber-2015",
   "pull-hamill-upper-limb"
  ]
 },
 {
  "name": "Preacher curl",
  "direct": [
   "biceps"
  ],
  "indirect": [
   "forearms"
  ],
  "note": "Supinated curl with upper arms supported on preacher pad. Brachialis also contributes but has no separate app group.",
  "sourceIds": [
   "pull-life-preacher-curl",
   "pull-exrx-barbell-curl",
   "pull-hamill-upper-limb"
  ]
 },
 {
  "name": "Cable curl",
  "direct": [
   "biceps"
  ],
  "indirect": [
   "forearms"
  ],
  "note": "Underhand low-pulley curl; upper arms stationary beside torso. Brachialis also contributes but has no separate app group.",
  "sourceIds": [
   "pull-exrx-cable-curl"
  ]
 },
 {
  "name": "Triceps extension",
  "direct": [
   "triceps"
  ],
  "indirect": [],
  "note": "Strict elbow extension with upper-arm position kept steady.",
  "sourceIds": [
   "push-ace-triceps-extension",
   "push-openstax-upper"
  ]
 },
 {
  "name": "Triceps pushdown",
  "direct": [
   "triceps"
  ],
  "indirect": [],
  "note": "Cable pressdown with elbows near the torso and little shoulder movement.",
  "sourceIds": [
   "push-ace-triceps-pressdown"
  ]
 },
 {
  "name": "Overhead triceps extension",
  "direct": [
   "triceps"
  ],
  "indirect": [],
  "note": "Overhead elbow extension with upper arms held steady.",
  "sourceIds": [
   "push-ace-triceps-extension"
  ]
 },
 {
  "name": "Skull crusher",
  "direct": [
   "triceps"
  ],
  "indirect": [],
  "note": "Lying elbow extension; no pullover or pressing phase.",
  "sourceIds": [
   "push-ace-skull-crusher"
  ]
 },
 {
  "name": "Leg curl",
  "direct": [
   "hamstrings"
  ],
  "indirect": [
   "calves"
  ],
  "note": "Hamstrings target; gastrocnemius assists knee flexion. This does not credit soleus.",
  "sourceIds": [
   "lower-curl-nasm",
   "lower-anatomy-openstax",
   "lower-curl-length-maeo-2021",
   "lower-curl-marchetti-2019"
  ]
 },
 {
  "name": "Seated leg curl",
  "direct": [
   "hamstrings"
  ],
  "indirect": [
   "calves"
  ],
  "note": "Hamstrings target; gastrocnemius assists. Seated position lengthens biarticular hamstrings.",
  "sourceIds": [
   "lower-seated-curl-nasm",
   "lower-curl-length-maeo-2021",
   "lower-anatomy-openstax",
   "lower-curl-marchetti-2019"
  ]
 },
 {
  "name": "Leg extension",
  "direct": [
   "quads"
  ],
  "indirect": [],
  "note": "Quads target. Hip angle and range affect individual quadriceps heads.",
  "sourceIds": [
   "lower-legpress-ke-kinoshita-2026",
   "lower-anatomy-openstax"
  ]
 },
 {
  "name": "Standing calf raise",
  "direct": [
   "calves"
  ],
  "indirect": [],
  "note": "Straight-knee calf raise trains gastrocnemius and soleus.",
  "sourceIds": [
   "lower-calf-kinoshita-2023"
  ]
 },
 {
  "name": "Calf raise",
  "direct": [
   "calves"
  ],
  "indirect": [],
  "note": "Calves target. Straight versus bent knees changes gastrocnemius/soleus emphasis.",
  "sourceIds": [
   "lower-calf-kinoshita-2023",
   "lower-anatomy-openstax"
  ]
 },
 {
  "name": "Seated calf raise",
  "direct": [
   "calves"
  ],
  "indirect": [],
  "note": "Bent-knee calf raise emphasizes soleus; gastrocnemius is shortened.",
  "sourceIds": [
   "lower-calf-kinoshita-2023"
  ]
 },
 {
  "name": "Hip abduction",
  "direct": [
   "glutes"
  ],
  "indirect": [],
  "note": "Glute abductors target. Hip angle changes emphasis; TFL has no separate app group.",
  "sourceIds": [
   "lower-abduction-ace",
   "lower-anatomy-openstax"
  ]
 },
 {
  "name": "Hip adduction",
  "direct": [
   "adductors"
  ],
  "indirect": [],
  "note": "Inner thighs target. Hip angle changes the contribution of individual adductors.",
  "sourceIds": [
   "lower-adduction-ace",
   "lower-anatomy-openstax",
   "lower-adductor-takahashi-2025"
  ]
 },
 {
  "name": "Lateral raise",
  "direct": [
   "shoulders"
  ],
  "indirect": [
   "upper-back"
  ],
  "note": "Neutral-rotation lateral raise to shoulder height with normal scapular motion.",
  "sourceIds": [
   "push-coratella-lateral-2020",
   "push-ace-lateral",
   "push-ace-shoulder-mechanics"
  ]
 },
 {
  "name": "Cable lateral raise",
  "direct": [
   "shoulders"
  ],
  "indirect": [
   "upper-back"
  ],
  "note": "Cable-resisted lateral arm raise; neutral rotation and normal scapular motion.",
  "sourceIds": [
   "push-ace-lateral",
   "push-ace-shoulder-mechanics",
   "push-coratella-lateral-2020"
  ]
 },
 {
  "name": "Rear-delt fly",
  "direct": [
   "shoulders"
  ],
  "indirect": [
   "upper-back"
  ],
  "note": "Near shoulder-height fly with fixed softly bent elbows and natural scapular retraction. Upper-back assistance decreases if shoulder blades are deliberately held still.",
  "sourceIds": [
   "pull-ace-shoulder-2014",
   "pull-life-optima-manual"
  ]
 },
 {
  "name": "Reverse pec deck",
  "direct": [
   "shoulders"
  ],
  "indirect": [
   "upper-back"
  ],
  "note": "Assumes chest support and natural scapular retraction while opening the arms near shoulder height. Deliberately fixed shoulder blades reduce upper-back assistance.",
  "sourceIds": [
   "pull-life-optima-manual"
  ]
 },
 {
  "name": "Face pull",
  "direct": [
   "shoulders",
   "upper-back"
  ],
  "indirect": [
   "biceps"
  ],
  "note": "Eye-height rope pull with elbows bending and travelling outward/back.",
  "sourceIds": [
   "pull-nasm-face-pull"
  ]
 },
 {
  "name": "Cable fly",
  "direct": [
   "chest"
  ],
  "indirect": [
   "shoulders"
  ],
  "note": "Chest-height cable fly with a consistent slight elbow bend.",
  "sourceIds": [
   "push-ace-chest-study-2012",
   "push-openstax-upper",
   "push-solstad-fly-2020"
  ]
 },
 {
  "name": "Pec deck",
  "direct": [
   "chest"
  ],
  "indirect": [
   "shoulders"
  ],
  "note": "Chest fly machine moving upper arms inward with elbows held at a consistent bend.",
  "sourceIds": [
   "push-ace-chest-study-2012",
   "push-openstax-upper"
  ]
 },
 {
  "name": "Dumbbell fly",
  "direct": [
   "chest"
  ],
  "indirect": [
   "shoulders"
  ],
  "note": "Supported lying dumbbell fly with elbow bend maintained.",
  "sourceIds": [
   "push-ace-fly",
   "push-solstad-fly-2020"
  ]
 },
 {
  "name": "Shrug",
  "direct": [
   "upper-back"
  ],
  "indirect": [],
  "note": "Controlled shoulder-blade elevation with straight elbows; no rolling.",
  "sourceIds": [
   "pull-exrx-shrug"
  ]
 },
 {
  "name": "Cable crunch",
  "direct": [
   "abs"
  ],
  "indirect": [],
  "note": "Cable-resisted trunk curl; rib cage moves toward pelvis rather than only hinging hips.",
  "sourceIds": [
   "push-ace-cable-crunch"
  ]
 },
 {
  "name": "Crunch",
  "direct": [
   "abs"
  ],
  "indirect": [],
  "note": "Controlled trunk curl with pelvis supported; not a full sit-up.",
  "sourceIds": [
   "push-ace-crunch"
  ]
 },
 {
  "name": "Reverse crunch",
  "direct": [
   "abs"
  ],
  "indirect": [],
  "note": "Curl pelvis toward ribs and lift hips; do not only swing the thighs.",
  "sourceIds": [
   "push-ace-reverse-crunch",
   "push-ace-ab-study-2001",
   "push-nasm-core-2026"
  ]
 },
 {
  "name": "Hanging knee raise",
  "direct": [
   "abs"
  ],
  "indirect": [],
  "note": "Controlled hanging knee raise with posterior pelvic curl toward the ribs. Hip-only raises chiefly target hip flexors, which have no separate app group.",
  "sourceIds": [
   "push-nasm-core-2026",
   "lower-anatomy-openstax",
   "push-ace-ab-study-2001"
  ]
 },
 {
  "name": "Dead bug",
  "direct": [
   "abs"
  ],
  "indirect": [],
  "note": "Opposite arm/leg movement while deliberately resisting lumbar extension.",
  "sourceIds": [
   "push-ace-dead-bug",
   "push-nasm-core-2026"
  ]
 },
 {
  "name": "Bird dog",
  "direct": [
   "abs",
   "lower-back"
  ],
  "indirect": [
   "glutes"
  ],
  "note": "Quadruped opposite arm/leg extension with deliberate neutral-spine and pelvic control.",
  "sourceIds": [
   "push-ace-bird-dog",
   "push-stevens-quadruped-2007",
   "push-nasm-core-2026"
  ]
 },
 {
  "name": "Pallof press",
  "direct": [
   "abs"
  ],
  "indirect": [],
  "note": "Sideways cable or band resistance; resist trunk rotation as hands extend.",
  "sourceIds": [
   "push-ace-pallof",
   "push-nasm-core-2026"
  ]
 },
 {
  "name": "Medium-grip lat pulldown",
  "direct": [
   "lats"
  ],
  "indirect": [
   "biceps",
   "upper-back"
  ],
  "note": "Front pulldown with pronated grip around shoulder width.",
  "sourceIds": [
   "pull-nasm-lat-pulldown",
   "pull-lehman-2004"
  ]
 },
 {
  "name": "Neutral-grip lat pulldown",
  "direct": [
   "lats"
  ],
  "indirect": [
   "biceps",
   "upper-back"
  ],
  "note": "Front pulldown using parallel handles; elbows travel down toward ribs.",
  "sourceIds": [
   "pull-nasm-lat-pulldown",
   "pull-lehman-2004"
  ]
 },
 {
  "name": "Chest-supported high row",
  "direct": [
   "upper-back",
   "shoulders"
  ],
  "indirect": [
   "biceps"
  ],
  "note": "Assumes a chest-supported horizontal row with elbows out near shoulder height, emphasizing rear deltoids and scapular retractors. High-to-low lat machines use a different arm path; choose explicit muscle assignments for that variation.",
  "sourceIds": [
   "pull-ace-shoulder-2014",
   "pull-life-spl-high-row",
   "pull-life-il-high-row",
   "pull-hamill-upper-limb"
  ]
 },
 {
  "name": "Assisted neutral-grip chin-up",
  "direct": [
   "lats"
  ],
  "indirect": [
   "biceps",
   "upper-back"
  ],
  "note": "Assisted vertical pull on parallel handles; no kipping.",
  "sourceIds": [
   "pull-ace-chin-up",
   "pull-nasm-lat-pulldown"
  ]
 },
 {
  "name": "Neutral-grip chin-up",
  "direct": [
   "lats"
  ],
  "indirect": [
   "biceps",
   "upper-back"
  ],
  "note": "Controlled vertical pull on parallel handles; no kipping.",
  "sourceIds": [
   "pull-ace-chin-up",
   "pull-nasm-lat-pulldown"
  ]
 },
 {
  "name": "Seated dip machine",
  "direct": [
   "triceps"
  ],
  "indirect": [
   "chest",
   "shoulders"
  ],
  "note": "Seated triceps-dominant dip machine with upper-body position held steady.",
  "sourceIds": [
   "push-lifefitness-seated-dip",
   "push-precor-seated-dip"
  ]
 },
 {
  "name": "Reverse curl",
  "direct": [
   "forearms"
  ],
  "indirect": [
   "biceps"
  ],
  "note": "Pronated elbow curl with stationary upper arms and neutral wrists. Brachialis also contributes but has no separate app group.",
  "sourceIds": [
   "pull-ace-reverse-curl",
   "pull-kleiber-2015",
   "pull-hamill-upper-limb"
  ]
 },
 {
  "name": "Wrist curl",
  "direct": [
   "forearms"
  ],
  "indirect": [],
  "note": "Supported, palm-up wrist flexion targets forearm wrist flexors; it does not represent every forearm muscle.",
  "sourceIds": [
   "pull-ace-wrist-flexion"
  ]
 },
 {
  "name": "Reverse wrist curl",
  "direct": [
   "forearms"
  ],
  "indirect": [],
  "note": "Supported, palm-down wrist extension targets forearm wrist extensors; it does not represent every forearm muscle.",
  "sourceIds": [
   "pull-ace-wrist-extension"
  ]
 }
];
const byName=new Map(reviews.map(review=>[resolveExerciseName(review.name),review]));

/** Returns fresh data; callers cannot change catalog defaults or source links. */
export function presetMuscleReview(name:string){
 const review=byName.get(resolveExerciseName(name));
 return review?{name:review.name,direct:[...review.direct],indirect:[...review.indirect],note:review.note,sources:review.sourceIds.map(id=>({...sources[id]}))}:null;
}
