import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {exerciseArtCatalog,exerciseSymbol} from '../lib/life/exercise-symbols.ts';
import {sanitizeExerciseSvg,alignExercisePair,alignRasterExercisePair} from '../scripts/import-exercise-art.mjs';

test('exercise illustrations use bounded exact aliases without fabricating custom variants',()=>{
 assert.equal(exerciseSymbol('  INCLINE DB PRESS  ')?.slug,'incline-dumbbell-press');
 assert.equal(exerciseSymbol('Romanian deadlifts')?.slug,'romanian-deadlift');
 assert.equal(exerciseSymbol('Single-leg Romanian deadlift'),null);
 assert.equal(exerciseSymbol('Bench press with my special machine'),null);
 assert.equal(exerciseSymbol('__proto__'),null);
 assert.equal(exerciseSymbol('constructor'),null);
 for(const selection of exerciseArtCatalog)for(const name of selection.names){
  const art=exerciseSymbol(name);assert.ok(art,name);
  assert.ok(art.frames.every(path=>/^\/exercise-art\/[a-z0-9-]+\.(svg|png)$/.test(path)),name);
  assert.equal(art.src,art.frames[0]);
 }
});
test('every shipped illustration retains source, license and verifiable content hashes',async()=>{
 const attribution=JSON.parse(await readFile('public/exercise-art/ATTRIBUTION.json','utf8'));
 for(const selection of exerciseArtCatalog){
  const art=exerciseSymbol(selection.names[0]);
  for(const path of art.frames){
   const record=attribution.assets.find(asset=>'/exercise-art/'+asset.localFile===path);
   assert.ok(record,path);assert.equal(record.adaptationLicense,'CC BY-SA 4.0');
   assert.match(record.sourceUrl,/^https:\/\/raw\.githubusercontent\.com\/(bryllim\/workout-guide|everkinetic\/data)\/[a-f0-9]{40}\//);
   assert.ok(record.attribution.creator);assert.ok(record.lifeAppChanges);
   const source=await readFile('public'+path);
   assert.equal(createHash('sha256').update(source).digest('hex'),record.localSha256,path);
   if(path.endsWith('.svg'))assert.doesNotMatch(source.toString('utf8'),/<(?:script|image|foreignObject|use|style)\b|\son\w+=|href=|url\(/i);
   else assert.equal((await sharp(source).metadata()).format,'png');
  }
  if(art.frames.length>1){
   const frames=await Promise.all(art.frames.map(path=>readFile('public'+path)));
   if(art.frames[0].endsWith('.svg'))assert.equal(new Set(frames.map(frame=>frame.toString('utf8').match(/viewBox="([^"]+)"/)[1])).size,1);
   else {const metadata=await Promise.all(frames.map(frame=>sharp(frame).metadata()));assert.equal(new Set(metadata.map(frame=>`${frame.width}x${frame.height}`)).size,1);}
   assert.notDeepEqual(frames[0],frames[1]);
  }
 }
});
test('SVG importer rejects executable, linked and entity content instead of retaining it',()=>{
 const wrapper=content=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50">${content}</svg>`;
 for(const content of ['<script>alert(1)</script>','<image href="https://example.test/private"/>','<path d="M0 0" onclick="alert(1)"/>','<path d="M0 0" fill="url(https://example.test/a)"/>','<foreignObject/>'])assert.throws(()=>sanitizeExerciseSvg(wrapper(content)));
 assert.throws(()=>sanitizeExerciseSvg('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///secret">]>'+wrapper('<path d="&x;"/>')));
 assert.match(sanitizeExerciseSvg(wrapper('<path fill="#fff" d="M10 10h10v10H10z"/>')),/fill="#fff"/);
});
test('motion pairs share one union viewBox and mismatched source canvases reject',async()=>{
 const svg=x=>`<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50"><rect width="50" height="50" fill="#fff"/><rect x="${x}" y="10" width="10" height="20" fill="#333"/></svg>`;
 const pair=await alignExercisePair([svg(5),svg(30)]);
 assert.equal(new Set(pair.frames.map(frame=>frame.match(/viewBox="([^"]+)"/)[1])).size,1);
 assert.ok(pair.bounds.x<=5);assert.ok(pair.bounds.x+pair.bounds.width>=40);
 await assert.rejects(()=>alignExercisePair([svg(5),svg(30).replace('0 0 50 50','0 0 100 50')]));
 const raster=await sharp(Buffer.from(svg(5))).png().toBuffer();
 const aligned=await alignRasterExercisePair([raster,raster],[{scale:1,dx:0,dy:0},{scale:1,dx:0,dy:0}]);
 assert.deepEqual(aligned.frames[0],aligned.frames[1]);
 await assert.rejects(()=>alignRasterExercisePair([raster,raster],[{scale:1,dx:0,dy:0},{scale:1,dx:3000,dy:0}]));
});
