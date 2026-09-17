import test from 'node:test';
import assert from 'node:assert/strict';
import {exerciseGuide} from '../lib/life/exercise-guides.ts';
import {exercisePresets} from '../lib/life/exercise-presets.ts';

test('presets open verified guides or explicitly labelled searches through HTTPS',()=>{
 const fallback=[];
 for(const {name} of exercisePresets){
  const guide=exerciseGuide(name);
  assert.ok(guide,name);
  const url=new URL(guide.url);
  assert.equal(url.protocol,'https:',name);
  assert.equal(url.username,'');
  assert.equal(url.password,'');
  assert.ok(guide.provider&&guide.label,name);
  if(guide.isSearch){
   fallback.push(name);
   assert.equal(guide.provider,'Web search');
   assert.match(guide.label,/^Find /);
   assert.equal(url.searchParams.get('q'),`${name} exercise technique video`);
  }
 }
 assert.deepEqual(fallback,['Medium-grip lat pulldown','Neutral-grip lat pulldown','Chest-supported high row']);
});

test('known aliases resolve without erasing equipment or assistance distinctions',()=>{
 assert.equal(exerciseGuide('RDLs').url,exerciseGuide('Romanian deadlift').url);
 assert.equal(exerciseGuide('Dumbbell RDL').url,exerciseGuide('Dumbbell Romanian deadlift').url);
 assert.notEqual(exerciseGuide('RDL').url,exerciseGuide('Dumbbell RDL').url);
 assert.notEqual(exerciseGuide('Assisted dip').url,exerciseGuide('Seated dip machine').url);
 assert.notEqual(exerciseGuide('Assisted neutral-grip chin-up').url,exerciseGuide('Neutral-grip chin-up').url);
 assert.equal(exerciseGuide('Cable lateral raises').url,exerciseGuide('Cable lateral raise').url);
});

test('unsupported grip variants and custom exercises never silently link a different exercise',()=>{
 for(const name of ['Lat pulldown (Mag/Medium Grip)','Medium/Neutral-Grip Lat Pulldown','Chest-supported high row (machine)','Single leg RDL','Incline smith machine bench press']){
  const guide=exerciseGuide(name);
  assert.equal(guide.isSearch,true,name);
  assert.ok(new URL(guide.url).searchParams.get('q').includes(name),name);
 }
});

test('custom names are query text, never a navigable scheme or arbitrary destination',()=>{
 const guide=exerciseGuide('  javascript:alert(1) & x=https://example.com/#fragment  ');
 assert.equal(new URL(guide.url).origin,'https://www.google.com');
 assert.equal(new URL(guide.url).searchParams.get('q'),'javascript:alert(1) & x=https://example.com/#fragment exercise technique video');
 assert.equal(exerciseGuide('  \n '),null);
});
