"use client";
import {useEffect,useState,type ReactNode} from 'react';
import {Button} from '@/components/ui/button';
import type {Profile} from '@/lib/life/domain';
import type {Budget,Saved} from '@/lib/life/modules';
import ReviewSettings from './review-settings';
import AutomaticReviewSettings from './automatic-review-settings';
import PeriodicSettings from './periodic-settings';
import EmailSettings from './email-settings';
import {request} from './shared';
import AppearanceSettings from './appearance-settings';
import TimezoneSelect from './timezone-select';
import {BudgetGoalFields} from './budget-goals';
export default function Settings({config,onChange,focusFields,habitFields,dirty,busy,locked=false,savePending=false,conflict,onSave,onCancel,onDelete}:{config:Profile;onChange:(p:Profile)=>void;focusFields:ReactNode;habitFields:ReactNode;dirty:boolean;busy:boolean;locked?:boolean;savePending?:boolean;conflict?:ReactNode;onSave:()=>void;onCancel:()=>void;onDelete?:()=>void}){
 const [legacyGoals,setLegacyGoals]=useState<Budget['goals']|null>(null);
 const needsLegacyGoals=!config.budgetGoals;
 useEffect(()=>{let current=true;if(needsLegacyGoals)void request('?kind=budget').then(data=>{if(!current)return;const plans=(data.records as Saved<Budget>[]).sort((a,b)=>b.id.localeCompare(a.id));setLegacyGoals(plans[0]?.data.goals||null);}).catch(()=>{});return()=>{current=false;};},[needsLegacyGoals]);
 const budgetGoals=config.budgetGoals||legacyGoals||{spending:'',saving:'',investing:''};
 return <section className="settings-panel organized-settings"><div className="settings-fields"><div className="settings-fields-inner">{conflict}{savePending&&!busy&&<p className="error" role="alert">Your settings save is unconfirmed. Retry Save to check the same changes before editing or leaving.</p>}<fieldset className="settings-input-lock" disabled={busy||locked}><p className="settings-intro">Make LifeApp work for you.</p>
 <AppearanceSettings value={config.appearance} onChange={appearance=>onChange({...config,appearance})}/><details className="settings-group"><summary><strong>Goals & focus</strong><span>What matters, including your budget goals</span></summary>{focusFields}<h3>Budget goals</h3><BudgetGoalFields value={budgetGoals} onChange={budgetGoals=>onChange({...config,budgetGoals})}/></details>
 <details className="settings-group"><summary><strong>Habits</strong><span>Add, rename or archive the habits you track</span></summary>{habitFields}</details>
 <details className="settings-group"><summary><strong>Analysis & saved guidance</strong><span>Timing, tone and the feedback you have given</span></summary><ReviewSettings value={config.reviewPreferences} onChange={reviewPreferences=>onChange({...config,reviewPreferences})}/><h3>Saved guidance</h3><p className="muted">Feedback saved from an analysis guides future generations. Edit or remove it here.</p>{!config.analysisGuidance.length&&<p className="muted">Use the Feedback button on an analysis to add guidance.</p>}{config.analysisGuidance.map(g=><div className="guidance-item" key={g.id}><label className="compact-field">Your guidance<textarea rows={2} maxLength={500} value={g.text} onChange={e=>onChange({...config,analysisGuidance:config.analysisGuidance.map(x=>x.id===g.id?{...x,text:e.target.value}:x)})}/></label><Button variant="ghost" onClick={()=>onChange({...config,analysisGuidance:config.analysisGuidance.filter(x=>x.id!==g.id)})}>Remove guidance</Button></div>)}</details>
 <details className="settings-group"><summary><strong>Timezone</strong><span>{config.timezone}</span></summary><label className="inline-check"><input type="checkbox" checked={config.timezoneMode==='automatic'} onChange={e=>onChange({...config,timezoneMode:e.target.checked?'automatic':'manual',timezone:e.target.checked?Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC':config.timezone})}/>Use my device timezone</label><TimezoneSelect disabled={config.timezoneMode==='automatic'} value={config.timezone} onChange={timezone=>onChange({...config,timezone})}/></details>
 <details className="settings-group"><summary><strong>Automation & email</strong><span>Separate choices for daily analysis, period analysis and full-report emails</span></summary><AutomaticReviewSettings key={config.version} setupDirty={dirty}/><PeriodicSettings setupDirty={dirty}/><EmailSettings/></details>
 <div className="settings-data"><a href="/api/life?export=1" download>Download my data</a>{onDelete&&<button className="delete-account-link" disabled={busy||dirty} onClick={onDelete}>Delete account</button>}</div>
 </fieldset></div></div><footer className="settings-save"><Button variant="ghost" disabled={busy||savePending||!dirty} onClick={onCancel}>Cancel</Button><Button disabled={busy||!!conflict||!dirty&&!savePending} onClick={onSave}>{busy?'Saving…':savePending?'Retry Save':'Save'}</Button></footer>
 </section>;
}
