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
export default function Settings({config,onChange,focusFields,habitFields,dirty,busy,onSave,onCancel,onDelete}:{config:Profile;onChange:(p:Profile)=>void;focusFields:ReactNode;habitFields:ReactNode;dirty:boolean;busy:boolean;onSave:()=>void;onCancel:()=>void;onDelete?:()=>void}){
 const [legacyGoals,setLegacyGoals]=useState<Budget['goals']|null>(null);
 useEffect(()=>{if(!config.budgetGoals)void request('?kind=budget').then(data=>{const plans=(data.records as Saved<Budget>[]).sort((a,b)=>b.id.localeCompare(a.id));setLegacyGoals(plans[0]?.data.goals||null);}).catch(()=>{});},[]);
 const budgetGoals=config.budgetGoals||legacyGoals||{spending:'',saving:'',investing:''};
 return <section className="settings-panel organized-settings"><p className="settings-intro">Make LifeApp work for you.</p>
 <details className="settings-group"><summary><strong>Goals & focus</strong><span>What matters, including your budget goals</span></summary>{focusFields}<h3>Budget goals</h3>{(['spending','saving','investing'] as const).map(key=><label className="compact-field" key={key}>{key[0].toUpperCase()+key.slice(1)} goal<textarea rows={2} maxLength={1000} value={budgetGoals[key]} onChange={e=>onChange({...config,budgetGoals:{...budgetGoals,[key]:e.target.value}})}/></label>)}</details>
 <details className="settings-group"><summary><strong>Habits</strong><span>Add, rename or archive the habits you track</span></summary>{habitFields}</details>
 <details className="settings-group"><summary><strong>Analysis & saved guidance</strong><span>Timing, tone and the feedback you have given</span></summary><ReviewSettings value={config.reviewPreferences} onChange={reviewPreferences=>onChange({...config,reviewPreferences})}/><h3>Saved guidance</h3><p className="muted">Feedback saved from an analysis guides future generations. Edit or remove it here.</p>{!config.analysisGuidance.length&&<p className="muted">Use the Feedback button on an analysis to add guidance.</p>}{config.analysisGuidance.map(g=><div className="guidance-item" key={g.id}><label className="compact-field">Your guidance<textarea rows={2} maxLength={500} value={g.text} onChange={e=>onChange({...config,analysisGuidance:config.analysisGuidance.map(x=>x.id===g.id?{...x,text:e.target.value}:x)})}/></label><Button variant="ghost" onClick={()=>onChange({...config,analysisGuidance:config.analysisGuidance.filter(x=>x.id!==g.id)})}>Remove guidance</Button></div>)}</details>
 <details className="settings-group"><summary><strong>Timezone</strong><span>{config.timezone}</span></summary><label className="inline-check"><input type="checkbox" checked={config.timezoneMode==='automatic'} onChange={e=>onChange({...config,timezoneMode:e.target.checked?'automatic':'manual',timezone:e.target.checked?Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC':config.timezone})}/>Use my device timezone</label><label className="compact-field">Timezone<input disabled={config.timezoneMode==='automatic'} value={config.timezone} onChange={e=>onChange({...config,timezone:e.target.value})}/></label></details>
 <div className="settings-save"><small>{dirty?'Unsaved changes':'Settings saved'}</small><Button variant="ghost" disabled={busy||!dirty} onClick={onCancel}>Cancel changes</Button><Button disabled={busy||!dirty} onClick={onSave}>Save Settings</Button></div>
 <details className="settings-group"><summary><strong>Automation & email</strong><span>Separate choices for daily analysis, period analysis and full-report emails</span></summary><AutomaticReviewSettings key={config.version} setupDirty={dirty}/><PeriodicSettings setupDirty={dirty}/><EmailSettings/></details>
 <div className="settings-data"><a href="/api/life?export=1" download>Download my data</a>{onDelete&&<button className="delete-account-link" disabled={busy||dirty} onClick={onDelete}>Delete account</button>}</div>
 </section>;
}
