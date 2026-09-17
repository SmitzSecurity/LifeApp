// Explicit maintenance command only, never part of application/build requests.
import {mkdir,readFile,readdir,writeFile,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import sharp from 'sharp';
import {exerciseArtCatalog} from '../lib/life/exercise-symbols.ts';

const repository='https://github.com/bryllim/workout-guide',output=resolve('public/exercise-art');
const tags=new Set(['svg','g','path','rect','circle','ellipse','line','polyline','polygon']);
const attributes=new Set(['d','fill','fill-rule','clip-rule','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-miterlimit','transform','x','y','width','height','cx','cy','r','rx','ry','points','viewBox','xmlns']);
const digest=value=>createHash('sha256').update(value).digest('hex');
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function sanitizeExerciseSvg(source,{monochrome=true}={}){
 if(source.length>2000000||/<!DOCTYPE|<!ENTITY/i.test(source))throw Error('Unsupported SVG document.');
 const document=new DOMParser({onError:level=>{if(level!=='warning')throw Error('Invalid SVG.');}}).parseFromString(source,'image/svg+xml'),root=document.documentElement;
 if(root.tagName!=='svg')throw Error('Expected SVG root.');
 function clean(element){
  if(!tags.has(element.tagName)||element.namespaceURI!=='http://www.w3.org/2000/svg')throw Error('Unsupported SVG element: '+element.tagName);
  for(const attribute of Array.from(element.attributes)){
   if(!attributes.has(attribute.name)||(/url\s*\(|javascript:|data:|https?:/i.test(attribute.value)&&attribute.name!=='xmlns'))throw Error('Unsupported SVG attribute: '+attribute.name);
   if(attribute.name==='fill'||attribute.name==='stroke'){
    if(!(monochrome?/^(none|#fff(?:fff)?|white|currentColor)$/i:/^(none|#[a-f\d]{3,8}|white|black)$/i).test(attribute.value))throw Error('Unsupported SVG color.');
    if(monochrome)element.setAttribute(attribute.name,attribute.value.toLowerCase()==='none'?'none':'#fff');
   }
  }
  for(const child of Array.from(element.childNodes)){if(child.nodeType===1)clean(child);else element.removeChild(child);}
 }
 clean(root);
 const viewBox=root.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
 if(viewBox?.length!==4||viewBox.some(value=>!Number.isFinite(value))||viewBox[2]<=0||viewBox[3]<=0||viewBox[2]>4096||viewBox[3]>4096)throw Error('Invalid bounded SVG viewBox.');
 if(monochrome)root.setAttribute('fill','#fff');
 root.setAttribute('width',String(viewBox[2]));root.setAttribute('height',String(viewBox[3]));
 return new XMLSerializer().serializeToString(root);
}
export async function alignExercisePair(sources){
 const documents=sources.map(source=>new DOMParser().parseFromString(source,'image/svg+xml'));
 const viewBoxes=documents.map(document=>document.documentElement.getAttribute('viewBox'));
 if(new Set(viewBoxes).size!==1)throw Error('Motion frames must share the original canvas.');
 const original=viewBoxes[0].split(/[\s,]+/).map(Number);
 let left=Infinity,top=Infinity,right=-1,bottom=-1;
 for(const source of sources){
  const {data,info}=await sharp(Buffer.from(source)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
   const i=(y*info.width+x)*info.channels;
   if(data[i+info.channels-1]>8&&Math.min(data[i],data[i+1],data[i+2])<240){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  }
 }
 if(!Number.isFinite(left)||right<left)throw Error('Empty motion artwork.');
 const padding=Math.ceil(Math.max(right-left+1,bottom-top+1)*.035),bounds={x:Math.max(original[0],left-padding),y:Math.max(original[1],top-padding),width:0,height:0};
 bounds.width=Math.min(original[0]+original[2],right+1+padding)-bounds.x;
 bounds.height=Math.min(original[1]+original[3],bottom+1+padding)-bounds.y;
 return {bounds,frames:documents.map(document=>{const root=document.documentElement;root.setAttribute('viewBox',`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);root.removeAttribute('width');root.removeAttribute('height');return new XMLSerializer().serializeToString(root)+'\n';})};
}
export async function cropExerciseSvg(source){
 const {data,info}=await sharp(Buffer.from(source)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 let left=info.width,top=info.height,right=-1,bottom=-1;
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*info.channels+info.channels-1]>8){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
 if(right<left||bottom<top)throw Error('Empty artwork.');
 const padding=Math.ceil(Math.max(right-left+1,bottom-top+1)*.045),bounds={x:left-padding,y:top-padding,width:right-left+1+padding*2,height:bottom-top+1+padding*2};
 const document=new DOMParser().parseFromString(source,'image/svg+xml'),root=document.documentElement;
 root.setAttribute('viewBox',`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);root.removeAttribute('width');root.removeAttribute('height');
 return {svg:new XMLSerializer().serializeToString(root)+'\n',bounds};
}
export async function alignRasterExercisePair(sources,transforms){
 if(![1,2].includes(sources.length)||transforms.length!==sources.length)throw Error('Expected one or two raster frames with explicit alignment.');
 const canvas=1536,margin=256,aligned=[];
 for(let index=0;index<sources.length;index++){
  const {scale,dx,dy}=transforms[index],metadata=await sharp(sources[index],{limitInputPixels:4000000}).metadata();
  if(metadata.format!=='png'||!metadata.width||!metadata.height||scale<.8||scale>1.2||Math.abs(dx)>200||Math.abs(dy)>200)throw Error('Unsupported raster alignment.');
  const width=Math.round(metadata.width*scale),height=Math.round(metadata.height*scale),left=margin+Math.round(dx),top=margin+Math.round(dy);
  if(left<0||top<0||left+width>canvas||top+height>canvas)throw Error('Raster alignment exceeds canvas.');
  const image=await sharp(sources[index],{limitInputPixels:4000000}).resize(width,height).flatten({background:'#ffffff'}).png().toBuffer();
  aligned.push(await sharp({create:{width:canvas,height:canvas,channels:3,background:'#ffffff'}}).composite([{input:image,left,top}]).png().toBuffer());
 }
 let left=canvas,top=canvas,right=-1,bottom=-1;
 for(const source of aligned){
  const {data,info}=await sharp(source).raw().toBuffer({resolveWithObject:true});
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const i=(y*info.width+x)*info.channels;if(Math.min(data[i],data[i+1],data[i+2])<240){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
 }
 if(right<left)throw Error('Empty raster artwork.');
 const padding=Math.ceil(Math.max(right-left+1,bottom-top+1)*.035),bounds={left:Math.max(0,left-padding),top:Math.max(0,top-padding),width:0,height:0};
 bounds.width=Math.min(canvas,right+1+padding)-bounds.left;bounds.height=Math.min(canvas,bottom+1+padding)-bounds.top;
 return {bounds,frames:await Promise.all(aligned.map(source=>sharp(source).extract(bounds).png().toBuffer()))};
}
async function fetchText(url){const response=await fetch(url,{headers:{'User-Agent':'LifeApp artwork importer'}});if(!response.ok)throw Error(`Download failed ${response.status}: ${url}`);return response.text();}
async function fetchBytes(url){const response=await fetch(url,{headers:{'User-Agent':'LifeApp artwork importer'}});if(!response.ok)throw Error(`Download failed ${response.status}: ${url}`);return Buffer.from(await response.arrayBuffer());}
async function main(){
 await mkdir(output,{recursive:true});let previous=null;try{previous=JSON.parse(await readFile(resolve(output,'ATTRIBUTION.json'),'utf8'));}catch{}
 const argument=process.argv.find(value=>value.startsWith('--commit='));
 const commit=argument?.split('=')[1]??previous?.upstreamCommit??JSON.parse(await fetchText('https://api.github.com/repos/bryllim/workout-guide/commits/main')).sha;
 if(!/^[a-f0-9]{40}$/.test(commit))throw Error('Expected immutable upstream commit.');
 const raw=`https://raw.githubusercontent.com/bryllim/workout-guide/${commit}`;
 const manifestText=await fetchText(`${raw}/packages/workout-guide/manifest.json`),manifest=JSON.parse(manifestText);
 const selections=[...new Map(exerciseArtCatalog.map(entry=>[`${entry.slug}-${entry.frame}`,entry])).values()],staticSelections=selections.filter(selection=>!selection.motionId&&!selection.raster),assets=[];
 for(let offset=0;offset<staticSelections.length;offset+=5){
  const batch=await Promise.all(staticSelections.slice(offset,offset+5).map(async selection=>{
   if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(selection.slug))throw Error('Invalid asset slug.');
   const item=manifest.find(entry=>entry.slug===selection.slug),frame=item?.frames.find(frame=>frame.index===selection.frame);
   if(!frame||frame.path!==`assets/${selection.slug}/frame-${selection.frame}.svg`)throw Error('Missing exact artwork: '+selection.slug);
   const sourceUrl=`${raw}/packages/workout-guide/${frame.path}`,original=await fetchText(sourceUrl),{svg,bounds}=await cropExerciseSvg(sanitizeExerciseSvg(original));
   const localFile=`${selection.slug}-${selection.frame}.svg`;await writeFile(resolve(output,localFile),svg);
   return {localFile,exerciseNames:selection.names,catalogName:item.name,slug:selection.slug,frame:selection.frame,sourceUrl,upstreamSha256:digest(original),localSha256:digest(svg),inkViewBox:bounds,attribution:frame.attribution,catalogAttribution:item.attribution,lifeAppChanges:'Selected a static frame, retained geometry only, normalized opaque artwork to one white mask, and cropped the SVG viewBox around visible artwork with padding. Rendered as neutral ink on a light illustration canvas.',adaptationLicense:'CC BY-SA 4.0',adaptationLicenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/'};
  }));assets.push(...batch);console.log(`Imported ${assets.length}/${staticSelections.length} static illustrations.`);
 }
 const motionSelections=selections.filter(selection=>selection.motionId);
 const everkineticCommit=previous?.everkineticCommit??JSON.parse(await fetchText('https://api.github.com/repos/everkinetic/data/commits/main')).sha;
 if(!/^[a-f0-9]{40}$/.test(everkineticCommit))throw Error('Expected immutable Everkinetic commit.');
 for(const selection of motionSelections){
  if(!/^\d{4}$/.test(selection.motionId))throw Error('Invalid original artwork ID.');
  const phases=['relaxation','tension'],urls=phases.map(phase=>`https://raw.githubusercontent.com/everkinetic/data/${everkineticCommit}/dist/svg/${selection.motionId}-${phase}.svg`),originals=await Promise.all(urls.map(fetchText));
  const {frames,bounds}=await alignExercisePair(originals.map(source=>sanitizeExerciseSvg(source,{monochrome:false})));
  for(let index=0;index<phases.length;index++){
   const localFile=`everkinetic-${selection.motionId}-${phases[index]}.svg`;await writeFile(resolve(output,localFile),frames[index]);
   assets.push({localFile,exerciseNames:selection.names,catalogName:selection.names[0],slug:selection.slug,frame:phases[index],sourceUrl:urls[index],upstreamSha256:digest(originals[index]),localSha256:digest(frames[index]),inkViewBox:bounds,attribution:{creator:'Everkinetic (Greg Priday)',creatorUrl:'https://github.com/everkinetic/data',license:'CC BY-SA 4.0',licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/'},lifeAppChanges:'Retained original vector geometry and colors; selected the matching relaxation/tension poses; cropped both frames to one shared padded ink viewBox for aligned playback.',adaptationLicense:'CC BY-SA 4.0',adaptationLicenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/'});
  }
  console.log('Imported verified motion pair: '+selection.names[0]);
 }
 for(const selection of selections.filter(selection=>selection.raster)){
  const {source,offsets}=selection.raster;if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source))throw Error('Invalid original image name.');
  const urls=offsets.map((_,index)=>`https://raw.githubusercontent.com/everkinetic/data/${everkineticCommit}/src/images-web/${source}-${index+1}.png`),originals=await Promise.all(urls.map(fetchBytes));
  const transforms=offsets.map(offset=>({scale:1,...offset})),{frames,bounds}=await alignRasterExercisePair(originals,transforms);
  for(let index=0;index<frames.length;index++){
   const localFile=`everkinetic-${source}-${index+1}.png`;await writeFile(resolve(output,localFile),frames[index]);
   assets.push({localFile,exerciseNames:selection.names,catalogName:selection.names[0],slug:selection.slug,frame:index+1,sourceUrl:urls[index],upstreamSha256:digest(originals[index]),localSha256:digest(frames[index]),sharedImageBounds:bounds,registration:transforms[index],attribution:{creator:'Everkinetic (Greg Priday)',creatorUrl:'https://github.com/everkinetic/data',license:'CC BY-SA 4.0',licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/'},lifeAppChanges:frames.length>1?'Decoded original raster artwork into clean PNG, retained original scale and colors, translated the second frame to align stationary apparatus, and cropped both to the same padded canvas.':'Decoded original raster artwork into a clean PNG with a padded crop. Retained as a static image because the alternate pose changes scale and cannot be registered by translation.',adaptationLicense:'CC BY-SA 4.0',adaptationLicenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/'});
  }
  console.log(`Imported original raster artwork: ${selection.names[0]} (${frames.length} frame${frames.length===1?'':'s'})`);
 }
 const attribution={title:'LifeApp exercise artwork',repository,upstreamCommit:commit,everkineticCommit,manifestSha256:digest(manifestText),license:'CC BY-SA 4.0',licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/',copyright:'Copyright (c) 2026 Bryl Lim, except where asset attribution identifies Everkinetic upstream artwork.',upstreamProject:'Everkinetic, created by Greg Priday',upstreamProjectUrl:'https://github.com/everkinetic/data',assets};
 await writeFile(resolve(output,'ATTRIBUTION.json'),JSON.stringify(attribution,null,2)+'\n');
 await writeFile(resolve(output,'LICENSE-CC-BY-SA-4.0.txt'),await fetchText('https://creativecommons.org/licenses/by-sa/4.0/legalcode.txt'));
 const notice=`# Exercise artwork credits\n\nIllustrations from [Workout Guide by Bryl Lim](${repository}) and original [Everkinetic artwork, created by Greg Priday](https://github.com/everkinetic/data). Copyright (c) 2026 Bryl Lim for Workout Guide additions, except where per-asset records identify original Everkinetic artwork.\n\nArtwork and LifeApp adaptations are licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), separately from LifeApp application code. No endorsement is implied. Artwork is provided without warranties; see the included license.\n\nLifeApp retains only geometry from SVG assets and decodes original PNGs into clean raster images. Raster motion frames use verified translation offsets against stationary apparatus, at their original scale, followed by one shared padded crop. Static Workout Guide illustrations are opaque monochrome masks with cropped, padded viewBoxes. Original Everkinetic start/end pairs preserve their colors and share one padded viewBox to keep playback aligned. The JSON retains creators, original source URLs, prior modifications, frame selections and file hashes. Adaptations remain available under CC BY-SA 4.0 without additional restrictions.\n\nPinned Workout Guide commit: ${commit}. Pinned Everkinetic commit: ${everkineticCommit}. See [per-asset attribution](ATTRIBUTION.json) and [full license](LICENSE-CC-BY-SA-4.0.txt).\n`;
 await writeFile(resolve(output,'ATTRIBUTION.md'),notice);
 const rows=assets.map(asset=>`<li><strong>${escape(asset.catalogName)}</strong> — ${escape(asset.frame)}. Creator: ${escape(asset.attribution.creator)}. <a href="${escape(asset.sourceUrl)}">Original source</a>${asset.attribution.source?`; derived from <a href="${escape(asset.attribution.source.url)}">${escape(asset.attribution.source.name)}</a>. Prior changes: ${escape(asset.attribution.source.changes)}`:'.'} ${escape(asset.lifeAppChanges)} <a href="${escape(asset.localFile)}">LifeApp artwork</a>.</li>`).join('\n');
 const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Exercise artwork credits · LifeApp</title><style>:root{color-scheme:light dark}body{font-family:system-ui,sans-serif;line-height:1.6;max-width:56rem;margin:2rem auto;padding:0 1.25rem}a{color:LinkText}li{margin:.8rem 0}code{overflow-wrap:anywhere}</style><main><h1>Exercise artwork credits</h1><p>Original artwork from <a href="https://github.com/everkinetic/data">Everkinetic, created by Greg Priday</a>, and illustrations by <a href="https://bryllim.com">Bryl Lim</a> from <a href="${repository}">Workout Guide</a>. Copyright © 2026 Bryl Lim for Workout Guide additions, except where per-asset records identify original Everkinetic artwork.</p><p>Artwork and LifeApp adaptations are available under <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>. No endorsement is implied. Artwork is provided without warranties; <a href="LICENSE-CC-BY-SA-4.0.txt">read the full license</a>. These notices apply to artwork, separately from LifeApp application code.</p><p>LifeApp retains only geometry from SVG assets and decodes original PNGs into clean raster images. Raster motion frames use verified translation offsets against stationary apparatus, at their original scale, followed by one shared padded crop. Static Workout Guide illustrations use opaque monochrome masks and padded cropped viewBoxes. Original Everkinetic start/end drawings retain their original colors and use one shared padded viewBox for aligned playback. Each record includes the exact changes and original source.</p><p>Pinned versions: <a href="${repository}/tree/${commit}">Workout Guide</a> and <a href="https://github.com/everkinetic/data/tree/${everkineticCommit}">Everkinetic</a>. <a href="ATTRIBUTION.json">Full attribution and file hashes</a>.</p><ul>${rows}</ul></main></html>\n`;
 await writeFile(resolve(output,'credits.html'),html);
 const retained=new Set(assets.map(asset=>asset.localFile));
 for(const file of await readdir(output))if(/^[a-z0-9-]+\.(svg|png)$/.test(file)&&!retained.has(file)){
  const target=resolve(output,file);if(!target.startsWith(output+'\\')&&!target.startsWith(output+'/'))throw Error('Unsafe generated asset path.');await unlink(target);
 }
 console.log('Pinned source: '+commit);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
