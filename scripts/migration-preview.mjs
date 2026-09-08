import {open,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {MAX_BACKUP_BYTES,MigrationValidationError,previewMigration} from '../lib/life/migration-preview.ts';

async function readBounded(path){
 const file=await open(path,'r');
 try{
  const stat=await file.stat();
  if(!stat.isFile()||stat.size>MAX_BACKUP_BYTES)throw new MigrationValidationError('too_large_or_not_file','backup');
  const bytes=Buffer.alloc(MAX_BACKUP_BYTES+1);let total=0;
  while(total<bytes.length){const {bytesRead}=await file.read(bytes,total,bytes.length-total,null);if(!bytesRead)break;total+=bytesRead;}
  if(total>MAX_BACKUP_BYTES)throw new MigrationValidationError('too_large','backup');
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,total));
 }finally{await file.close();}
}
try{
 const args=process.argv.slice(2),source=args.shift();
 if(!source||source.startsWith('--'))throw Error('usage');
 const options={};for(let i=0;i<args.length;i+=2){const key=args[i];if(!['--target','--out'].includes(key)||!args[i+1]||Object.hasOwn(options,key))throw Error('usage');options[key]=args[i+1];}
 const sourceText=await readBounded(source),targetText=options['--target']?await readBounded(options['--target']):undefined;
 const preview=await previewMigration(sourceText,targetText),output=JSON.stringify(preview,null,2)+'\n';
 if(options['--out']){
  if([source,options['--target']].filter(Boolean).some(p=>resolve(p)===resolve(options['--out'])))throw Error('unsafe_output');
  await writeFile(options['--out'],output,{flag:'wx',mode:0o600});
  console.log('Migration preview saved. No data was imported.');
 }else process.stdout.write(output);
 if(preview.comparison?.conflicts)process.exitCode=2;
}catch(error){
 if(error instanceof MigrationValidationError)console.error(error.message);
 else console.error('Could not prepare preview. Use: npm run migration:preview -- SOURCE.json [--target TARGET.json] [--out NEW_REPORT.json]. Files must be readable UTF-8; an output file must be new.');
 process.exitCode=1;
}
