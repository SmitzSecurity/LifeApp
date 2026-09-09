import type { Entry } from './domain.ts';
export type SyncStatus='saved'|'waiting'|'saving'|'error';
type Change=(entry:Entry,status:SyncStatus,error:string)=>void;
// A single writer per open entry. Edits made during a request stay local until the
// prior revision is acknowledged. Ambiguous failures retry the exact mutation ID.
export class DraftSync {
 private latest:Entry;private sequence=0;private acknowledged=0;
 private pending:{entry:Entry;sequence:number;mutationId:string}|null=null;
 private running:Promise<void>|null=null;
 private save:(entry:Entry,mutationId:string)=>Promise<Entry>;
 private changed:Change;
 status:SyncStatus='saved';error='';
 constructor(initial:Entry,save:(entry:Entry,mutationId:string)=>Promise<Entry>,changed:Change){this.latest=initial;this.save=save;this.changed=changed;}
 get dirty(){return this.sequence!==this.acknowledged||!!this.pending;}
 get entry(){return this.latest;}
 edit(entry:Entry){this.latest={...entry,version:this.latest.version};this.sequence++;if(this.status!=='error')this.status=this.running?'saving':'waiting';this.changed(this.latest,this.status,this.error);}
 async commit(complete:boolean){
  // Resolve an ambiguous earlier submission with its original mutation first.
  if(this.pending||this.running)await this.flush();
  if(this.latest.complete!==complete)this.edit({...this.latest,complete});
  await this.flush();
 }
 flush():Promise<void>{if(this.running)return this.running;this.running=this.run().finally(()=>{this.running=null;});return this.running;}
 private async run(){
  while(this.dirty){
   this.pending??={entry:structuredClone(this.latest),sequence:this.sequence,mutationId:crypto.randomUUID()};
   const sent=this.pending;this.status='saving';this.error='';this.changed(this.latest,this.status,'');
   try{
    const saved=await this.save(sent.entry,sent.mutationId);
    this.acknowledged=sent.sequence;this.pending=null;
    this.latest=this.sequence===sent.sequence?saved:{...this.latest,version:saved.version};
    this.status=this.dirty?'waiting':'saved';this.changed(this.latest,this.status,'');
   }catch(e){this.status='error';this.error=(e as Error).message||'Draft sync failed.';this.changed(this.latest,this.status,this.error);throw e;}
  }
 }
}
