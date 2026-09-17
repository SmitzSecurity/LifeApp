import type {Routine,Saved} from './modules.ts';

// Only an explicit Save as new action creates a new identity. Freeze the result
// before saving so an unknown outcome retries this same program and exercises.
export function copyRoutineDraft(draft:Saved<Routine>,name=`${draft.data.name.slice(0,93)} (copy)`):Saved<Routine>{
 return {id:crypto.randomUUID(),version:0,data:{...structuredClone(draft.data),name,archived:false,exercises:draft.data.exercises.map(exercise=>({...structuredClone(exercise),id:crypto.randomUUID()}))}};
}
