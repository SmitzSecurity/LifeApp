"use client";
import {useEffect,useState} from 'react';
import type {ColorKey} from '@/lib/life/appearance';

export const colorGroups:{title:string;fields:[ColorKey,string][]}[]=[
 {title:'Surfaces',fields:[['background','Page background'],['card','Cards'],['popover','Menus & dialogs'],['nav','Navigation'],['inputBackground','Input fields']]},
 {title:'Text & controls',fields:[['foreground','Main text'],['mutedForeground','Secondary text'],['primary','Primary button'],['primaryForeground','Primary button text'],['secondary','Secondary button'],['secondaryForeground','Secondary button text'],['accent','Selection & hover'],['accentForeground','Selected text'],['border','Dividers'],['input','Input borders'],['ring','Keyboard focus']]},
 {title:'Status',fields:[['success','Success'],['warning','Warnings'],['destructive','Errors & deletion'],['destructiveForeground','Delete button text'],['info','Information']]},
 {title:'Charts & muscle map',fields:[['chart1','Budget trend'],['chart2','Movement trend'],['chart3','Category allowance bars'],['chart4','Workout rest timer'],['chart5','Habit scores'],['muscleEmpty','Muscle map: no sets'],['muscleLow','Muscle map: under 5'],['muscleMid','Muscle map: 5 to 9'],['muscleHigh','Muscle map: 10 or more']]}
];
export const colorLabels=Object.fromEntries(colorGroups.flatMap(group=>group.fields)) as Record<ColorKey,string>;
export const relatedColors=(key:ColorKey):ColorKey[]=>{
 const pair=([['primary','primaryForeground'],['secondary','secondaryForeground'],['accent','accentForeground'],['destructive','destructiveForeground'],['inputBackground','foreground','input','ring'],['card','foreground','mutedForeground','border'],['popover','foreground','mutedForeground','border'],['nav','foreground','mutedForeground'],['background','foreground','mutedForeground']] as ColorKey[][]).find(keys=>keys[0]===key);
 return pair||[key];
};
export function ColorField({label,value,onChange}:{label:string;value:string;onChange:(color:string)=>void}){
 const [text,setText]=useState(value),valid=/^#[0-9a-fA-F]{6}$/.test(text);
 useEffect(()=>setText(value),[value]);
 return <div className="color-field"><label><span>{label}</span><input type="color" aria-label={label+' color'} value={value} onChange={e=>{setText(e.target.value);onChange(e.target.value);}}/></label><input aria-label={label+' hex'} value={text} maxLength={7} spellCheck={false} aria-invalid={!valid} onChange={e=>{setText(e.target.value);if(/^#[0-9a-fA-F]{6}$/.test(e.target.value))onChange(e.target.value);}} onBlur={()=>{if(!valid)setText(value);}}/></div>;
}
