import {Inflate} from 'fflate';
import {DOMParser,type Element as XmlElement,type Node as XmlNode} from '@xmldom/xmldom';
import {BUDGET_TEXT_LIMIT,BUDGET_INPUT_BYTES,type BudgetImage} from '../../lib/life/budget-build-schema.ts';
import {budgetImageDimensions} from '../../lib/life/budget-image.ts';

export const BUDGET_FILE_ACCEPT='.txt,.md,.csv,.tsv,.json,.xlsx,.docx,.pdf,.jpg,.jpeg,.png,.webp';
export type BudgetAttachment={name:string;kind:string;size:number;text?:string;image?:BudgetImage;document?:{mimeType:'application/pdf';data:string};warnings:string[]};
const FILE_LIMIT=8_000_000,PDF_LIMIT=4_000_000,XML_LIMIT=8_000_000,EXPANDED_LIMIT=24_000_000;
const utf8=new TextDecoder('utf-8',{fatal:true});
const badDocument=()=>Error('This document is damaged, encrypted or unsupported. Export it as a new .xlsx, .docx, PDF or text file.');
function checkedText(text:string){
 if(!text.trim())throw Error('This file has no readable text. For a scanned document, attach a PDF or image instead.');
 if(text.length>BUDGET_TEXT_LIMIT||new TextEncoder().encode(text).length>BUDGET_INPUT_BYTES)throw Error('This file contains too much text. Export only the sheets or pages with your budget (up to 500,000 characters).');
 return text;
}
function decodeText(data:Uint8Array){
 let text:string;
 try{text=data[0]===255&&data[1]===254?new TextDecoder('utf-16le',{fatal:true}).decode(data):data[0]===254&&data[1]===255?new TextDecoder('utf-16be',{fatal:true}).decode(data):utf8.decode(data);}catch{throw Error('This text file uses an unsupported encoding. Save it as UTF-8 and attach it again.');}
 if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))throw Error('This is not a readable text file. Export it as UTF-8 text, CSV, XLSX, DOCX or PDF.');
 return text;
}
function base64(bytes:Uint8Array){let result='';for(let i=0;i<bytes.length;i+=32768)result+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(result);}
function crc32(bytes:Uint8Array){let crc=-1;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^-1)>>>0;}

// Read only bounded OOXML parts, never extract paths onto disk. Validate the central
// directory first, then stream each deflate payload in small chunks so forged size
// metadata cannot cause unbounded allocation. No macros or external links execute.
function officeParts(bytes:Uint8Array,kind:'xlsx'|'docx'){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u16=(p:number)=>view.getUint16(p,true),u32=(p:number)=>view.getUint32(p,true);
 let end=-1;for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(u32(p)===0x06054b50&&p+22+u16(p+20)===bytes.length){end=p;break;}
 if(end<0||u16(end+4)||u16(end+6)||u16(end+8)!==u16(end+10)||u16(end+10)>1000)throw badDocument();
 const count=u16(end+10),centralSize=u32(end+12),centralStart=u32(end+16);if(!count||centralStart+centralSize!==end)throw badDocument();
 let cursor=centralStart,total=0;const entries=new Map<string,{offset:number;size:number;compressed:number;method:number;crc:number;flags:number}>();
 for(let i=0;i<count;i++){
  if(cursor+46>end||u32(cursor)!==0x02014b50)throw badDocument();
  const flags=u16(cursor+8),method=u16(cursor+10),compressed=u32(cursor+20),size=u32(cursor+24),nameLength=u16(cursor+28),extraLength=u16(cursor+30),commentLength=u16(cursor+32),offset=u32(cursor+42),next=cursor+46+nameLength+extraLength+commentLength;
  if(next>end||flags&1||flags&64||![0,8].includes(method)||size>XML_LIMIT||compressed>FILE_LIMIT||offset>=centralStart)throw badDocument();
  const name=utf8.decode(bytes.subarray(cursor+46,cursor+46+nameLength));
  if(entries.has(name)||name.startsWith('/')||name.includes('\\')||name.split('/').includes('..'))throw badDocument();
  total+=size;if(total>EXPANDED_LIMIT)throw Error('This document expands to too much data. Export just the budget as CSV, text or PDF.');
  if(/(?:vbaProject\.bin|macros\/)/i.test(name))throw Error('Macro-enabled documents are not supported. Export the budget as XLSX without macros, CSV or PDF.');
  entries.set(name,{offset,size,compressed,method,crc:u32(cursor+16),flags});cursor=next;
 }
 if(cursor!==end)throw badDocument();
 const wanted=(name:string)=>kind==='xlsx'?/^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(name):/^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(name);
 const parts=new Map<string,string>();
 for(const [name,e]of entries){
  if(!wanted(name))continue;
  const p=e.offset;if(p+30>centralStart||u32(p)!==0x04034b50||u16(p+6)!==e.flags||u16(p+8)!==e.method)throw badDocument();
  const nameLength=u16(p+26),start=p+30+nameLength+u16(p+28);if(start+e.compressed>centralStart||utf8.decode(bytes.subarray(p+30,p+30+nameLength))!==name)throw badDocument();
  let extracted:Uint8Array;
  if(e.method===0){if(e.size!==e.compressed)throw badDocument();extracted=bytes.subarray(start,start+e.compressed);}
  else{
   let length=0;const chunks:Uint8Array[]=[];const stream=new Inflate(chunk=>{length+=chunk.length;if(length>e.size||length>XML_LIMIT)throw badDocument();chunks.push(chunk);});
   for(let at=start;at<start+e.compressed;at+=512)stream.push(bytes.subarray(at,Math.min(at+512,start+e.compressed)),at+512>=start+e.compressed);
   if(length!==e.size)throw badDocument();extracted=new Uint8Array(length);let at=0;for(const chunk of chunks){extracted.set(chunk,at);at+=chunk.length;}
  }
  if(extracted.length!==e.size||crc32(extracted)!==e.crc)throw badDocument();
  parts.set(name,decodeText(extracted));
 }
 return parts;
}
function xml(text:string|undefined){
 if(!text||/<!DOCTYPE|<!ENTITY/i.test(text))throw badDocument();
 let tags=0;for(let at=text.indexOf('<');at>=0;at=text.indexOf('<',at+1))if(++tags>200_000)throw Error('This document has too much formatting. Export just the budget as text, CSV or PDF.');
 try{return new DOMParser({onError:()=>{throw badDocument();}}).parseFromString(text,'application/xml');}catch{throw badDocument();}
}
const descendants=(node:XmlElement|ReturnType<typeof xml>,name:string)=>Array.from(node.getElementsByTagNameNS('*',name));
const children=(node:XmlNode)=>Array.from(node.childNodes).filter(n=>n.nodeType===1) as XmlElement[];
const texts=(node:XmlElement)=>descendants(node,'t').map(n=>n.textContent||'').join('');
function wordText(node:XmlNode):string{
 if(node.nodeType!==1)return '';const e=node as XmlElement;
 if(e.localName==='t')return e.textContent||'';
 if(e.localName==='tab')return '\t';if(['br','cr'].includes(e.localName||''))return '\n';
 // Field instructions and deleted revision text are not visible document content.
 if(['instrText','del','delText'].includes(e.localName||''))return '';
 const content=children(e).map(wordText).join('');
 if(e.localName==='tc')return content.trimEnd()+'\t';
 if(e.localName==='tr')return content.trimEnd()+'\n';
 return content+(e.localName==='p'?'\n':'');
}
function extractDocx(parts:Map<string,string>){
 const main=xml(parts.get('word/document.xml'));if(main.documentElement?.localName!=='document')throw badDocument();
 const sections=[wordText(main.documentElement)];
 for(const [name,part]of parts)if(name!=='word/document.xml'){const doc=xml(part);sections.push(`[${name.split('/').pop()}]\n${wordText(doc.documentElement!)}`);}
 return {text:checkedText(sections.join('\n').trim()),warnings:['Document text and tables are included. Embedded images and objects are not read; use PDF when they contain budget details.']};
}
function extractXlsx(parts:Map<string,string>){
 const workbook=xml(parts.get('xl/workbook.xml')),rels=xml(parts.get('xl/_rels/workbook.xml.rels'));if(workbook.documentElement?.localName!=='workbook')throw badDocument();
 const relationships=new Map(descendants(rels,'Relationship').map(r=>[r.getAttribute('Id'),r]));
 const strings=parts.has('xl/sharedStrings.xml')?descendants(xml(parts.get('xl/sharedStrings.xml')),'si').map(texts):[];
 const styles=parts.has('xl/styles.xml')?xml(parts.get('xl/styles.xml')):null;
 const formats=new Map(styles?descendants(styles,'numFmt').map(f=>[Number(f.getAttribute('numFmtId')),f.getAttribute('formatCode')||'']):[]);
 const xfs=styles?descendants(styles,'cellXfs').flatMap(e=>children(e).filter(c=>c.localName==='xf')):[];
 const date1904=['1','true'].includes(descendants(workbook,'workbookPr')[0]?.getAttribute('date1904')||'');
 const sheets=descendants(workbook,'sheet');if(!sheets.length||sheets.length>100)throw badDocument();
 let formulas=0,uncached=0,totalCells=0;const sections:string[]=[];
 for(const sheet of sheets){
  const rel=relationships.get(sheet.getAttribute('r:id')||sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'));
  if(!rel||rel.getAttribute('TargetMode')==='External')throw badDocument();
  const target=rel.getAttribute('Target')||'',path=target.startsWith('/xl/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');
  if(!/^xl\/worksheets\/[^/]+\.xml$/.test(path))throw badDocument();
  const doc=xml(parts.get(path)),lines:string[]=[];
  for(const row of descendants(doc,'row')){
   const values:string[]=[];
   for(const cell of children(row).filter(c=>c.localName==='c')){
    if(++totalCells>100_000)throw Error('This spreadsheet has too many cells. Export only the budget sheets.');
    const address=cell.getAttribute('r')||'';if(!/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(address))throw badDocument();
    const type=cell.getAttribute('t'),raw=descendants(cell,'v')[0]?.textContent,formula=descendants(cell,'f')[0];let value=raw||'';
    if(type==='s'){const index=Number(raw);if(raw==null||!/^\d+$/.test(raw)||strings[index]===undefined)throw badDocument();value=strings[index];}
    else if(type==='inlineStr')value=texts(cell);
    else if(type==='b')value=raw==='1'?'TRUE':'FALSE';
    else if(raw&&(!type||type==='n')&&Number.isFinite(Number(raw))){
     const numFmtId=Number(xfs[Number(cell.getAttribute('s')||0)]?.getAttribute('numFmtId')||0),format=formats.get(numFmtId)||'';
     // Preserve actual calendar values rather than exposing Excel's serial number.
     if(numFmtId>=14&&numFmtId<=22||numFmtId>=45&&numFmtId<=47||/[ymd]/i.test(format.replace(/"[^"]*"|\\.|\[[^\]]*\]/g,''))){
      const serial=Number(raw),epoch=Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:30),date=new Date(epoch+serial*86400000);
      if(Number.isFinite(date.getTime()))value=date.toISOString().replace('T00:00:00.000Z','').replace('.000Z','Z');
     }else if(numFmtId===9||numFmtId===10||format.includes('%'))value=String(Number(raw)*100)+'%';
    }
    if(formula){formulas++;if(raw==null){uncached++;value='[Formula has no saved value; recalculate and save this workbook]';}}
    if(value!=='')values.push(`${address}: ${JSON.stringify(value)}`);
   }
   if(values.length)lines.push(values.join('\t'));
  }
  if(lines.length)sections.push(`[Sheet: ${sheet.getAttribute('name')||'Unnamed'}${sheet.getAttribute('state')?' ('+sheet.getAttribute('state')+')':''}]\n${lines.join('\n')}`);
 }
 if(!sections.length)throw Error('This spreadsheet has no readable cells. Export scanned or embedded budget images as PDF or an image.');
 const warnings=['All sheets are included, including hidden sheets. Embedded images and charts are not read.'];
 if(formulas)warnings.push('Formulas are not executed; only saved cell values are included.');
 if(uncached)throw Error(`${uncached} formula cell${uncached===1?' has':'s have'} no saved value. Open the workbook, recalculate and save it, or export the budget as CSV or PDF.`);
 return {text:checkedText(sections.join('\n\n')),warnings};
}

export async function prepareBudgetFile(file:File):Promise<BudgetAttachment>{
 const extension=file.name.split('.').pop()?.toLowerCase()||'',base={name:file.name,kind:extension.toUpperCase(),size:file.size,warnings:[] as string[]};
 if(['jpg','jpeg','png','webp'].includes(extension)||['image/jpeg','image/png','image/webp'].includes(file.type))return {...base,kind:'Image',image:await prepareImage(file)};
 if(!['txt','md','csv','tsv','json','xlsx','docx','pdf'].includes(extension))throw Error('Choose a text file (.txt, .md, .csv, .tsv, .json), Excel workbook (.xlsx), Word document (.docx), PDF, JPEG, PNG or WebP. Export older .xls/.doc files to one of these formats.');
 if(!file.size)throw Error('This file is empty.');
 if(file.size>(extension==='pdf'?PDF_LIMIT:FILE_LIMIT))throw Error(extension==='pdf'?'Choose a PDF under 4 MB. Export only its budget pages if needed.':'Choose a file under 8 MB. Export only the budget section if needed.');
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(extension==='pdf'){
  if(!new TextDecoder().decode(bytes.subarray(0,8)).startsWith('%PDF-')||!new TextDecoder().decode(bytes.subarray(-1024)).includes('%%EOF'))throw Error('This file is not a valid PDF. Export a fresh PDF and try again.');
  if(/\/Encrypt\b/.test(new TextDecoder('latin1').decode(bytes)))throw Error('Password-protected PDFs are not supported. Export an unlocked PDF or paste its budget text.');
  return {...base,kind:'PDF',document:{mimeType:'application/pdf',data:base64(bytes)}};
 }
 if(extension==='xlsx'||extension==='docx'){
  try{const parts=officeParts(bytes,extension);return {...base,...(extension==='xlsx'?extractXlsx(parts):extractDocx(parts))};}catch(e){if(e instanceof RangeError||e instanceof TypeError||typeof (e as {code?:unknown})?.code==='number')throw badDocument();throw e;}
 }
 return {...base,text:checkedText(decodeText(bytes))};
}
export function budgetAttachmentText(text:string,attachment?:BudgetAttachment){
 const merged=attachment?.text?[text.trim(),attachment.text].filter(Boolean).join('\n\n'):text.trim();
 if(merged.length>BUDGET_TEXT_LIMIT||new TextEncoder().encode(merged).length>BUDGET_INPUT_BYTES)throw Error('The file and added text exceed the import limit. Shorten the added text or export a smaller budget file.');
 return merged;
}
async function prepareImage(file:File):Promise<BudgetImage>{
 if(file.size>10_000_000)throw Error('Choose an image under 10 MB.');
 const bytes=new Uint8Array(await file.arrayBuffer()),head=new TextDecoder('latin1').decode(bytes.subarray(0,12));
 const mime=head.startsWith('\xff\xd8\xff')?'image/jpeg':bytes[0]===137&&head.slice(1,4)==='PNG'?'image/png':head.startsWith('RIFF')&&head.slice(8,12)==='WEBP'?'image/webp':'';
 const dimensions=mime?budgetImageDimensions(base64(bytes),mime):null;
 if(!dimensions||!dimensions.width||!dimensions.height)throw Error('This image could not be read. Choose a valid JPEG, PNG or WebP.');
 if(dimensions.width*dimensions.height>25_000_000)throw Error('Crop this image to the budget before attaching it.');
 let bitmap:ImageBitmap;try{bitmap=await createImageBitmap(file);}catch{throw Error('This image could not be read. Choose a valid JPEG, PNG or WebP.');}
 try{
  if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>25_000_000)throw Error('Crop this image to the budget before attaching it.');
  const scale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  const context=canvas.getContext('2d');if(!context)throw Error('This browser could not prepare the image. Paste its text instead.');
  context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
  for(const quality of [.9,.75,.55]){const data=canvas.toDataURL('image/jpeg',quality).split(',')[1];if(data.length<=1_400_000)return {mimeType:'image/jpeg',data};}
  throw Error('This image is too detailed. Crop it or paste the budget text.');
 }finally{bitmap.close();}
}
