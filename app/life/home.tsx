"use client";
import {useEffect,useState} from 'react';
import {ArrowUpRight,Plus,Wallet,Dumbbell} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {todayIn,type Profile,type Entry} from '@/lib/life/domain';
import {previousDay} from '@/lib/life/reviews';
import type {PeriodCadence} from '@/lib/life/analysis-periods';
import type {activityTrends} from '@/lib/life/activity';
import {money} from '@/lib/life/modules';
import AIReview from './ai-review';
import {request} from './shared';
type Dashboard={periods:{cadence:PeriodCadence;from:string;through:string;available:boolean}[];trends:ReturnType<typeof activityTrends>};
function Bars({values,label}:{values:number[];label:string}){const max=Math.max(...values,1);return <svg className="trend-chart" viewBox="0 0 200 56" role="img" aria-label={label}>{values.map((value,i)=><rect key={i} x={i*51} y={54-Math.max(2,value/max*48)} width="38" height={Math.max(2,value/max*48)} rx="3"/>)}</svg>;}
export default function Home({profile,entries,onDate,onPeriod,onSection,onBusy,onProfileSaved}:{profile:Profile;entries:Entry[];onDate:(date:string)=>void;onPeriod:(cadence:PeriodCadence,date:string)=>void;onSection:(section:string)=>void;onBusy:(busy:boolean)=>void;onProfileSaved:(profile:Profile)=>void}){
 const [data,setData]=useState<Dashboard|null>(null),[error,setError]=useState('');
 const today=todayIn(profile.timezone),yesterday=previousDay(today),prior=entries.find(e=>e.date===yesterday),current=entries.find(e=>e.date===today);
 async function load(){try{setData(await request('?dashboard=1'));setError('');}catch{setError('Your dashboard could not be loaded.');}}
 useEffect(()=>{void load();},[]);
 const trends=data?.trends||[],latest=trends.at(-1),hasMoney=trends.some(t=>t.transactions),hasMovement=trends.some(t=>t.strengthSessions+t.cardioSessions);
 return <div className="home-dashboard">
  <div className="today-invitation"><div><h2>A new day, a little perspective.</h2><p>{new Date(today+'T12:00:00').toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}</p></div><Button onClick={()=>onDate(today)}><Plus/>{current?'Continue today’s log':'Start today’s log'}</Button></div>
  <AIReview heading="Yesterday’s analysis" date={yesterday} entry={prior} profile={profile} synced={true} onBusy={onBusy} onProfileSaved={onProfileSaved} onSettings={()=>onSection('settings')} onGenerated={load}/>
  {!prior?.complete&&<button className="subtle-link" onClick={()=>onDate(yesterday)}>{prior?'Finish yesterday’s entry':'Add yesterday’s entry'}<ArrowUpRight/></button>}
  <section className="period-overview" aria-label="Longer-term analysis"><h2>The bigger picture</h2><div className="period-links">{data?.periods.map(p=><button key={p.cadence} onClick={()=>onPeriod(p.cadence,p.through)}><span>{p.cadence==='weekly'?'Weekly':p.cadence==='monthly'?'Monthly':'Annual'}<ArrowUpRight/></span><small>{p.available?'Open latest analysis':'No analysis yet'}</small></button>)}</div></section>
  <section aria-label="Budget and movement trends"><div className="trend-heading"><h2>Your recent rhythm</h2><small>Last four weeks · logged activity</small></div><div className="trend-cards">
   <button onClick={()=>onSection('budget')} className="trend-card"><span><Wallet/>Budget<ArrowUpRight/></span><strong>{hasMoney?money(latest?.spendingCents||0):'Start with a transaction'}</strong><small>{hasMoney?'Spending logged in the last 7 days':'Your spending trend will appear here.'}</small>{hasMoney&&<Bars values={trends.map(t=>t.spendingCents)} label={trends.map(t=>`${t.from} to ${t.through}: ${money(t.spendingCents)} spending logged`).join('; ')}/>}</button>
   <button onClick={()=>onSection('workouts')} className="trend-card"><span><Dumbbell/>Movement<ArrowUpRight/></span><strong>{hasMovement?`${(latest?.strengthSessions||0)+(latest?.cardioSessions||0)} activities`:'Log your first activity'}</strong><small>{hasMovement?`${latest?.cardioMinutes||0} cardio minutes · last 7 days`:'Strength training and cardio, together.'}</small>{hasMovement&&<Bars values={trends.map(t=>t.strengthSessions+t.cardioSessions)} label={trends.map(t=>`${t.from} to ${t.through}: ${t.strengthSessions} strength and ${t.cardioSessions} cardio sessions`).join('; ')}/>}</button>
  </div></section>
  {error&&<div className="error" role="alert">{error}<Button variant="ghost" onClick={load}>Retry</Button></div>}
 </div>;
}
