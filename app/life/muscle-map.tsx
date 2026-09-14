"use client";
import {muscleNames,type MuscleId} from '@/lib/life/muscle-groups';
import type {MuscleVolume} from '@/lib/life/muscle-volume';
type Region=[MuscleId,string,boolean?];
// Original schematic: regional muscle groups, not a diagnostic anatomy model.
const front:Region[]=[
 ['shoulders','M40 58 Q31 59 29 82 L42 86 49 67Z'],
 ['chest','M51 61 L72 62 72 92 Q57 100 44 88 L46 72Z'],
 ['biceps','M29 88 L40 91 36 120 25 120Z'],
 ['forearms','M24 125 L35 126 28 158 17 162Z'],
 ['abs','M58 100 L72 98 72 148 58 156 55 128Z'],
 ['quads','M48 168 L60 171 66 200 62 243 48 244 43 206Z'],
 ['adductors','M64 166 L73 163 72 210 67 229 66 194Z'],
 ['calves','M49 251 L61 251 63 275 57 313 48 310 46 280Z'],
];
const back:Region[]=[
 ['shoulders','M39 58 Q30 61 29 83 L43 87 47 68Z'],
 ['upper-back','M64 49 L72 49 72 107 58 103 46 73Z'],
 ['lats','M44 94 L57 106 70 112 66 145 54 137Z'],
 ['triceps','M29 89 L40 92 36 121 25 120Z'],
 ['forearms','M24 125 L35 126 28 158 17 162Z'],
 ['lower-back','M58 143 L72 148 72 166 55 162Z'],
 ['glutes','M51 167 Q62 166 72 172 L72 199 Q49 211 45 190Z'],
 ['hamstrings','M47 205 Q58 211 70 204 L65 244 49 247Z'],
 ['calves','M49 252 L62 252 66 279 57 311 48 306 46 278Z'],
];
const outline='M65 45 L65 51 Q50 53 37 57 Q27 61 25 80 L20 118 11 159 Q8 170 14 176 L23 175 33 149 42 113 49 128 45 160 Q37 182 41 212 L44 250 41 282 45 318 39 327 Q38 333 54 332 L61 327 66 280 66 252 75 213 84 252 84 280 89 327 96 332 Q112 333 111 327 L105 318 109 282 106 250 109 212 Q113 182 105 160 L101 128 108 113 117 149 127 175 136 176 Q142 170 139 159 L130 118 125 80 Q123 61 113 57 Q100 53 85 51 L85 45Z';
export function volumeColor(value:number){return value===0?'var(--muscle-empty)':value<5?'var(--muscle-low)':value<10?'var(--muscle-mid)':'var(--muscle-high)';}
export default function MuscleMap({volumes,selected,onSelect}:{volumes:Record<MuscleId,MuscleVolume>;selected:MuscleId;onSelect:(id:MuscleId)=>void}){
 return <svg viewBox="0 0 320 360" className="muscle-map" aria-label="Front and back muscle coverage map"><title>Choose a muscle group to inspect its estimated sets</title>{[front,back].map((regions,index)=><g key={index} transform={`translate(${index*160+5} 0)`}><text x="75" y="356" textAnchor="middle">{index?'Back':'Front'}</text><circle className="body-outline" cx="75" cy="27" r="17"/><path className="body-outline" d={outline}/>{regions.map(([id,d])=><g key={id} role="button" tabIndex={0} aria-label={`${muscleNames[id]}, ${volumes[id].estimated} estimated sets, ${index?'back':'front'}`} aria-pressed={selected===id} onClick={()=>onSelect(id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(id);}}} className={selected===id?'muscle-region selected':'muscle-region'} style={{fill:volumeColor(volumes[id].estimated)}}><title>{muscleNames[id]} · {volumes[id].direct} direct + {volumes[id].indirect} indirect sets</title><path d={d}/><path d={d} transform="translate(150 0) scale(-1 1)"/></g>)}</g>)}</svg>;
}
