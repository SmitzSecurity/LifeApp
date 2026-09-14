"use client";
import {useEffect,useState,type CSSProperties} from 'react';
import {Button} from '@/components/ui/button';
import {defaultAppearance,palettes,themeColors,readability,type Appearance,type ColorKey,themeVariables} from '@/lib/life/appearance';
const groups:{title:string;fields:[ColorKey,string][]}[]=[
 {title:'Surfaces',fields:[['background','Page background'],['card','Cards'],['popover','Menus & dialogs'],['nav','Navigation'],['inputBackground','Input fields']]},
 {title:'Text & controls',fields:[['foreground','Main text'],['mutedForeground','Secondary text'],['primary','Primary button'],['primaryForeground','Primary button text'],['secondary','Secondary button'],['secondaryForeground','Secondary button text'],['accent','Selection & hover'],['accentForeground','Selected text'],['border','Dividers'],['input','Input borders'],['ring','Keyboard focus']]},
 {title:'Status',fields:[['success','Success'],['warning','Warnings'],['destructive','Errors & deletion'],['destructiveForeground','Delete button text'],['info','Information']]},
 {title:'Charts & muscle map',fields:[['chart1','Budget trend'],['chart2','Movement trend'],['chart3','Category allowance bars'],['chart4','Workout rest timer'],['chart5','Habit scores'],['muscleEmpty','Muscle map: no sets'],['muscleLow','Muscle map: under 5'],['muscleMid','Muscle map: 5 to 9'],['muscleHigh','Muscle map: 10 or more']]}
];
function ColorField({label,value,onChange}:{label:string;value:string;onChange:(color:string)=>void}){
 useEffect(()=>setText(value),[value]);
 const [text,setText]=useState(value),valid=/^#[0-9a-fA-F]{6}$/.test(text);
 return <div className="color-field"><label><span>{label}</span><input type="color" aria-label={label+' color'} value={value} onChange={e=>{setText(e.target.value);onChange(e.target.value);}}/></label><input aria-label={label+' hex'} value={text} maxLength={7} spellCheck={false} aria-invalid={!valid} onChange={e=>{setText(e.target.value);if(/^#[0-9a-fA-F]{6}$/.test(e.target.value))onChange(e.target.value);}} onBlur={()=>{if(!valid)setText(value);}}/></div>;
}
export default function AppearanceSettings({value,onChange}:{value?:Appearance;onChange:(value:Appearance)=>void}){
 const [groupIndex,setGroupIndex]=useState(0);
 const appearance=value||defaultAppearance(),colors=themeColors(appearance),checks=readability(colors),failing=checks.filter(c=>c.ratio<c.minimum);
 function color(key:ColorKey,value:string){onChange({...appearance,custom:{...appearance.custom,[appearance.mode]:{...appearance.custom[appearance.mode],[key]:value}}});}
 return <details className="settings-group appearance-settings"><summary><strong>Appearance</strong><span>OLED black, light blue, or your own colors</span></summary><div className="theme-options" role="group" aria-label="Theme">{(['oled','light'] as const).map(mode=><button type="button" key={mode} aria-pressed={appearance.mode===mode} onClick={()=>onChange({...appearance,mode})}><span className="theme-swatch" style={{background:palettes[mode].background,borderColor:palettes[mode].input}}><i style={{background:palettes[mode].primary}}/><i style={{background:palettes[mode].secondary}}/></span><strong>{mode==='oled'?'OLED black':'Light blue'}</strong><small>{mode==='oled'?'True black, white & grey':'White with soft blue tones'}</small></button>)}</div>
 <p className="muted">Preview changes across the app, then Save Settings. Colors are saved to your account; each theme keeps its own custom palette.</p>
 <div className="appearance-preview"><strong>A little perspective</strong><p>Your analysis and everyday controls.</p><span className="theme-example-primary">Start today’s log</span><span className="theme-example-secondary">Read analysis</span></div>
 <details className="palette-editor" style={themeVariables(palettes[appearance.mode]) as CSSProperties}><summary>Customize colors</summary><div className="palette-groups" role="group" aria-label="Color groups">{groups.map((group,index)=><button type="button" key={group.title} aria-pressed={groupIndex===index} onClick={()=>setGroupIndex(index)}>{group.title}</button>)}</div>{groups.filter((_,index)=>index===groupIndex).map(group=><fieldset key={group.title}><legend>{group.title}</legend><div className="color-grid">{group.fields.map(([key,label])=><ColorField key={appearance.mode+':'+key} label={label} value={colors[key]} onChange={v=>color(key,v)}/>)}</div></fieldset>)}</details>
 <div className="theme-readability" style={{color:palettes[appearance.mode].foreground,background:palettes[appearance.mode].card,'--muted-foreground':palettes[appearance.mode].mutedForeground} as CSSProperties} role="status">{failing.length?<><strong>{failing.length} contrast {failing.length===1?'pair needs':'pairs need'} attention</strong><p>Some text or controls may be hard to see.</p><details><summary>Show contrast checks</summary>{failing.map(c=><small key={c.label}>{c.label}: {c.ratio.toFixed(2)}:1; aim for {c.minimum}:1</small>)}</details></>:<p>Text and control contrast checks pass.</p>}</div>
 <Button className="reset-theme" style={{color:palettes[appearance.mode].foreground,background:palettes[appearance.mode].card,border:`1px solid ${palettes[appearance.mode].input}`}} variant="ghost" onClick={()=>onChange({...appearance,custom:{...appearance.custom,[appearance.mode]:{}}})}>Reset {appearance.mode==='oled'?'OLED':'light'} colors</Button>
 </details>;
}
