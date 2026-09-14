import type {Database} from './service.ts';
import type {Transaction,Workout,Cardio,WorkoutNote,Saved} from './modules.ts';
import {addDays} from './analysis-periods.ts';
export type ActivityRecords={transactions:Saved<Transaction>[];workouts:Saved<Workout>[];cardio:Saved<Cardio>[];workoutNotes?:Saved<WorkoutNote>[]};
export async function readActivity(db:Database,userId:string,from:string,through:string):Promise<ActivityRecords>{
 const rows=await db.prepare("SELECT kind,resource_id,payload,version FROM life_resources WHERE user_id=?1 AND kind IN ('transaction','workout','cardio','workout-note') AND period>=?2 AND period<=?3 LIMIT 5001").bind(userId,from.slice(0,7),through.slice(0,7)).all<{kind:string;resource_id:string;payload:string;version:number}>();
 if(rows.results.length>5000)throw Error('This history needs a larger reporting window. No partial totals were produced.');
 const records=rows.results.map(r=>({kind:r.kind,id:r.resource_id,data:JSON.parse(r.payload),version:r.version})).filter(r=>!r.data.deleted&&r.data.date>=from&&r.data.date<=through);
 return {transactions:records.filter(r=>r.kind==='transaction'),workouts:[...records.filter(r=>r.kind==='workout'),...structuredNotes(records.filter(r=>r.kind==='workout-note'))],cardio:records.filter(r=>r.kind==='cardio'),workoutNotes:records.filter(r=>r.kind==='workout-note')};
}
export function activityTotals(records:ActivityRecords,from:string,through:string){
 const inWindow=(date:string)=>date>=from&&date<=through;
 const tx=records.transactions.filter(t=>inWindow(t.data.date)&&!t.data.voided&&!t.data.deleted),workouts=records.workouts.filter(w=>inWindow(w.data.date)&&!!w.data.finishedAt&&!w.data.deleted),cardio=records.cardio.filter(c=>inWindow(c.data.date)&&!c.data.voided&&!c.data.deleted);
 const total=(kind:Transaction['kind'])=>tx.filter(t=>t.data.kind===kind).reduce((sum,t)=>sum+t.data.amountCents,0);
 return {from,through,workoutNotes:(records.workoutNotes||[]).filter(n=>inWindow(n.data.date)&&!n.data.voided&&!n.data.deleted&&!n.data.structured).length,transactions:tx.length,spendingCents:total('expense'),incomeCents:total('income'),savingCents:total('saving')+total('investing'),strengthSessions:workouts.length,sets:workouts.reduce((sum,w)=>sum+w.data.sets.filter(s=>!s.warmup&&s.reps>0).length,0),cardioSessions:cardio.length,cardioMinutes:cardio.reduce((sum,c)=>sum+c.data.minutes,0),cardioKm:Math.round(cardio.reduce((sum,c)=>sum+(c.data.distance??0)*(c.data.unit==='mi'?1.609344:c.data.unit==='m'?.001:1),0)*100)/100};
}
export function activityTrends(records:ActivityRecords,today:string){return Array.from({length:4},(_,i)=>activityTotals(records,addDays(today,-27+i*7),addDays(today,-21+i*7)));}

// A confirmed written log is one atomic resource; its sets are projected once.
export function structuredNotes(notes:Saved<WorkoutNote>[]):Saved<Workout>[] {
 return notes.filter(n=>!n.data.deleted&&!n.data.voided&&n.data.structured).map(n=>({id:n.id,version:n.version,data:{...n.data.structured!,date:n.data.date,routineId:n.id,restUntil:null,finishedAt:n.data.date+'T12:00:00.000Z'}}));
}
