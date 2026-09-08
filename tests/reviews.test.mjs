import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyReviewDecision,lateCompletionAction,priorReviewEvidence,defaultReviewPreferences,reviewPreferencesSchema,previousDay,completionIssues,dailyJobKey } from '../lib/life/reviews.ts';
const complete={complete:true,journal:'Synthetic reflection',habits:[{status:'done'},{status:'exempt'}]};
test('daily analysis is held on missing/incomplete data without inventing failures',()=>{
 assert.deepEqual(dailyReviewDecision({enabled:true}),{state:'missing',action:'reminder'});
 assert.deepEqual(dailyReviewDecision({enabled:true,entry:{...complete,complete:false}}),{state:'incomplete',action:'hold'});
 assert.deepEqual(dailyReviewDecision({enabled:true,entry:{...complete,habits:[{status:'unrecorded'}]}}),{state:'incomplete',action:'hold'});
 assert.deepEqual(dailyReviewDecision({enabled:true,entry:complete}),{state:'ready',action:'generate'});
 assert.equal(completionIssues({...complete,habits:[{status:'missed'}]}).length,0);
 assert.equal(dailyReviewDecision({enabled:false,entry:complete}).action,'none');
});
test('existing reviews are never overwritten and late completion releases eligible work only once',()=>{
 assert.equal(dailyReviewDecision({enabled:true,entry:complete,existingReportId:'report-1'}).state,'already-generated');
 const input={dailyEnabled:true,triggerAlreadyDue:true,wasComplete:false,entry:complete};
 assert.equal(lateCompletionAction(input),'enqueue-now');
 assert.equal(lateCompletionAction({...input,wasComplete:true}),'none');
 assert.equal(lateCompletionAction({...input,triggerAlreadyDue:false}),'none');
 assert.equal(lateCompletionAction({...input,existingReportId:'report-1'}),'none');
 assert.notEqual(dailyJobKey('account-a','2026-09-08'),dailyJobKey('account-b','2026-09-08'));
});
test('higher order reviews receive only the latest completed lower-order revisions in their window',()=>{
 const base={id:'d1',cadence:'daily',from:'2026-09-08',through:'2026-09-08',status:'complete',revision:1,content:'Synthetic summary'};
 const reports=[base,{...base,id:'d2',revision:2},{...base,id:'failed',revision:3,status:'failed'},{...base,id:'old',from:'2025-01-01',through:'2025-01-01'},{...base,id:'w',cadence:'weekly',from:'2026-09-01',through:'2026-09-07'},{...base,id:'m',cadence:'monthly',from:'2026-09-01',through:'2026-09-30'}];
 assert.deepEqual(priorReviewEvidence('weekly','2026-09-01','2026-09-09',reports).map(r=>r.id),['d2']);
 assert.deepEqual(priorReviewEvidence('annual','2026-01-01','2026-12-31',reports).map(r=>r.id),['w','d2','m']);
 assert.deepEqual(priorReviewEvidence('daily','2026-09-01','2026-09-09',reports),[]);
});
test('feedback options round-trip and reject invalid execution settings',()=>{
 const p=defaultReviewPreferences();p.daily.focus='Be specific about progress toward my chosen goals';p.weekly.enabled=false;p.emailEnabled=true;
 assert.deepEqual(reviewPreferencesSchema.parse(p),p);
 assert.equal(reviewPreferencesSchema.safeParse({...p,daily:{...p.daily,time:'24:00'}}).success,false);
 assert.equal(reviewPreferencesSchema.safeParse({...p,monthDay:32}).success,false);
 assert.equal(previousDay('2028-03-01'),'2028-02-29');
});
