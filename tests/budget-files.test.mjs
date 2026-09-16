import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {prepareBudgetFile,budgetAttachmentText} from '../app/life/budget-file.ts';

const file=(text,name='budget.txt',type='')=>new File([text],name,{type});
const office=(parts,name)=>file(zipSync(Object.fromEntries(Object.entries(parts).map(([path,value])=>[path,strToU8(value)]))),name);
const word=body=>({'word/document.xml':`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`});
const workbook=(sheet,extra={})=>({
 'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Monthly budget" sheetId="1" r:id="rId1"/></sheets></workbook>',
 'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="worksheet"/></Relationships>',
 'xl/worksheets/sheet1.xml':`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`,...extra,
});

test('budget text attachments preserve a full large source separately from optional notes',async()=>{
 const source='Bills allowance $300\n'.repeat(16000),attachment=await prepareBudgetFile(file(source));
 assert.equal(attachment.text,source);assert.equal(attachment.size,new TextEncoder().encode(source).length);
 assert.equal(budgetAttachmentText('Use the stated dates',attachment),'Use the stated dates\n\n'+source);
 for(const extension of ['csv','tsv','json','md'])assert.equal((await prepareBudgetFile(file('Name,Amount\nRent,1000',`budget.${extension}`))).text,'Name,Amount\nRent,1000');
});

test('text extraction handles a UTF-16 BOM and rejects empty, binary, oversized and legacy files',async()=>{
 const content='Rent $800',data=new Uint8Array(2+content.length*2);data.set([255,254]);for(let i=0;i<content.length;i++)data[2+i*2]=content.charCodeAt(i);
 assert.equal((await prepareBudgetFile(file(data))).text,content);
 await assert.rejects(()=>prepareBudgetFile(file('')),/empty/);
 await assert.rejects(()=>prepareBudgetFile(file('    ')),/no readable text/);
 await assert.rejects(()=>prepareBudgetFile(file('data\0more')),/not a readable text/);
 await assert.rejects(()=>prepareBudgetFile(file('x'.repeat(500001))),/too much text/);
 await assert.rejects(()=>prepareBudgetFile(file('old format','budget.doc')),/older .xls\/.doc/);
 assert.throws(()=>budgetAttachmentText('x'.repeat(100),{text:'y'.repeat(500000)}),/exceed the import limit/);
});

test('Word text keeps paragraph and table boundaries and never executes instructions or entities',async()=>{
 const attachment=await prepareBudgetFile(office(word('<w:p><w:r><w:t>Monthly &amp; annual</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Rent</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>$800</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:instrText>DO NOT EXECUTE THIS FIELD</w:instrText><w:t>Food $300</w:t></w:r></w:p>'),'budget.docx'));
 assert.equal(attachment.text,'Monthly & annual\nRent\t$800\nFood $300');assert.equal(attachment.warnings.length,1);
 await assert.rejects(()=>prepareBudgetFile(office({'word/document.xml':'<!DOCTYPE x [<!ENTITY secret SYSTEM "https://private.invalid/">]><document>&secret;</document>'},'budget.docx')),/damaged/);
 await assert.rejects(()=>prepareBudgetFile(office(word('<w:p><w:t>Broken</w:p>'),'budget.docx')),/damaged/);
 await assert.rejects(()=>prepareBudgetFile(office(word('<w:p/>'),'budget.docx')),/no readable text/);
});

test('Excel preserves sheet names, cell addresses, shared strings, cached formulas, dates and percentages',async()=>{
 const attachment=await prepareBudgetFile(office(workbook('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>800</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Tax rate</t></is></c><c r="C2" s="1"><v>0.2</v></c><c r="D2" s="2"><v>46281</v></c><c r="E2"><f>C1*0.2</f><v>160</v></c></row>',{
 'xl/sharedStrings.xml':'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Rent</t></si></sst>',
 'xl/styles.xml':'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="9"/><xf numFmtId="14"/></cellXfs></styleSheet>',
 }),'budget.xlsx'));
 assert.match(attachment.text,/\[Sheet: Monthly budget\]/);assert.match(attachment.text,/A1: "Rent"\tC1: "800"/);
 assert.match(attachment.text,/C2: "20%"/);assert.match(attachment.text,/D2: "2026-09-16"/);assert.match(attachment.text,/E2: "160"/);assert.doesNotMatch(attachment.text,/C1\*0.2/);
 assert.ok(attachment.warnings.some(w=>w.includes('Formulas are not executed')));
});

test('Excel fails clearly for formulas without saved results, external sheets and macro payloads',async()=>{
 await assert.rejects(()=>prepareBudgetFile(office(workbook('<row><c r="A1"><f>WEBSERVICE("https://private.invalid")</f></c></row>'),'budget.xlsx')),/no saved value/);
 const external=workbook('<row><c r="A1"><v>300</v></c></row>');external['xl/_rels/workbook.xml.rels']='<Relationships><Relationship Id="rId1" Target="https://private.invalid" TargetMode="External"/></Relationships>';
 await assert.rejects(()=>prepareBudgetFile(office(external,'budget.xlsx')),/damaged/);
 await assert.rejects(()=>prepareBudgetFile(office({...workbook('<row/>'),'xl/vbaProject.bin':'macro'},'budget.xlsx')),/Macro-enabled/);
 await assert.rejects(()=>prepareBudgetFile(office(workbook('<row/>'),'budget.xlsx')),/no readable cells/);
});

test('Office archives reject forged decompressed sizes, encrypted flags, checksum damage and excess entries',async()=>{
 const original=new Uint8Array(await office(word('<w:p><w:r><w:t>Budget $200</w:t></w:r></w:p>'),'budget.docx').arrayBuffer());
 let central=0;for(let p=0;p<original.length-4;p++)if(new DataView(original.buffer).getUint32(p,true)===0x02014b50){central=p;break;}
 for(const change of [(view)=>view.setUint32(central+24,1,true),(view)=>view.setUint16(central+8,1,true),(view)=>view.setUint32(central+16,0,true)]){
  const bytes=original.slice();change(new DataView(bytes.buffer));await assert.rejects(()=>prepareBudgetFile(file(bytes,'budget.docx')),/damaged/);
 }
 const many=Object.fromEntries(Array.from({length:1001},(_,i)=>[`f${i}`,new Uint8Array()]));await assert.rejects(()=>prepareBudgetFile(file(zipSync(many),'budget.xlsx')),/damaged/);
});

test('PDF attachments retain exact bytes and reject encrypted, oversized and mislabeled PDFs',async()=>{
 const source='%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF',attachment=await prepareBudgetFile(file(source,'budget.pdf'));
 assert.equal(atob(attachment.document.data),source);assert.equal(attachment.document.mimeType,'application/pdf');assert.equal(attachment.text,undefined);
 await assert.rejects(()=>prepareBudgetFile(file('%PDF-1.7\n/Encrypt 1 0 R\n%%EOF','budget.pdf')),/Password-protected/);
 await assert.rejects(()=>prepareBudgetFile(file('not PDF','budget.pdf')),/valid PDF/);
 await assert.rejects(()=>prepareBudgetFile(file('%PDF-'+ 'x'.repeat(4_000_000),'budget.pdf')),/under 4 MB/);
});

test('image attachments reject disguised files and excessive dimensions before decoding pixels',async()=>{
 await assert.rejects(()=>prepareBudgetFile(file('<svg>not a supported image</svg>','budget.jpg','image/jpeg')),/valid JPEG/);
 const bytes=new Uint8Array(24);bytes.set([137,80,78,71,13,10,26,10]);const view=new DataView(bytes.buffer);view.setUint32(16,100000);view.setUint32(20,100000);
 await assert.rejects(()=>prepareBudgetFile(file(bytes,'budget.png','image/png')),/Crop this image/);
});
