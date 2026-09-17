import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {budgetSchema,transactionSchema} from '../lib/life/modules.ts';
import {addTransactionReviewCategory,beginTransactionReview,editTransactionReviewRow,possibleTransactionDuplicate,reviewMonthPlan,transactionReviewRecords} from '../lib/life/transaction-review.ts';

const today='2026-09-16';
function fixture(){
 const category={id:randomUUID(),name:'Dining',limitCents:30000,archived:false};
 const plan={id:'2026-09',version:3,data:budgetSchema.parse({currency:'USD',categories:[category],recurring:[],goals:{spending:'Spend thoughtfully',saving:'Save each month',investing:''}})};
 const row={id:randomUUID(),date:'2026-09-15',kind:'expense',amountCents:1250,note:'Corner cafe',categoryId:category.id,warning:''};
 const month={plan,transactions:[],categories:[]};
 const begin=(rows=[row],patch={})=>beginTransactionReview(randomUUID(),{notes:'',transactions:rows},{'2026-09':{...month,...patch}});
 return {category,plan,row,month,begin};
}
test('transaction review accepts existing month category suggestions but leaves absent and archived choices blank',()=>{
 const f=fixture(),draft=f.begin([f.row,{...f.row,id:randomUUID(),categoryId:randomUUID()},{...f.row,id:randomUUID(),date:null}]);
 assert.equal(draft.rows[0].categoryId,f.category.id);assert.equal(draft.rows[1].categoryId,'');assert.equal(draft.rows[2].date,'');assert.equal(draft.rows[2].categoryId,'');
 assert.equal(f.begin([f.row],{plan:{...f.plan,data:{...f.plan.data,categories:[{...f.category,archived:true}]}}}).rows[0].categoryId,'');
 assert.equal(f.begin([f.row],{plan:{...f.plan,version:0}}).rows[0].categoryId,'');
});
test('historical month creation copies only category identity, preserving saved plans and zeroing financial policies',()=>{
 const f=fixture(),plan=reviewMonthPlan('2026-08',[f.plan],f.plan);
 assert.equal(plan.version,0);assert.deepEqual(plan.data.categories,[{...f.category,limitCents:0}]);assert.deepEqual(plan.data.recurring,[]);assert.deepEqual(plan.data.goals,{spending:'',saving:'',investing:''});assert.equal(f.plan.data.categories[0].limitCents,30000);
 assert.deepEqual(reviewMonthPlan(f.plan.id,[f.plan],f.plan),f.plan);
});
test('duplicate detection excludes voided, deleted and planned records and starts valid matches unchecked',()=>{
 const f=fixture(),record={id:randomUUID(),version:1,data:transactionSchema.parse({date:f.row.date,kind:'expense',amountCents:1250,categoryId:f.category.id,categoryName:'Dining',note:'  CORNER   cafe ',recurringId:null,voided:false})};
 const draft=f.begin([f.row],{transactions:[record]});assert.equal(draft.rows[0].duplicate,true);assert.equal(draft.rows[0].selected,false);
 for(const flag of ['voided','deleted','planned'])assert.equal(f.begin([f.row],{transactions:[{...record,data:{...record.data,[flag]:true}}]}).rows[0].duplicate,false);
 const pair=f.begin([f.row,{...f.row,id:randomUUID()}]);assert.equal(pair.rows[0].selected,true);assert.equal(pair.rows[1].selected,false);
 assert.equal(possibleTransactionDuplicate({...draft.rows[0],amount:'NaN'},[record]),false);
});
test('edited duplicates require an explicit choice without reselecting excluded rows',()=>{
 const f=fixture();let draft=f.begin([f.row,{...f.row,id:randomUUID(),amountCents:1400}]);const second=draft.rows[1].id;
 draft=editTransactionReviewRow(draft,second,{amount:'12.50'});assert.equal(draft.rows[1].duplicate,true);assert.equal(draft.rows[1].selected,false);
 draft=editTransactionReviewRow(draft,second,{selected:true});assert.equal(draft.rows[1].selected,true);
 draft=editTransactionReviewRow(draft,second,{selected:false});draft=editTransactionReviewRow(draft,second,{date:'2026-09-14'});assert.equal(draft.rows[1].duplicate,false);assert.equal(draft.rows[1].selected,false);
 draft=editTransactionReviewRow(draft,second,{date:'2026-09-15',amount:'12.5'});assert.equal(draft.rows[1].duplicate,true);assert.equal(draft.rows[1].selected,false);
});
test('inline category creation changes only the reviewed month and uses an explicit allowance',()=>{
 const f=fixture(),draft=addTransactionReviewCategory(f.begin([{...f.row,categoryId:null}]),f.row.id,'Household','45.20');
 assert.equal(draft.months['2026-09'].categories[0].limitCents,4520);assert.equal(draft.rows[0].categoryId,draft.months['2026-09'].categories[0].id);assert.equal(f.plan.data.categories.length,1);
 assert.throws(()=>addTransactionReviewCategory(draft,f.row.id,'dining','0.00'),/already exists/);
 assert.throws(()=>addTransactionReviewCategory(draft,f.row.id,'Other','NaN'),/amount/);
});
test('saving review rows validates actual amounts, date bounds and month categories before emitting transactions',()=>{
 const f=fixture(),draft=f.begin();const records=transactionReviewRecords(draft,today);assert.equal(records[0].id,f.row.id);assert.equal(records[0].version,0);assert.equal(records[0].data.categoryName,'Dining');assert.equal(records[0].data.amountCents,1250);assert.equal(records[0].data.recurringId,null);assert.equal(records[0].data.planned,undefined);
 for(const patch of [{amount:''},{amount:'NaN'},{amount:'Infinity'},{amount:'0'},{date:''},{date:'2026-09-17'},{categoryId:''}])assert.throws(()=>transactionReviewRecords({...draft,rows:[{...draft.rows[0],...patch}]},today));
 assert.equal(transactionReviewRecords({...draft,rows:[{...draft.rows[0],kind:'transfer',categoryId:''}]},today)[0].data.categoryId,'');
});
test('already added rows including deleted records remain excluded and cannot be recreated',()=>{
 const f=fixture(),existing={id:f.row.id,version:2,data:transactionSchema.parse({date:f.row.date,kind:'expense',amountCents:1250,categoryId:f.category.id,categoryName:'Dining',note:f.row.note,recurringId:null,voided:false,deleted:true})};
 const draft=f.begin([f.row],{transactions:[existing]});assert.equal(draft.rows[0].alreadyAdded,true);assert.equal(draft.rows[0].selected,false);assert.deepEqual(transactionReviewRecords({...draft,rows:[{...draft.rows[0],selected:true}]},today),[]);
});
