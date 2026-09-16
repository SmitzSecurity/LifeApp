import {budgetSchema,categorySchema,parseMoney,type Budget} from './modules.ts';
import type {BudgetBuildResult} from './budget-build-schema.ts';
import type {BudgetItemChange} from './budget-items.ts';

type Category=Budget['categories'][number];
export type BudgetReview={
 initial:Budget;
 categories:{previous:Category|null;item:Category;amount:string}[];
 suggestions:BudgetBuildResult['categories'];
 recurring:Budget['recurring'];
 selected:string[];
 notes:string;
};

// AI categories are suggestions, not permission to create or change a category.
// This also resets assignments when reopening a draft saved by older versions.
export function beginBudgetReview(result:BudgetBuildResult,initial:Budget):BudgetReview{
 const recurring=result.recurring.map(r=>({...r,categoryId:''}));
 return {initial,categories:[],suggestions:result.categories,recurring,notes:result.notes,
  selected:recurring.filter(r=>!initial.recurring.some(saved=>saved.id===r.id||saved.title.toLowerCase()===r.title.toLowerCase())).map(r=>r.id)};
}

export function budgetReviewCategories(draft:BudgetReview):Category[]{
 return [...draft.initial.categories.filter(c=>!draft.categories.some(edit=>edit.item.id===c.id)),...draft.categories.map(edit=>edit.item)];
}

export function addBudgetReviewCategory(draft:BudgetReview,name:string,amount:string,assignTo?:string):BudgetReview{
 const item=categorySchema.parse({id:crypto.randomUUID(),name,limitCents:parseMoney(amount),archived:false});
 if(budgetReviewCategories(draft).some(c=>c.name.toLowerCase()===item.name.toLowerCase()))throw Error('That category already exists. Choose it from the list.');
 if(budgetReviewCategories(draft).length>=30||draft.categories.length>=20)throw Error('This budget has reached its category limit.');
 return {...draft,categories:[...draft.categories,{previous:null,item,amount}],
  recurring:draft.recurring.map(r=>r.id===assignTo&&r.kind==='expense'?{...r,categoryId:item.id}:r)};
}

export function applyBudgetReviewAllowance(draft:BudgetReview,categoryId:string,cents:number):BudgetReview{
 const category=budgetReviewCategories(draft).find(c=>c.id===categoryId&&!c.archived);
 if(!category)throw Error('Choose a category for this allowance first.');
 const item=categorySchema.parse({...category,limitCents:cents}),current=draft.categories.find(c=>c.item.id===categoryId);
 if(!current&&draft.categories.length>=20)throw Error('Review up to 20 category changes at a time.');
 const edit={previous:current?current.previous:draft.initial.categories.find(c=>c.id===categoryId)||null,item,amount:(cents/100).toFixed(2)};
 return {...draft,categories:current?draft.categories.map(c=>c.item.id===categoryId?edit:c):[...draft.categories,edit]};
}

export function budgetReviewUnassigned(draft:BudgetReview){
 const categories=budgetReviewCategories(draft);
 return draft.recurring.filter(r=>draft.selected.includes(r.id)&&r.kind==='expense'&&!categories.some(c=>c.id===r.categoryId&&!c.archived));
}

export function budgetReviewImport(draft:BudgetReview,month:string):Extract<BudgetItemChange,{kind:'import'}>{
 if(budgetReviewUnassigned(draft).length)throw Error('Choose a category for every selected expense.');
 const categories=draft.categories.map(c=>({previous:c.previous,item:categorySchema.parse({...c.item,limitCents:parseMoney(c.amount)})})).filter(c=>JSON.stringify(c.previous)!==JSON.stringify(c.item));
 const recurring=draft.recurring.filter(r=>draft.selected.includes(r.id)).map(item=>({previous:null,item}));
 const combined={...draft.initial,categories:[...draft.initial.categories.filter(c=>!categories.some(n=>n.item.id===c.id)),...categories.map(c=>c.item)],recurring:[...draft.initial.recurring,...recurring.map(r=>r.item)]};
 const valid=budgetSchema.safeParse(combined);
 if(!valid.success)throw Error(valid.error.issues[0]?.message||'Review the draft values.');
 return {kind:'import',month,initial:draft.initial,categories,recurring};
}
