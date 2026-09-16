import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {appearanceSchema,defaultAppearance,palettes,themePresets,applyPreset,activePreset,fontOptions,textScales,defaultTypography,typographyVariables,themeColors,themeVariables,appearanceBootstrap,contrast,readability,colorKeys,saveTheme,applyTheme,removeTheme,recommendedColors,recommendationKeys,undoRecommendation} from '../lib/life/appearance.ts';
import {handleLife} from '../lib/life/service.ts';

function bootstrap(storage){const values={},style={setProperty:(k,v)=>values[k]=v},dataset={};runInNewContext(appearanceBootstrap(),{localStorage:{getItem:()=>storage},document:{documentElement:{style,dataset}}});return {values,style,dataset};}
test('OLED is true black; both preset themes meet text and control contrast checks',()=>{
 assert.equal(palettes.oled.background,'#000000');assert.equal(palettes.oled.foreground,'#ffffff');
 for(const [name,colors] of Object.entries(palettes))assert.deepEqual(readability(colors).filter(c=>c.ratio<c.minimum),[],name);
 const css=readFileSync('app/life/theme.css','utf8'),vars=Object.fromEntries([...css.matchAll(/(--[a-z0-9-]+):([^;]+);/g)].map(m=>[m[1],m[2]]));for(const [key,value] of Object.entries(themeVariables(palettes.oled))){const resolved=vars[key]?.startsWith('var(')?vars[vars[key].slice(4,-1)]:vars[key];assert.equal(resolved,value,key);}
});
test('twelve built-in palettes provide complete, readable colors with distinct status and data roles',()=>{
 assert.equal(themePresets.length,12);assert.equal(new Set(themePresets.map(p=>p.id)).size,12);
 assert.equal(themePresets.filter(p=>p.mode==='oled').length,6);assert.equal(themePresets.filter(p=>p.mode==='light').length,6);
 assert.deepEqual(themePresets.map(p=>p.name),['OLED black','Graphite','Midnight','Forest','Plum','Ember','Light blue','Paper','Sand','Rose','Mint','Lavender']);
 for(const preset of themePresets){
  assert.ok(preset.description.length>0);assert.deepEqual(Object.keys(preset.colors).sort(),[...colorKeys].sort());
  assert.deepEqual(readability(preset.colors).filter(c=>c.ratio<c.minimum),[],preset.name);
  for(const status of ['success','warning','info','destructive'])for(const surface of ['background','card','popover','nav','inputBackground'])assert.ok(contrast(preset.colors[status],preset.colors[surface])>=4.5,`${preset.name}: ${status} on ${surface}`);
  assert.equal(new Set(['success','warning','info','destructive'].map(key=>preset.colors[key])).size,4);
  assert.equal(new Set(['chart1','chart2','chart3','chart4','chart5'].map(key=>preset.colors[key])).size,5);
  assert.equal(new Set(['muscleEmpty','muscleLow','muscleMid','muscleHigh'].map(key=>preset.colors[key])).size,4);
  assert.equal(appearanceSchema.safeParse(applyPreset(defaultAppearance(),preset.id)).success,true);
 }
});
test('applying a preset copies actual colors and preserves the other mode, type choices and saved slots',()=>{
 const original=saveTheme({...defaultAppearance(),typography:{font:'serif',scale:120},custom:{oled:{card:'#010203'},light:{card:'#abcdef'}}},1,'Saved');
 const before=structuredClone(original),presetsBefore=structuredClone(themePresets);
 for(const preset of themePresets){
  const applied=applyPreset(original,preset.id),other=preset.mode==='oled'?'light':'oled';
  assert.equal(applied.mode,preset.mode);assert.deepEqual(themeColors(applied),preset.colors);
  assert.deepEqual(applied.custom[other],original.custom[other]);assert.deepEqual(applied.typography,original.typography);assert.deepEqual(applied.savedThemes,original.savedThemes);
  assert.equal(activePreset(applied)?.id,preset.id);
  applied.custom[preset.mode].background='#123456';assert.equal(activePreset(applied),undefined);
 }
 assert.deepEqual(original,before);assert.deepEqual(themePresets,presetsBefore);
 assert.equal(activePreset(defaultAppearance())?.id,'oled');assert.equal(activePreset({...defaultAppearance(),mode:'light'})?.id,'light');
 const upper=applyPreset(defaultAppearance(),'plum');upper.custom.oled=Object.fromEntries(Object.entries(upper.custom.oled).map(([k,v])=>[k,v.toUpperCase()]));assert.equal(activePreset(upper)?.id,'plum');
 for(const id of ['missing','__proto__','constructor'])assert.equal(applyPreset(original,id),original);
});
test('typography allows only six local fonts and five finite numeric sizes; legacy profiles keep defaults',()=>{
 assert.deepEqual(defaultTypography(),{font:'system',scale:100});assert.deepEqual(textScales,[90,100,110,120,130]);
 assert.equal(fontOptions.length,6);assert.equal(new Set(fontOptions.map(option=>option.id)).size,6);
 for(const font of fontOptions)for(const scale of textScales){
  const typography={font:font.id,scale};assert.equal(appearanceSchema.safeParse({...defaultAppearance(),typography}).success,true);
  assert.deepEqual(typographyVariables(typography),{'--ui-font-family':font.stack,'--ui-text-scale':String(scale/100)});
  assert.doesNotMatch(font.stack,/url\(|https?:|[;<>]/);
 }
 for(const typography of [null,[],{},'serif',{font:'serif'},{scale:100},{font:'system',scale:'100'},{font:'system',scale:0},{font:'system',scale:100.5},{font:'system',scale:140},{font:'system',scale:NaN},{font:'system',scale:Infinity},{font:'__proto__',scale:100},{font:'constructor',scale:100},{font:'Arial;display:none',scale:100},{font:'url(https://evil.test/font)',scale:100},{font:'system',scale:100,stack:'url(evil)'}])assert.equal(appearanceSchema.safeParse({...defaultAppearance(),typography}).success,false,JSON.stringify(typography));
 assert.equal(appearanceSchema.safeParse(defaultAppearance()).success,true);
 assert.deepEqual(typographyVariables(),typographyVariables(defaultTypography()));
 assert.deepEqual(typographyVariables({font:'__proto__',scale:'130'}),typographyVariables());
 assert.deepEqual(typographyVariables({font:'mono',scale:-1}),typographyVariables({font:'mono',scale:100}));
 assert.deepEqual(typographyVariables({font:'constructor',scale:130}),typographyVariables({font:'system',scale:130}));
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
 assert.deepEqual(r.values,{...themeVariables({...palettes.light,primary:'#224466'}),...typographyVariables()});
 for(const invalid of ['garbage','null','{}','{"mode":"__proto__"}','{"mode":"constructor"}'])assert.deepEqual(bootstrap(invalid).values,typographyVariables());
 assert.doesNotThrow(()=>runInNewContext(appearanceBootstrap(),{localStorage:{getItem(){throw Error('storage disabled');}}}));
 assert.equal(Object.keys(r.values).some(k=>k.includes('unknown')),false);
});
test('pre-paint typography uses independent allowlists even when cached colors or mode are invalid',()=>{
 for(const font of fontOptions)for(const scale of textScales){
  const typography={font:font.id,scale};const r=bootstrap(JSON.stringify({mode:'oled',custom:{oled:{background:'red;display:none'}},typography}));
  assert.deepEqual(r.values,{...themeVariables(palettes.oled),...typographyVariables(typography)});
  assert.deepEqual(bootstrap(JSON.stringify({mode:'invalid',typography})).values,typographyVariables(typography));
 }
 for(const typography of [{font:'constructor',scale:Infinity},{font:'__proto__',scale:'130'},{font:'url(https://evil.test)',scale:'1;display:none'},null,[],{}])assert.deepEqual(bootstrap(JSON.stringify({typography})).values,typographyVariables());
 assert.deepEqual(bootstrap(JSON.stringify({typography:{font:'mono',scale:1000}})).values,typographyVariables({font:'mono',scale:100}));
 assert.deepEqual(bootstrap(JSON.stringify({typography:{font:'</script><script>bad()</script>',scale:120}})).values,typographyVariables({font:'system',scale:120}));
 const values={};runInNewContext(appearanceBootstrap(),{localStorage:{getItem(){throw Error('storage disabled');}},document:{documentElement:{style:{setProperty:(k,v)=>values[k]=v}}}});assert.deepEqual(values,typographyVariables());
 assert.doesNotMatch(appearanceBootstrap(),/<\/script/i);
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
 assert.deepEqual(appearanceSchema.parse(value),value);assert.deepEqual(bootstrap(JSON.stringify(applyTheme(value,2))).values,{...themeVariables(themeColors(applyTheme(value,2))),...typographyVariables()});
});
test('saved themes capture independent typography; legacy color snapshots retain the current font and size',()=>{
 const original={...defaultAppearance(),typography:{font:'mono',scale:110}};
 const saved=saveTheme(original,1,'Code');assert.deepEqual(saved.savedThemes[0].typography,original.typography);
 original.typography.scale=130;assert.equal(saved.savedThemes[0].typography.scale,110);
 const changed={...saved,typography:{font:'serif',scale:120}};
 const restored=applyTheme(changed,1);assert.deepEqual(restored.typography,{font:'mono',scale:110});
 restored.typography.font='rounded';assert.equal(saved.savedThemes[0].typography.font,'mono');
 assert.deepEqual(changed.typography,{font:'serif',scale:120});
 const legacy=structuredClone(changed);delete legacy.savedThemes[0].typography;
 assert.equal(appearanceSchema.safeParse(legacy).success,true);assert.deepEqual(applyTheme(legacy,1).typography,changed.typography);
 assert.deepEqual(saveTheme(defaultAppearance(),1,'Default').savedThemes[0].typography,defaultTypography());
 for(const typography of [{font:'remote',scale:100},{font:'sans',scale:'120'},{font:'sans',scale:NaN},{font:'sans',scale:120,css:'bad'}])assert.equal(appearanceSchema.safeParse({...changed,savedThemes:[{...changed.savedThemes[0],typography}]}).success,false);
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
 const appearance=saveTheme(saveTheme(saveTheme({...applyPreset(defaultAppearance(),'lavender'),typography:{font:'rounded',scale:120}},1,'Day'),2,'Backup'),3,'Alternate');
 const response=await call({action:'profile',profile:{...old,appearance}});assert.equal(response.status,200);const saved=(await response.json()).profile;assert.deepEqual(saved.appearance,appearance);assert.equal(saved.goal,old.goal);
 assert.equal((await call({action:'profile',profile:{...old,goal:'Stale change'}})).status,409);
 const invalid=await call({action:'profile',profile:{...saved,appearance:{...appearance,custom:{light:{primary:'url(evil)'},oled:{}}}}});assert.equal(invalid.status,400);
 for(const typography of [{font:'url(evil)',scale:100},{font:'system',scale:'130'},{font:'system',scale:100,css:'bad'}]){
  assert.equal((await call({action:'profile',profile:{...saved,appearance:{...appearance,typography}}})).status,400);
  assert.equal((await call({action:'profile',profile:{...saved,appearance:{...appearance,savedThemes:[{...appearance.savedThemes[0],typography}]}}})).status,400);
 }
 assert.deepEqual((await (await call()).json()).profile.appearance,appearance);assert.equal((await (await call(undefined,'b')).json()).profile.appearance,undefined);
 const backup=await (await call(undefined,'a','?export=1')).json();assert.deepEqual(JSON.parse(backup.profile.payload).appearance,appearance);
 assert.equal(raw.prepare('SELECT COUNT(*) n FROM life_ai_usage').get().n,0);assert.equal(raw.prepare('SELECT COUNT(*) n FROM life_automatic_consent').get().n,0);
});
