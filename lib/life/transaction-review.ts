import {budgetSchema,categorySchema,parseMoney,transactionSchema,type Budget,type Saved,type Transaction} from './modules.ts';
import type {TransactionBuildResult} from './transaction-build-schema.ts';

export type TransactionReviewRow={id:string;date:string;kind:'expense'|'income'|'transfer';amount:string;note:string;categoryId:string;warning:string;selected:boolean;duplicate:boolean;alreadyAdded:boolean};
export type TransactionReviewMonth={plan:Saved<Budget>;transactions:Saved<Transaction>[];categories:Budget['categories']};
export type TransactionReview={buildId:string;notes:string;rows:TransactionReviewRow[];months:Record<string,TransactionReviewMonth>};
const normalized=(value:string)=>value.trim().toLocaleLowerCase().replace(/\s+/g,' ');
function sameValues(left:Pick<TransactionReviewRow,'date'|'kind'|'amount'|'note'>,right:Pick<TransactionReviewRow,'date'|'kind'|'amount'|'note'>){
 try{return !!left.date&&left.date===right.date&&left.kind===right.kind&&parseMoney(left.amount)===parseMoney(right.amount)&&normalized(left.note)===normalized(right.note);}catch{return false;}
}
export function possibleTransactionDuplicate(row:Pick<TransactionReviewRow,'date'|'kind'|'amount'|'note'>,records:Saved<Transaction>[]){
 let amount:number;try{amount=parseMoney(row.amount);}catch{return false;}
 return records.some(({data})=>!data.deleted&&!data.voided&&!data.planned&&data.date===row.date&&data.kind===row.kind&&data.amountCents===amount&&normalized(data.note)===normalized(row.note));
}
export function transactionReviewCategories(month:TransactionReviewMonth){return [...month.plan.data.categories,...month.categories].filter(category=>!category.archived);}
export function reviewMonthPlan(month:string,plans:Saved<Budget>[],fallback:Saved<Budget>):Saved<Budget>{
 const saved=plans.find(plan=>plan.id===month);if(saved)return {...saved,data:budgetSchema.parse(saved.data)};
 const previous=plans.filter(plan=>plan.id<month).sort((a,b)=>b.id.localeCompare(a.id))[0];
 const source=previous?.data||fallback.data;
 return {id:month,version:0,data:budgetSchema.parse({currency:'USD',categories:source.categories.map(category=>({...category,limitCents:0})),recurring:[],goals:{spending:'',saving:'',investing:''}})};
}
export function beginTransactionReview(buildId:string,result:TransactionBuildResult,months:Record<string,TransactionReviewMonth>):TransactionReview{
 const rows:TransactionReviewRow[]=[];
 for(const item of result.transactions){
  const month=item.date?months[item.date.slice(0,7)]:undefined;
  const row:TransactionReviewRow={...item,date:item.date||'',amount:item.amountCents===null?'':(item.amountCents/100).toFixed(2),categoryId:item.kind==='expense'&&month?.plan.version&&month.plan.data.categories.some(category=>category.id===item.categoryId&&!category.archived)?item.categoryId||'':'',selected:true,duplicate:false,alreadyAdded:false};
  row.alreadyAdded=!!month?.transactions.some(record=>record.id===row.id);
  row.duplicate=possibleTransactionDuplicate(row,month?.transactions||[])||rows.some(previous=>sameValues(previous,row));
  row.selected=!row.alreadyAdded&&!row.duplicate;rows.push(row);
 }
 return {buildId,notes:result.notes,rows,months};
}
export function editTransactionReviewRow(review:TransactionReview,id:string,patch:Partial<TransactionReviewRow>):TransactionReview{
 const edited=review.rows.map(row=>row.id===id?{...row,...patch}:row);
 return {...review,rows:edited.map((row,index)=>{
  const original=review.rows[index],month=review.months[row.date.slice(0,7)];
  const duplicate=possibleTransactionDuplicate(row,month?.transactions||[])||edited.slice(0,index).some(previous=>sameValues(previous,row));
  // A newly matching row needs a deliberate inclusion. Other edits must never
  // reselect an entry the user excluded, or revoke an explicit duplicate choice.
  return {...row,duplicate,selected:row.selected&&!(duplicate&&!original.duplicate&&!(row.id===id&&patch.selected===true))};
 })};
}
export function addTransactionReviewCategory(review:TransactionReview,rowId:string,name:string,amount:string):TransactionReview{
 const row=review.rows.find(row=>row.id===rowId),month=row&&review.months[row.date.slice(0,7)];
 if(!row||!month)throw Error('Choose the transaction date before adding a category.');
 const category=categorySchema.parse({id:crypto.randomUUID(),name,limitCents:parseMoney(amount),archived:false});
 if([...month.plan.data.categories,...month.categories].some(item=>normalized(item.name)===normalized(category.name)))throw Error('That category already exists. Choose it from the list.');
 if(month.plan.data.categories.length+month.categories.length>=30)throw Error('This month has reached its category limit.');
 return {...review,months:{...review.months,[row.date.slice(0,7)]:{...month,categories:[...month.categories,category]}},rows:review.rows.map(item=>item.id===row.id?{...item,categoryId:category.id}:item)};
}
export function transactionReviewRecords(review:TransactionReview,today:string):Saved<Transaction>[] {
 if(new Set(review.rows.filter(row=>row.selected&&!row.alreadyAdded).map(row=>row.date.slice(0,7))).size>24)throw Error('Select transactions from up to 24 months for this import. Uncheck the remaining months and import them from a separate source.');
 return review.rows.filter(row=>row.selected&&!row.alreadyAdded).map(row=>{
  if(!row.date||row.date<'1900-01-01'||row.date>today)throw Error('Choose a date between 1900 and today for every selected transaction.');
  const month=review.months[row.date.slice(0,7)];if(!month)throw Error('Wait for this month’s categories to load.');
  const category=transactionReviewCategories(month).find(category=>category.id===row.categoryId);
  if(row.kind==='expense'&&!category)throw Error('Choose a category for every selected expense.');
  const amountCents=parseMoney(row.amount);if(!amountCents)throw Error('Enter an amount greater than zero for every selected transaction.');
  return {id:row.id,version:0,data:transactionSchema.parse({date:row.date,kind:row.kind,amountCents,note:row.note,categoryId:row.kind==='expense'?category!.id:'',categoryName:row.kind==='expense'?category!.name:'',recurringId:null,voided:false,deleted:false})};
 });
}
