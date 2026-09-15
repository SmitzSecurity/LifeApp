import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {appearanceSchema,defaultAppearance,palettes,themeColors,themeVariables,appearanceBootstrap,readability,colorKeys,saveTheme,applyTheme,removeTheme,recommendedColors,recommendationKeys,undoRecommendation} from '../lib/life/appearance.ts';
import {handleLife} from '../lib/life/service.ts';

function bootstrap(storage){const values={},style={setProperty:(k,v)=>values[k]=v},dataset={};runInNewContext(appearanceBootstrap(),{localStorage:{getItem:()=>storage},document:{documentElement:{style,dataset}}});return {values,style,dataset};}
test('OLED is true black; both preset themes meet text and control contrast checks',()=>{
 assert.equal(palettes.oled.background,'#000000');assert.equal(palettes.oled.foreground,'#ffffff');
 for(const [name,colors] of Object.entries(palettes))assert.deepEqual(readability(colors).filter(c=>c.ratio<c.minimum),[],name);
 const css=readFileSync('app/life/theme.css','utf8'),vars=Object.fromEntries([...css.matchAll(/(--[a-z0-9-]+):([^;]+);/g)].map(m=>[m[1],m[2]]));for(const [key,value] of Object.entries(themeVariables(palettes.oled))){const resolved=vars[key]?.startsWith('var(')?vars[vars[key].slice(4,-1)]:vars[key];assert.equal(resolved,value,key);}
});
test('each theme keeps its overrides independently and unknown tokens or CSS injection are rejected',()=>{
 const appearance={mode:'light',custom:{light:{primary:'#224466'},oled:{card:'#123456'}}};
 assert.equal(themeColors(appearance).primary,'#224466');assert.equal(themeColors(appearance).card,palettes.light.card);
 assert.equal(themeColors({...appearance,mode:'oled'}).card,'#123456');assert.equal(themeColors({...appearance,mode:'oled'}).primary,palettes.oled.primary);
 for(const custom of [{primary:'url(https://evil.test)'},{background:'red;display:none'},{foreground:'#fff'},{position:'#ffffff'}])assert.equal(appearanceSchema.safeParse({...defaultAppearance(),custom:{oled:custom,light:{}}}).success,false);
 assert.equal(appearanceSchema.safeParse(appearance).success,true);
});
test('pre-paint bootstrap is self-contained, validates cached colors and applies every shared token',()=>{
 const value={mode:'light',custom:{oled:{},light:{primary:'#224466',background:'</script><script>bad()</script>',unknown:'#ffffff'}}};
 const r=bootstrap(JSON.stringify(value));assert.equal(r.style.colorScheme,'light');assert.equal(r.dataset.theme,'light');
 assert.deepEqual(r.values,themeVariables({...palettes.light,primary:'#224466'}));
 for(const invalid of ['garbage','null','{}','{"mode":"__proto__"}','{"mode":"constructor"}'])assert.deepEqual(bootstrap(invalid).values,{});
 assert.doesNotThrow(()=>runInNewContext(appearanceBootstrap(),{localStorage:{getItem(){throw Error('storage disabled');}}}));
 assert.equal(Object.keys(r.values).some(k=>k.includes('unknown')),false);
});
test('custom low-contrast choices are reported and map tokens remain independently configurable',()=>{
 const custom={...palettes.oled,foreground:palettes.oled.card,input:palettes.oled.inputBackground};
 const failed=readability(custom).filter(c=>c.ratio<c.minimum);assert.ok(failed.some(c=>c.label==='Text on cards'));assert.ok(failed.some(c=>c.label==='Input outline'));
 assert.ok(colorKeys.includes('muscleLow'));assert.equal(themeVariables({...palettes.light,muscleLow:'#123456'})['--muscle-low'],'#123456');
});

test('contrast checks retain stable identities and color dependencies after recovering from poor contrast',()=>{
 const good=readability(palettes.oled),bad=readability({...palettes.oled,foreground:palettes.oled.card});
 assert.deepEqual(good.map(c=>c.label),bad.map(c=>c.label));
 assert.ok(good.every(c=>c.colors.length===2&&c.colors.every(k=>colorKeys.includes(k))));
 const pair=bad.find(c=>c.label==='Text on cards');assert.equal(pair.ratio,1);assert.deepEqual(pair.colors,['foreground','card']);
 assert.ok(good.find(c=>c.label===pair.label).ratio>=pair.minimum);
 assert.ok(good.filter(c=>c.colors.includes('ring')).every(c=>c.minimum===3));
});
test('three named theme snapshots preserve colors independently of later edits, mode switching and replacement',()=>{
 const original=defaultAppearance();let value=saveTheme(original,1,'  Evening  ');
 value={...value,mode:'light',custom:{...value.custom,light:{primary:'#654321'}}};value=saveTheme(value,2,'Day');
 value={...value,custom:{...value.custom,light:{primary:'#abcdef'}}};value=saveTheme(value,3,'Sketch');
 assert.equal(value.savedThemes.length,3);assert.equal(value.savedThemes[0].name,'Evening');
 assert.deepEqual(themeColors(applyTheme(value,1)),palettes.oled);
 const applied=applyTheme(value,2);assert.equal(applied.mode,'light');assert.equal(themeColors(applied).primary,'#654321');
 applied.custom.light.primary='#000000';assert.equal(value.savedThemes[1].colors.primary,'#654321');
 const updated=saveTheme(value,2,'New day');assert.equal(updated.savedThemes.length,3);assert.equal(updated.savedThemes[1].colors.primary,'#abcdef');
 assert.equal(value.savedThemes[1].name,'Day');assert.deepEqual(original,defaultAppearance());
 assert.equal(removeTheme(value,2).savedThemes.length,2);assert.equal(removeTheme(value,2).custom,value.custom);
 assert.deepEqual(appearanceSchema.parse(value),value);assert.deepEqual(bootstrap(JSON.stringify(applyTheme(value,2))).values,themeVariables(themeColors(applyTheme(value,2))));
});
test('theme slots reject oversized, duplicate, incomplete or unsafe saved palettes while legacy profiles remain valid',()=>{
 const good=saveTheme(defaultAppearance(),1,'Theme'),theme=good.savedThemes[0];
 for(const savedThemes of [[theme,theme],[{...theme,slot:4}],[{...theme,slot:1.5}],[{...theme,name:' '}],[{...theme,name:'a'.repeat(41)}],[{...theme,colors:{primary:'#123456'}}],[{...theme,colors:{...theme.colors,evil:'#123456'}}],[{...theme,colors:{...theme.colors,card:'url(evil)'}}],[theme,{...theme,slot:2},{...theme,slot:3},{...theme,slot:4}]])assert.equal(appearanceSchema.safeParse({...good,savedThemes}).success,false);
 assert.equal(appearanceSchema.safeParse(defaultAppearance()).success,true);assert.equal(appearanceSchema.safeParse({...good,savedThemes:[]}).success,true);
});
test('optional recommendations repair text and controls without changing chart/map data colors',()=>{
 for(const mode of ['oled','light']){
  const base=palettes[mode];assert.deepEqual(recommendedColors(base,mode),base);
  const poor={...base,foreground:base.card,mutedForeground:base.card,input:base.inputBackground,ring:base.background,primaryForeground:base.primary};
  const before=structuredClone(poor),fixed=recommendedColors(poor,mode);
  assert.deepEqual(readability(fixed).filter(c=>c.ratio<c.minimum),[]);assert.deepEqual(poor,before);
  for(const key of colorKeys.filter(k=>k.startsWith('chart')||k.startsWith('muscle')))assert.equal(fixed[key],poor[key]);
  assert.deepEqual(recommendedColors(fixed,mode),fixed);
 }
 let state=42;const next=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return '#'+(state&0xffffff).toString(16).padStart(6,'0');};
 for(let i=0;i<40;i++){
  const colors=Object.fromEntries(colorKeys.map(key=>[key,next()])),mode=i%2?'light':'oled',fixed=recommendedColors(colors,mode);
  assert.deepEqual(readability(fixed).filter(c=>c.ratio<c.minimum),[],`palette ${i}`);
  assert.equal(appearanceSchema.safeParse({mode,custom:{oled:fixed,light:{}}}).success,true);
 }
});
test('undo recommendations restores exact overrides while retaining subsequent edits, slots and the other mode',()=>{
 const initial={...defaultAppearance(),custom:{oled:{foreground:'#0c0c0c',primaryForeground:'#eeeeee'},light:{card:'#eeeeee'}}};
 const recommendation={mode:'oled',before:{...initial.custom.oled},after:recommendedColors(themeColors(initial),'oled')};
 assert.ok(recommendationKeys(recommendation).length>=2);
 let preview={...initial,custom:{...initial.custom,oled:{...initial.custom.oled,...Object.fromEntries(recommendationKeys(recommendation).map(key=>[key,recommendation.after[key]]))}}};
 assert.deepEqual(undoRecommendation(preview,recommendation),initial);
 preview=saveTheme(preview,1,'Recommended');preview={...preview,mode:'light',custom:{...preview.custom,oled:{...preview.custom.oled,foreground:'#abcdef',chart1:'#456789'}}};
 const undone=undoRecommendation(preview,recommendation);
 assert.equal(undone.mode,'light');assert.deepEqual(undone.custom.light,initial.custom.light);assert.deepEqual(undone.savedThemes,preview.savedThemes);
 assert.equal(undone.custom.oled.foreground,'#abcdef');assert.equal(undone.custom.oled.chart1,'#456789');assert.equal(undone.custom.oled.primaryForeground,'#eeeeee');
});
test('appearance saves, exports and reconciles through the versioned account profile without changing other data',async t=>{
 const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+f,'utf8'));
 const db={prepare(sql){return {bind(...params){return {async first(){return raw.prepare(sql).get(...params)||null;},async all(){return {results:raw.prepare(sql).all(...params)};}};}};}};
 const call=(body,id='a',path='')=>handleLife(new Request('https://life.test/api/life'+path,{method:body?'POST':'GET',headers:{Origin:'https://life.test','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),id,db,new Date('2026-09-14T12:00:00Z'));
 const initial={goal:'Synthetic goal',timezone:'UTC',modules:['reflection'],habits:[],version:0};
 const old=(await (await call({action:'profile',profile:initial})).json()).profile;assert.equal(old.appearance,undefined);
 await call({action:'profile',profile:initial},'b');
 const appearance=saveTheme(saveTheme(saveTheme({mode:'light',custom:{light:{primary:'#224466'},oled:{}}},1,'Day'),2,'Backup'),3,'Alternate');
 const response=await call({action:'profile',profile:{...old,appearance}});assert.equal(response.status,200);const saved=(await response.json()).profile;assert.deepEqual(saved.appearance,appearance);assert.equal(saved.goal,old.goal);
 assert.equal((await call({action:'profile',profile:{...old,goal:'Stale change'}})).status,409);
 const invalid=await call({action:'profile',profile:{...saved,appearance:{...appearance,custom:{light:{primary:'url(evil)'},oled:{}}}}});assert.equal(invalid.status,400);
 assert.deepEqual((await (await call()).json()).profile.appearance,appearance);assert.equal((await (await call(undefined,'b')).json()).profile.appearance,undefined);
 const backup=await (await call(undefined,'a','?export=1')).json();assert.deepEqual(JSON.parse(backup.profile.payload).appearance,appearance);
 assert.equal(raw.prepare('SELECT COUNT(*) n FROM life_ai_usage').get().n,0);assert.equal(raw.prepare('SELECT COUNT(*) n FROM life_automatic_consent').get().n,0);
});
