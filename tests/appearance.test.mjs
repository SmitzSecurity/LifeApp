import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {appearanceSchema,defaultAppearance,palettes,themeColors,themeVariables,appearanceBootstrap,readability,colorKeys} from '../lib/life/appearance.ts';
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
test('appearance saves, exports and reconciles through the versioned account profile without changing other data',async t=>{
 const raw=new DatabaseSync(':memory:');t.after(()=>raw.close());for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())raw.exec(readFileSync('drizzle/'+f,'utf8'));
 const db={prepare(sql){return {bind(...params){return {async first(){return raw.prepare(sql).get(...params)||null;},async all(){return {results:raw.prepare(sql).all(...params)};}};}};}};
 const call=(body,id='a',path='')=>handleLife(new Request('https://life.test/api/life'+path,{method:body?'POST':'GET',headers:{Origin:'https://life.test','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),id,db,new Date('2026-09-14T12:00:00Z'));
 const initial={goal:'Synthetic goal',timezone:'UTC',modules:['reflection'],habits:[],version:0};
 const old=(await (await call({action:'profile',profile:initial})).json()).profile;assert.equal(old.appearance,undefined);
 await call({action:'profile',profile:initial},'b');
 const appearance={mode:'light',custom:{light:{primary:'#224466'},oled:{}}};
 const response=await call({action:'profile',profile:{...old,appearance}});assert.equal(response.status,200);const saved=(await response.json()).profile;assert.deepEqual(saved.appearance,appearance);assert.equal(saved.goal,old.goal);
 assert.equal((await call({action:'profile',profile:{...old,goal:'Stale change'}})).status,409);
 const invalid=await call({action:'profile',profile:{...saved,appearance:{...appearance,custom:{light:{primary:'url(evil)'},oled:{}}}}});assert.equal(invalid.status,400);
 assert.deepEqual((await (await call()).json()).profile.appearance,appearance);assert.equal((await (await call(undefined,'b')).json()).profile.appearance,undefined);
 const backup=await (await call(undefined,'a','?export=1')).json();assert.deepEqual(JSON.parse(backup.profile.payload).appearance,appearance);
 assert.equal(raw.prepare('SELECT COUNT(*) n FROM life_ai_usage').get().n,0);assert.equal(raw.prepare('SELECT COUNT(*) n FROM life_automatic_consent').get().n,0);
});
