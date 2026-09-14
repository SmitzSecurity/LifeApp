import {z} from 'zod/v3';
export const colorKeys=['background','card','popover','nav','inputBackground','foreground','mutedForeground','primary','primaryForeground','secondary','secondaryForeground','accent','accentForeground','border','input','ring','success','warning','destructive','destructiveForeground','info','chart1','chart2','chart3','chart4','chart5','muscleEmpty','muscleLow','muscleMid','muscleHigh'] as const;
export type ColorKey=typeof colorKeys[number];
export type ThemeColors=Record<ColorKey,string>;
export const palettes:Record<'oled'|'light',ThemeColors>={
 oled:{background:'#000000',card:'#0c0c0c',popover:'#171717',nav:'#080808',inputBackground:'#111111',foreground:'#ffffff',mutedForeground:'#b5b5b5',primary:'#eeeeee',primaryForeground:'#101010',secondary:'#262626',secondaryForeground:'#f5f5f5',accent:'#303030',accentForeground:'#ffffff',border:'#414141',input:'#858585',ring:'#ffffff',success:'#8dd7ad',warning:'#e8c577',destructive:'#f49aaa',destructiveForeground:'#201014',info:'#b8cce6',chart1:'#eeeeee',chart2:'#b9b9b9',chart3:'#909090',chart4:'#6e6e6e',chart5:'#cacaca',muscleEmpty:'#252525',muscleLow:'#777777',muscleMid:'#b8b8b8',muscleHigh:'#f5f5f5'},
 light:{background:'#f5f9ff',card:'#ffffff',popover:'#ffffff',nav:'#edf4fd',inputBackground:'#ffffff',foreground:'#102641',mutedForeground:'#47617e',primary:'#185cb5',primaryForeground:'#ffffff',secondary:'#e2edfc',secondaryForeground:'#174276',accent:'#dbeafe',accentForeground:'#144884',border:'#bfcee0',input:'#6c84a2',ring:'#185cb5',success:'#246c45',warning:'#825a12',destructive:'#b32e46',destructiveForeground:'#ffffff',info:'#285f9c',chart1:'#185cb5',chart2:'#35629c',chart3:'#367184',chart4:'#5a60a2',chart5:'#91612c',muscleEmpty:'#e4edf9',muscleLow:'#7095c5',muscleMid:'#356aaa',muscleHigh:'#134985'}
};
const customColors=z.record(z.enum(colorKeys),z.string().regex(/^#[0-9a-fA-F]{6}$/,'Use a six-digit hex color.'));
export const appearanceSchema=z.object({mode:z.enum(['oled','light']),custom:z.object({oled:customColors,light:customColors}).strict()}).strict();
export type Appearance=z.infer<typeof appearanceSchema>;
export const defaultAppearance=():Appearance=>({mode:'oled',custom:{oled:{},light:{}}});
export function themeColors(value:Appearance):ThemeColors{return {...palettes[value.mode],...value.custom[value.mode]};}
export function themeVariables(colors:ThemeColors){
 const vars:Record<string,string>={};for(const key of colorKeys)vars['--'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()).replace(/(chart)([0-9])/,'$1-$2')]=colors[key];
 for(const key of ['card-foreground','popover-foreground','sidebar-foreground'])vars['--'+key]=colors.foreground;
 Object.assign(vars,{'--muted':colors.secondary,'--sidebar':colors.nav,'--sidebar-primary':colors.primary,'--sidebar-primary-foreground':colors.primaryForeground,'--sidebar-accent':colors.accent,'--sidebar-accent-foreground':colors.accentForeground,'--sidebar-border':colors.border,'--sidebar-ring':colors.ring});return vars;
}
export const appearanceCacheKey='lifeapp-appearance-v1';
/** Runs before paint. Only known tokens with six-digit hex values reach styles. */
export function appearanceBootstrap(){
 const names=Object.fromEntries(Object.entries(themeVariables(Object.fromEntries(colorKeys.map(k=>[k,k])) as ThemeColors)).map(([css,key])=>[css,key]));
 return `(()=>{try{const p=${JSON.stringify(palettes)},names=${JSON.stringify(names)},v=JSON.parse(localStorage.getItem('${appearanceCacheKey}')||'null');if(!v||(v.mode!=='oled'&&v.mode!=='light'))return;const c={...p[v.mode]};for(const k of Object.keys(c)){const x=v.custom?.[v.mode]?.[k];if(typeof x==='string'&&/^#[0-9a-fA-F]{6}$/.test(x))c[k]=x;}for(const [css,key] of Object.entries(names))document.documentElement.style.setProperty(css,c[key]);document.documentElement.style.colorScheme=v.mode==='light'?'light':'dark';document.documentElement.dataset.theme=v.mode;}catch{}})();`;
}
export function contrast(a:string,b:string){const luminance=(hex:string)=>{const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
export function readability(colors:ThemeColors){return [
 ...(['background','card','popover','inputBackground','nav'] as const).flatMap(surface=>[{label:`Text on ${surface==='inputBackground'?'input fields':surface==='nav'?'navigation':surface==='popover'?'menus & dialogs':surface==='card'?'cards':'page background'}`,ratio:contrast(colors.foreground,colors[surface]),minimum:4.5},{label:`Secondary text on ${surface==='inputBackground'?'input fields':surface==='nav'?'navigation':surface==='popover'?'menus & dialogs':surface==='card'?'cards':'page background'}`,ratio:contrast(colors.mutedForeground,colors[surface]),minimum:4.5}]),
 ...([['primary','primaryForeground'],['secondary','secondaryForeground'],['accent','accentForeground'],['destructive','destructiveForeground']] as const).map(([bg,fg])=>({label:bg+' button text',ratio:contrast(colors[bg],colors[fg]),minimum:4.5})),
 {label:'Input outline',ratio:contrast(colors.input,colors.inputBackground),minimum:3},
 ...(['background','card','popover'] as const).map(bg=>({label:'Focus ring on '+bg,ratio:contrast(colors.ring,colors[bg]),minimum:3}))
 ];}
