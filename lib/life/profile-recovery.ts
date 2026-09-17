import {profileSchema,type Profile} from './domain.ts';

function stable(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>JSON.stringify(key)+':'+stable(v)).join(',')+'}';
 return JSON.stringify(value)??'undefined';
}
export function sameProfileValues(first:Profile,second:Profile):boolean {
 const a={...profileSchema.parse(first),version:0},b={...profileSchema.parse(second),version:0};
 return stable(a)===stable(b);
}
export function profileSaveAcknowledged(submitted:Profile,saved:Profile|null):boolean {
 return !!saved&&saved.version>submitted.version&&sameProfileValues(submitted,saved);
}

const sectionNames:Record<string,string>={goal:'main goal',appearance:'appearance',annualFund:'annual bills fund',budgetGoals:'budget goals',analysisGuidance:'saved guidance',reviewPreferences:'analysis preferences',timezone:'timezone',timezoneMode:'timezone mode',moduleGoals:'section goals',spiritualTradition:'tradition',modules:'enabled sections',habits:'habits'};
// Rebase only after an explicit user choice. Untouched sections follow the
// current account; edited sections remain in the local form for review.
export function reviewProfileChanges(base:Profile,draft:Profile,saved:Profile):{draft:Profile;conflicts:string[]} {
 const next={...saved} as Record<string,unknown>,conflicts:string[]=[];
 for(const key of Object.keys(sectionNames)){
  const before=(base as Record<string,unknown>)[key],local=(draft as Record<string,unknown>)[key],remote=(saved as Record<string,unknown>)[key];
  if(stable(local)===stable(before))continue;
  if(stable(remote)!==stable(before)&&stable(remote)!==stable(local))conflicts.push(sectionNames[key]);
  if(key==='habits'||key==='analysisGuidance'){
   const previous=(before||[]) as {id:string}[],own=(local||[]) as {id:string}[],current=(remote||[]) as {id:string}[];
   next[key]=current.flatMap(item=>{
    const old=previous.find(row=>row.id===item.id),edited=own.find(row=>row.id===item.id);
    if(!old)return [item];
    if(!edited)return key==='habits'?[item]:[];
    return [stable(edited)===stable(old)?item:edited];
   }).concat(own.filter(item=>!current.some(row=>row.id===item.id)&&(!previous.some(row=>row.id===item.id)||stable(item)!==stable(previous.find(row=>row.id===item.id)))));
  }else next[key]=local;
 }
 return {draft:profileSchema.parse(next),conflicts};
}
