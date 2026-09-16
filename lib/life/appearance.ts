import {z} from 'zod/v3';
export const colorKeys=['background','card','popover','nav','inputBackground','foreground','mutedForeground','primary','primaryForeground','secondary','secondaryForeground','accent','accentForeground','border','input','ring','success','warning','destructive','destructiveForeground','info','chart1','chart2','chart3','chart4','chart5','muscleEmpty','muscleLow','muscleMid','muscleHigh'] as const;
export type ColorKey=typeof colorKeys[number];
export type ThemeColors=Record<ColorKey,string>;
export const palettes:Record<'oled'|'light',ThemeColors>={
 oled:{background:'#000000',card:'#0c0c0c',popover:'#171717',nav:'#080808',inputBackground:'#111111',foreground:'#ffffff',mutedForeground:'#b5b5b5',primary:'#eeeeee',primaryForeground:'#101010',secondary:'#262626',secondaryForeground:'#f5f5f5',accent:'#303030',accentForeground:'#ffffff',border:'#414141',input:'#858585',ring:'#ffffff',success:'#8dd7ad',warning:'#e8c577',destructive:'#f49aaa',destructiveForeground:'#201014',info:'#b8cce6',chart1:'#eeeeee',chart2:'#b9b9b9',chart3:'#909090',chart4:'#6e6e6e',chart5:'#cacaca',muscleEmpty:'#252525',muscleLow:'#777777',muscleMid:'#b8b8b8',muscleHigh:'#f5f5f5'},
 light:{background:'#f5f9ff',card:'#ffffff',popover:'#ffffff',nav:'#edf4fd',inputBackground:'#ffffff',foreground:'#102641',mutedForeground:'#47617e',primary:'#185cb5',primaryForeground:'#ffffff',secondary:'#e2edfc',secondaryForeground:'#174276',accent:'#dbeafe',accentForeground:'#144884',border:'#bfcee0',input:'#6c84a2',ring:'#185cb5',success:'#246c45',warning:'#825a12',destructive:'#b32e46',destructiveForeground:'#ffffff',info:'#285f9c',chart1:'#185cb5',chart2:'#35629c',chart3:'#367184',chart4:'#5a60a2',chart5:'#91612c',muscleEmpty:'#e4edf9',muscleLow:'#7095c5',muscleMid:'#356aaa',muscleHigh:'#134985'}
};
export const fontOptions=[
 {id:'system',label:'System',stack:'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'},
 {id:'sans',label:'Sans',stack:'Arial, Helvetica, sans-serif'},
 {id:'rounded',label:'Rounded',stack:'ui-rounded, "Segoe UI", system-ui, sans-serif'},
 {id:'serif',label:'Serif',stack:'Georgia, Cambria, "Times New Roman", serif'},
 {id:'mono',label:'Mono',stack:'ui-monospace, "Cascadia Code", "SFMono-Regular", Consolas, monospace'},
 {id:'classic',label:'Classic',stack:'Verdana, Tahoma, sans-serif'}
] as const;
export const textScales=[90,100,110,120,130] as const;
const typographySchema=z.object({font:z.enum(['system','sans','rounded','serif','mono','classic']),scale:z.union([z.literal(90),z.literal(100),z.literal(110),z.literal(120),z.literal(130)])}).strict();
export type Typography=z.infer<typeof typographySchema>;
export const defaultTypography=():Typography=>({font:'system',scale:100});
/** Only local font stacks and bounded scales can become CSS values. */
export function typographyVariables(typography?:Typography){
 const font=fontOptions.find(option=>option.id===typography?.font)||fontOptions[0];
 const scale=textScales.find(option=>option===typography?.scale)||100;
 return {'--ui-font-family':font.stack,'--ui-text-scale':String(scale/100)};
}
export type ThemePreset={id:string;name:string;description:string;mode:'oled'|'light';colors:ThemeColors};
function preset(id:string,name:string,description:string,mode:ThemePreset['mode'],colors:Partial<ThemeColors>={}):ThemePreset{return {id,name,description,mode,colors:{...palettes[mode],...colors}};}
export const themePresets:ThemePreset[]=[
 preset('oled','OLED black','True black with quiet silver accents.','oled'),
 preset('graphite','Graphite','Soft charcoal and cool slate.','oled',{
  background:'#15171a',card:'#202327',popover:'#292d32',nav:'#1b1e22',inputBackground:'#16191d',foreground:'#f2f5f8',mutedForeground:'#bcc3cc',primary:'#cbd5e1',primaryForeground:'#16202c',secondary:'#333b45',secondaryForeground:'#eef2f7',accent:'#3e4a58',accentForeground:'#ffffff',border:'#4a5563',input:'#8997a9',ring:'#d9e4f1',chart1:'#cbd5e1',chart2:'#94a3b8',chart3:'#9abcc7',chart4:'#b7aecb',chart5:'#c4b59b',muscleEmpty:'#2c333d',muscleLow:'#697e96',muscleMid:'#9caec5',muscleHigh:'#dce6f3'
 }),
 preset('midnight','Midnight','Deep navy with clear blue accents.','oled',{
  background:'#081222',card:'#101d32',popover:'#172943',nav:'#0b182b',inputBackground:'#0b1729',foreground:'#eef4ff',mutedForeground:'#b3c4df',primary:'#a5c8ff',primaryForeground:'#0b2140',secondary:'#233958',secondaryForeground:'#edf4ff',accent:'#2c4669',accentForeground:'#ffffff',border:'#3d5677',input:'#8aa4c7',ring:'#bcd8ff',chart1:'#a5c8ff',chart2:'#82b5d6',chart3:'#93d3cb',chart4:'#b7a8e7',chart5:'#d0bd90',muscleEmpty:'#1c304d',muscleLow:'#456b9b',muscleMid:'#7aabeb',muscleHigh:'#c5deff'
 }),
 preset('forest','Forest','Evergreen surfaces and soft sage.','oled',{
  background:'#0c1712',card:'#14251c',popover:'#1c3026',nav:'#101f17',inputBackground:'#102219',foreground:'#f1f8f3',mutedForeground:'#b7d1be',primary:'#9cd3ad',primaryForeground:'#102d1b',secondary:'#294333',secondaryForeground:'#eff8f2',accent:'#34533f',accentForeground:'#ffffff',border:'#496452',input:'#89ad95',ring:'#b3e0c0',chart1:'#9cd3ad',chart2:'#8cbeb2',chart3:'#b4c58d',chart4:'#95b8cf',chart5:'#d7be8e',muscleEmpty:'#253c2e',muscleLow:'#4b7b5b',muscleMid:'#85b996',muscleHigh:'#c0ebcb'
 }),
 preset('plum','Plum','Velvety purple and lilac highlights.','oled',{
  background:'#19101e',card:'#281b31',popover:'#34243e',nav:'#211627',inputBackground:'#221629',foreground:'#fbf0ff',mutedForeground:'#d1b9dc',primary:'#dbb6ef',primaryForeground:'#32153e',secondary:'#452f50',secondaryForeground:'#f8ecff',accent:'#563d63',accentForeground:'#ffffff',border:'#6a5076',input:'#af91bd',ring:'#e8c8fa',chart1:'#dbb6ef',chart2:'#bca8e1',chart3:'#ecaaca',chart4:'#9fc6ce',chart5:'#dcc08e',muscleEmpty:'#3c2a45',muscleLow:'#7b578c',muscleMid:'#b789cd',muscleHigh:'#e7c5f6'
 }),
 preset('ember','Ember','Warm charcoal with copper and peach.','oled',{
  background:'#1b1210',card:'#2b1d18',popover:'#38271f',nav:'#241914',inputBackground:'#241914',foreground:'#fff3eb',mutedForeground:'#d7c0b1',primary:'#efb38e',primaryForeground:'#3a1d0e',secondary:'#493327',secondaryForeground:'#fff0e5',accent:'#594030',accentForeground:'#fff5ee',border:'#6c5141',input:'#b59a87',ring:'#ffd0ac',chart1:'#efb38e',chart2:'#d9c092',chart3:'#d39ba1',chart4:'#a2c0b3',chart5:'#b4aed8',muscleEmpty:'#402c22',muscleLow:'#885b40',muscleMid:'#c6906a',muscleHigh:'#f9c9a5'
 }),
 preset('light','Light blue','Crisp white with familiar blue accents.','light'),
 preset('paper','Paper','Warm white and understated ink.','light',{
  background:'#f8f7f3',card:'#ffffff',popover:'#fffefa',nav:'#f0efea',inputBackground:'#fffefa',foreground:'#292a27',mutedForeground:'#62635b',primary:'#424d42',primaryForeground:'#ffffff',secondary:'#e8ebe3',secondaryForeground:'#334233',accent:'#dfe5da',accentForeground:'#2e432f',border:'#c9cec2',input:'#818875',ring:'#52664b',chart1:'#52664b',chart2:'#697757',chart3:'#537980',chart4:'#796c91',chart5:'#966f3d',muscleEmpty:'#e9ede3',muscleLow:'#a1b094',muscleMid:'#708562',muscleHigh:'#425e38'
 }),
 preset('sand','Sand','Sandy neutrals and grounded bronze.','light',{
  background:'#faf5ec',card:'#fffdf8',popover:'#fffdf8',nav:'#f0e7d8',inputBackground:'#ffffff',foreground:'#382d21',mutedForeground:'#6e5b43',primary:'#80582d',primaryForeground:'#ffffff',secondary:'#eee1ce',secondaryForeground:'#624421',accent:'#e9d9bf',accentForeground:'#5d3d19',border:'#d7c5aa',input:'#9b815e',ring:'#80582d',chart1:'#80582d',chart2:'#a47740',chart3:'#687e65',chart4:'#6e7796',chart5:'#a3625a',muscleEmpty:'#ede4d5',muscleLow:'#c6a676',muscleMid:'#9c7946',muscleHigh:'#745025'
 }),
 preset('rose','Rose','Pale blush and muted berry.','light',{
  background:'#fff5f7',card:'#ffffff',popover:'#fffafb',nav:'#f7e9ee',inputBackground:'#ffffff',foreground:'#412634',mutedForeground:'#7e5368',primary:'#983e69',primaryForeground:'#ffffff',secondary:'#f3e1ea',secondaryForeground:'#773454',accent:'#f0d8e4',accentForeground:'#762b4e',border:'#ddbdcd',input:'#a1768d',ring:'#983e69',chart1:'#983e69',chart2:'#a56685',chart3:'#7c699e',chart4:'#487f7c',chart5:'#a5743d',muscleEmpty:'#f1e1e9',muscleLow:'#d398b2',muscleMid:'#b45f86',muscleHigh:'#8c335a'
 }),
 preset('mint','Mint','Fresh pale green and rich teal.','light',{
  background:'#f1faf5',card:'#ffffff',popover:'#fafffc',nav:'#e4f1e9',inputBackground:'#ffffff',foreground:'#193c30',mutedForeground:'#446b5c',primary:'#216c54',primaryForeground:'#ffffff',secondary:'#ddefe4',secondaryForeground:'#225d47',accent:'#d1e9dc',accentForeground:'#1b5941',border:'#b9d3c5',input:'#669080',ring:'#216c54',chart1:'#216c54',chart2:'#4d8064',chart3:'#347b88',chart4:'#797397',chart5:'#98723d',muscleEmpty:'#e0eee5',muscleLow:'#8bbb9d',muscleMid:'#518a68',muscleHigh:'#245e3e'
 }),
 preset('lavender','Lavender','Airy lilac with calm violet accents.','light',{
  background:'#f8f5ff',card:'#ffffff',popover:'#fcfaff',nav:'#ede7f7',inputBackground:'#ffffff',foreground:'#342647',mutedForeground:'#6d5985',primary:'#76509c',primaryForeground:'#ffffff',secondary:'#eae0f6',secondaryForeground:'#593876',accent:'#e3d6f1',accentForeground:'#593076',border:'#cebedf',input:'#9780b0',ring:'#76509c',chart1:'#76509c',chart2:'#9270ab',chart3:'#546ea0',chart4:'#498777',chart5:'#ac7559',muscleEmpty:'#ebe3f4',muscleLow:'#b9a0d1',muscleMid:'#9270b1',muscleHigh:'#67458a'
 })
];
const customColors=z.record(z.enum(colorKeys),z.string().regex(/^#[0-9a-fA-F]{6}$/,'Use a six-digit hex color.'));
const savedThemeSchema=z.object({slot:z.number().int().min(1).max(3),name:z.string().trim().min(1).max(40),mode:z.enum(['oled','light']),colors:customColors.refine(colors=>colorKeys.every(key=>colors[key]!==undefined),'Save a complete palette.'),typography:typographySchema.optional()}).strict();
export const appearanceSchema=z.object({mode:z.enum(['oled','light']),custom:z.object({oled:customColors,light:customColors}).strict(),typography:typographySchema.optional(),savedThemes:z.array(savedThemeSchema).max(3).refine(themes=>new Set(themes.map(theme=>theme.slot)).size===themes.length,'Theme slots must be unique.').optional()}).strict();
export type Appearance=z.infer<typeof appearanceSchema>;
export type SavedTheme=z.infer<typeof savedThemeSchema>;
export const defaultAppearance=():Appearance=>({mode:'oled',custom:{oled:{},light:{}}});
export function themeColors(value:Appearance):ThemeColors{return {...palettes[value.mode],...value.custom[value.mode]};}
export function applyPreset(value:Appearance,id:string):Appearance{
 const chosen=themePresets.find(p=>p.id===id);
 return chosen?{...value,mode:chosen.mode,custom:{...value.custom,[chosen.mode]:{...chosen.colors}}}:value;
}
export function activePreset(value:Appearance):ThemePreset|undefined{
 const colors=themeColors(value);
 return themePresets.find(p=>p.mode===value.mode&&colorKeys.every(key=>p.colors[key].toLowerCase()===colors[key].toLowerCase()));
}
export function saveTheme(value:Appearance,slot:number,name:string):Appearance{
 const theme=savedThemeSchema.parse({slot,name,mode:value.mode,colors:themeColors(value),typography:{...(value.typography||defaultTypography())}});
 return {...value,savedThemes:[...(value.savedThemes||[]).filter(t=>t.slot!==slot),theme].sort((a,b)=>a.slot-b.slot)};
}
export function applyTheme(value:Appearance,slot:number):Appearance{
 const theme=value.savedThemes?.find(t=>t.slot===slot);
 return theme?{...value,mode:theme.mode,custom:{...value.custom,[theme.mode]:{...theme.colors}},...(theme.typography?{typography:{...theme.typography}}:{})}:value;
}
export function removeTheme(value:Appearance,slot:number):Appearance{return {...value,savedThemes:(value.savedThemes||[]).filter(t=>t.slot!==slot)};}
export function themeVariables(colors:ThemeColors){
 const vars:Record<string,string>={};for(const key of colorKeys)vars['--'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()).replace(/(chart)([0-9])/,'$1-$2')]=colors[key];
 for(const key of ['card-foreground','popover-foreground','sidebar-foreground'])vars['--'+key]=colors.foreground;
 Object.assign(vars,{'--muted':colors.secondary,'--sidebar':colors.nav,'--sidebar-primary':colors.primary,'--sidebar-primary-foreground':colors.primaryForeground,'--sidebar-accent':colors.accent,'--sidebar-accent-foreground':colors.accentForeground,'--sidebar-border':colors.border,'--sidebar-ring':colors.ring});return vars;
}
export const appearanceCacheKey='lifeapp-appearance-v1';
/** Runs before paint. Only known colors, local font stacks and scales reach styles. */
export function appearanceBootstrap(){
 const names=Object.fromEntries(Object.entries(themeVariables(Object.fromEntries(colorKeys.map(k=>[k,k])) as ThemeColors)).map(([css,key])=>[css,key]));
 return `(()=>{try{const p=${JSON.stringify(palettes)},names=${JSON.stringify(names)},fonts=${JSON.stringify(fontOptions)},scales=${JSON.stringify(textScales)};let v;try{v=JSON.parse(localStorage.getItem('${appearanceCacheKey}')||'null');}catch{}const font=fonts.find(x=>x.id===v?.typography?.font)||fonts[0],scale=scales.find(x=>x===v?.typography?.scale)||100;document.documentElement.style.setProperty('--ui-font-family',font.stack);document.documentElement.style.setProperty('--ui-text-scale',String(scale/100));if(!v||(v.mode!=='oled'&&v.mode!=='light'))return;const c={...p[v.mode]};for(const k of Object.keys(c)){const x=v.custom?.[v.mode]?.[k];if(typeof x==='string'&&/^#[0-9a-fA-F]{6}$/.test(x))c[k]=x;}for(const [css,key] of Object.entries(names))document.documentElement.style.setProperty(css,c[key]);document.documentElement.style.colorScheme=v.mode==='light'?'light':'dark';document.documentElement.dataset.theme=v.mode;}catch{}})();`;
}
export function contrast(a:string,b:string){const luminance=(hex:string)=>{const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
export type ContrastCheck={label:string;ratio:number;minimum:number;colors:readonly ColorKey[]};
export function readability(colors:ThemeColors):ContrastCheck[]{return [
 ...(['background','card','popover','inputBackground','nav'] as const).flatMap(surface=>[{label:`Text on ${surface==='inputBackground'?'input fields':surface==='nav'?'navigation':surface==='popover'?'menus & dialogs':surface==='card'?'cards':'page background'}`,ratio:contrast(colors.foreground,colors[surface]),minimum:4.5,colors:['foreground',surface] as const},{label:`Secondary text on ${surface==='inputBackground'?'input fields':surface==='nav'?'navigation':surface==='popover'?'menus & dialogs':surface==='card'?'cards':'page background'}`,ratio:contrast(colors.mutedForeground,colors[surface]),minimum:4.5,colors:['mutedForeground',surface] as const}]),
 ...([['primary','primaryForeground'],['secondary','secondaryForeground'],['accent','accentForeground'],['destructive','destructiveForeground']] as const).map(([bg,fg])=>({label:bg+' button text',ratio:contrast(colors[bg],colors[fg]),minimum:4.5,colors:[bg,fg]})),
 {label:'Input outline',ratio:contrast(colors.input,colors.inputBackground),minimum:3,colors:['input','inputBackground']},
 ...(['background','card','popover'] as const).map(bg=>({label:'Focus ring on '+bg,ratio:contrast(colors.ring,colors[bg]),minimum:3,colors:['ring',bg] as const}))
 ];}

const surfaces=['background','card','popover','inputBackground','nav'] as const;
const rgb=(color:string)=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
/** Search toward black/white, retaining the closest passing RGB tint of the user's color. */
function readableTint(color:string,backgrounds:string[],minimum:number):string|undefined{
 const fits=(candidate:string)=>backgrounds.every(bg=>contrast(candidate,bg)>=minimum);
 if(fits(color))return color;
 const source=rgb(color);let best:string|undefined,distance=Infinity;
 for(const end of [0,255])for(let step=1;step<=255;step++){
  const next=source.map(v=>Math.round(v+(end-v)*step/255));
  const hex='#'+next.map(v=>v.toString(16).padStart(2,'0')).join('');
  if(fits(hex)){const delta=next.reduce((sum,v,i)=>sum+(v-source[i])**2,0);if(delta<distance){best=hex;distance=delta;}break;}
 }
 return best;
}
/** Optional local suggestion: never runs while choosing a color or saving Settings. */
export function recommendedColors(original:ThemeColors,mode:Appearance['mode']):ThemeColors{
 const result={...original};
 // Very mixed surfaces cannot share one readable text color. Only then harmonize
 // conflicting surfaces toward the mode's background before choosing text tints.
 if(!readableTint(result.foreground,surfaces.map(k=>result[k]),4.5)){
  const anchor=mode==='oled'?'#ffffff':'#000000';
  for(const key of surfaces)result[key]=readableTint(result[key],[anchor],4.6)!;
 }
 for(const key of ['foreground','mutedForeground'] as const)result[key]=readableTint(result[key],surfaces.map(k=>result[k]),4.5)||result.foreground;
 for(const key of ['success','warning','info','destructive'] as const)result[key]=readableTint(result[key],surfaces.map(k=>result[k]),4.5)||result.foreground;
 for(const [bg,fg] of [['primary','primaryForeground'],['secondary','secondaryForeground'],['accent','accentForeground'],['destructive','destructiveForeground']] as const)result[fg]=readableTint(result[fg],[result[bg]],4.5)!;
 result.input=readableTint(result.input,[result.inputBackground],3)!;
 result.ring=readableTint(result.ring,[result.background,result.card,result.popover],3)||result.foreground;
 return result;
}
export type ColorRecommendation={mode:Appearance['mode'];before:Partial<ThemeColors>;after:ThemeColors};
export function recommendationKeys(recommendation:ColorRecommendation):ColorKey[]{
 const before={...palettes[recommendation.mode],...recommendation.before};
 return colorKeys.filter(key=>before[key].toLowerCase()!==recommendation.after[key].toLowerCase());
}
/** Undo only this suggestion; retain subsequent manual edits and saved-theme changes. */
export function undoRecommendation(value:Appearance,recommendation:ColorRecommendation):Appearance{
 const mode=recommendation.mode,custom={...value.custom[mode]},current={...palettes[mode],...custom};
 for(const key of recommendationKeys(recommendation))if(current[key].toLowerCase()===recommendation.after[key].toLowerCase()){
  if(recommendation.before[key]===undefined)delete custom[key];else custom[key]=recommendation.before[key];
 }
 return {...value,custom:{...value.custom,[mode]:custom}};
}
