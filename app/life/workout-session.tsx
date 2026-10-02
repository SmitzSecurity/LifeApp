"use client";

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Check, CircleHelp, Info, LayoutList, Plus, SkipForward, Vibrate, VibrateOff, Volume2, VolumeX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/life/date-display';
import { repTarget } from '@/lib/life/exercise-presets';
import { exerciseGuide } from '@/lib/life/exercise-guides';
import { nextSet, workingSetEntries, type Exercise, type Saved, type Workout } from '@/lib/life/modules';
import {workingLoad} from '@/lib/life/workout-session';
import type {ExerciseHistory} from '@/lib/life/exercise-performance';
import './workout-session.css';

function ExerciseHeading({ name }: { name: string }) {
  const guide = exerciseGuide(name);
  return <div className="session-exercise-title">
    <h3>{name}</h3>
    {guide && <a className="session-exercise-guide" href={guide.url} target="_blank" rel="noopener noreferrer"
      aria-label={guide.isSearch ? `Find an exercise guide for ${name}` : `View ${name} guide on ${guide.provider}`}
      title={guide.isSearch ? 'Find an exercise guide' : `Demonstration & technique · ${guide.provider}`}><CircleHelp aria-hidden="true"/></a>}
  </div>;
}

export type WorkoutSessionTarget = {
  exercise: Exercise;
  setNumber: number;
  workingSetNumber?: number;
};

export type WorkoutSessionProps = {
  workout: Saved<Workout>;
  target: WorkoutSessionTarget | null;
  previousPerformance?: {
    date: string;
    workoutName: string;
    reps: number;
    load: number;
    unit: string;
    workingSetNumber: number;
  } | null;
  previousPerformanceLoading?: boolean;
  previousPerformanceUnavailable?: boolean;
  previousHistory?: ExerciseHistory|null;
  saveWeight?: boolean;
  programWeightChanged?: boolean;
  onSaveWeight?: (value:boolean)=>void;
  reps: string;
  load: string;
  warmup: boolean;
  remaining: number;
  editing: boolean;
  busy: boolean;
  pending?: boolean;
  setDirty: boolean;
  sound: boolean;
  onSound: () => void;
  vibration: boolean;
  onVibration: () => void;
  supportsVibration: boolean;
  onReps: (value: string) => void;
  onLoad: (value: string) => void;
  onWarmup: (value: boolean) => void;
  onSaveSet: () => void;
  onSkipSet: () => void;
  onSkipRest: () => void;
  onExtendRest: () => void;
  onPlan: () => void;
  onFinish: () => void;
  onExit: () => void;
  onOverview?: () => void;
  onCancelCorrection: () => void;
  reviewing?: boolean;
  review?: ReactNode;
  visible?: boolean;
};

/** The parent owns saved records, drafts, timers and exact write retries. */
export default function WorkoutSession({
  workout, target, previousPerformance, previousHistory, previousPerformanceLoading = false, previousPerformanceUnavailable = false, saveWeight=true,programWeightChanged=false,onSaveWeight, reps, load, warmup, remaining, editing, busy,
  pending = false, setDirty, sound, onSound, vibration, onVibration, supportsVibration,
  onReps, onLoad, onWarmup, onSaveSet, onSkipSet, onSkipRest,
  onExtendRest, onPlan, onFinish, onExit, onOverview, onCancelCorrection,reviewing=false,review,visible=true,
}: WorkoutSessionProps) {
  const id = useId();
  const plan = workout.data;
  const current = nextSet(plan);
  const completed = plan.sets.filter(set => !set.warmup).length;
  const skipped = plan.skippedSets?.length ?? 0;
  const resting = remaining > 0 && !editing && !!current && !reviewing;
  const locked = busy || pending;
  const exerciseIndex = target ? plan.exercises.findIndex(exercise => exercise.id === target.exercise.id) : -1;
  const following = target ? plan.exercises[exerciseIndex + 1] : undefined;
  const todaySets=target?workingSetEntries(plan,target.exercise.id):[];
  const historyRows=target?Math.max(target.exercise.sets,previousHistory?.plannedSets??0,...todaySets.map(s=>s.workingSetNumber),...(previousHistory?.sets.map(s=>s.workingSetNumber)||[])):0;
  const clock = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
  const content = useRef<HTMLDivElement>(null);
  const repsInput = useRef<HTMLInputElement>(null);
  useEffect(()=>{if(!visible||resting||reviewing||busy||pending)return;repsInput.current?.focus({preventScroll:true});repsInput.current?.select();},[visible,resting,reviewing,target?.exercise.id,target?.setNumber,target?.workingSetNumber,busy,pending]);
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
  }, [resting, editing, target?.exercise.id, target?.setNumber, target?.workingSetNumber]);

  return <section className="workout-session" aria-label="Active workout">
    <div className={`session-stage${resting ? ' session-stage-rest' : ''}${reviewing||!target?' session-stage-review':''}`}>
      <div className="session-focus">
        <div className="session-controls">
          <Button variant="ghost" size="icon" onClick={onExit} disabled={locked} aria-label="Workout options" title="Workout options"><X aria-hidden="true"/></Button>
          {onOverview&&<Button className="session-overview-button" variant="ghost" onClick={onOverview} disabled={locked} aria-label="Workouts overview"><LayoutList aria-hidden="true"/><span>Workouts</span></Button>}
          <div className="session-utilities">
            <Button variant="ghost" size="icon" onClick={onPlan} disabled={locked} aria-label="Workout information" title="Workout information"><Info aria-hidden="true"/></Button>
            <Button variant="ghost" size="icon" onClick={onSound} aria-label="Rest sound" aria-pressed={sound} title={sound ? 'Rest sound on' : 'Rest sound off'}>{sound ? <Volume2 aria-hidden="true"/> : <VolumeX aria-hidden="true"/>}</Button>
            <Button variant="ghost" size="icon" onClick={onVibration} disabled={!supportsVibration} aria-label="Rest vibration" aria-pressed={vibration} title={!supportsVibration ? 'Vibration unavailable in this browser' : vibration ? 'Rest vibration on' : 'Rest vibration off'}>{vibration ? <Vibrate aria-hidden="true"/> : <VibrateOff aria-hidden="true"/>}</Button>
          </div>
        </div>
        <div className="session-content" ref={content}>
        {reviewing||!target ? <div className="session-summary"><p className="session-eyebrow">Session summary</p><h3>{plan.name}</h3><p className="session-summary-description">Review your sets and leave a note before finishing.</p>{review||<Button onClick={onFinish} disabled={locked||setDirty}>Finish workout</Button>}</div> : resting ? <div className="session-rest">
          {current ? <div className="session-up-next">
            <span>Up next · Working set {current.workingSetNumber} of {current.exercise.sets}</span>
            <ExerciseHeading name={current.exercise.name}/>
            <p>Target {repTarget(current.exercise)} reps · {workingLoad(plan,current.exercise)} {current.exercise.unit}</p>
          </div> : <p className="session-rest-complete">{completed} working sets logged{skipped > 0 ? ` · ${skipped} skipped` : ''}. Finish when you’re ready.</p>}
          <div className="session-rest-clock">
          <p className="session-eyebrow">Take a rest</p>
          <div className="session-timer" role="timer" aria-live="off" aria-label={`${remaining} seconds of rest remaining`}>{clock}</div>
          <div className="session-rest-actions">
            <Button variant="secondary" onClick={onExtendRest} disabled={locked} aria-label="Extend rest by 20 seconds"><Plus aria-hidden="true"/>20s</Button>
            <Button onClick={onSkipRest} disabled={locked}><SkipForward aria-hidden="true"/>Skip rest</Button>
          </div>
          </div>
        </div> : target ? <div className="session-working-set">
          <div className="session-exercise-heading">
            <p className="session-eyebrow">{editing ? 'Correct a logged set' : `Exercise ${exerciseIndex + 1} of ${plan.exercises.length}`}</p>
            <ExerciseHeading name={target.exercise.name}/>
            {!editing && following && <p className="session-next-exercise">Next: {following.name}</p>}
          </div>
          <div className="session-working-target">
            <p className="session-set-number">{editing ? `Logged set ${target.setNumber}` : `Working set ${target.workingSetNumber ?? current?.workingSetNumber ?? 1} of ${target.exercise.sets}`}</p>
            <div className="session-targets"><span>Target {repTarget(target.exercise)} reps</span><span>{target.exercise.restSeconds}s rest</span></div>
            {!editing && !warmup && <><p className="session-previous-performance" aria-live="polite">
              {previousPerformanceLoading ? 'Loading last performance…' : previousPerformanceUnavailable ? 'Previous set unavailable.' : previousPerformance
                ? <>Last time <strong>{previousPerformance.reps} reps × {previousPerformance.load} {previousPerformance.unit}</strong><span> · {formatDate(previousPerformance.date)} · {previousPerformance.workoutName}</span></>
                : previousHistory?<>Last workout · {formatDate(previousHistory.date)} · {previousHistory.workoutName}</>:'No previous performance for this set.'}
            </p><table className="session-performance-table"><caption className="sr-only">Working sets for {target.exercise.name}</caption><thead><tr><th scope="col">Set</th><th scope="col">Today</th><th scope="col">Last time</th></tr></thead><tbody>{Array.from({length:historyRows},(_,index)=>{const ordinal=index+1,previous=previousHistory?.sets.find(s=>s.workingSetNumber===ordinal),logged=todaySets.find(s=>s.workingSetNumber===ordinal)?.set,skippedToday=plan.skippedSets?.some(s=>s.exerciseId===target.exercise.id&&s.workingSetNumber===ordinal);return <tr key={ordinal} aria-current={ordinal===(target.workingSetNumber??current?.workingSetNumber)?'step':undefined}><th scope="row">{ordinal}</th><td>{logged?<>{logged.reps} × {logged.load} {target.exercise.unit}</>:skippedToday?'Skipped':'—'}</td><td>{previous?<>{previous.reps} × {previous.load} {previousHistory?.unit}</>:previousHistory?.skipped.includes(ordinal)?'Skipped':'—'}</td></tr>;})}</tbody></table></>}
          </div>
          <fieldset className="session-set-entry" disabled={locked}>
            <legend className="sr-only">{editing ? 'Correct logged reps and load' : 'Log your completed set'}</legend>
            {!editing && <p className="session-ready" role="status">{plan.restUntil ? 'Rest complete. Ready for your next set.' : 'Ready when you are'}</p>}
            <div className="session-inputs">
              <label htmlFor={`${id}-reps`}><span>Reps completed</span><input ref={repsInput} autoFocus id={`${id}-reps`} type="number" inputMode="numeric" min={0} max={100} step={1} value={reps} onChange={event => onReps(event.target.value)}/></label>
              <label htmlFor={`${id}-load`}><span>Load ({target.exercise.unit})</span><input id={`${id}-load`} inputMode="decimal" aria-describedby={`${id}-bodyweight`} value={load} onChange={event => onLoad(event.target.value)}/><small id={`${id}-bodyweight`}>Use 0 for bodyweight.</small></label>
            </div>
            <label className="session-warmup"><input type="checkbox" checked={warmup} onChange={event => onWarmup(event.target.checked)}/><span>Warm-up <small>Keep the planned working set</small></span></label>
            {!editing&&!warmup&&programWeightChanged&&<label className="session-save-weight"><input type="checkbox" checked={saveWeight} onChange={event=>onSaveWeight?.(event.target.checked)}/><span>Save this weight to program<small>Later working sets use your last logged weight. Warm-ups stay separate.</small></span></label>}
            <div className="session-entry-actions"><Button className="session-save-set" onClick={onSaveSet}><Check aria-hidden="true"/>{editing ? 'Save correction' : 'Save set'}</Button>
            {!editing && <Button variant="ghost" className="session-skip-set" onClick={onSkipSet}><SkipForward aria-hidden="true"/>Skip set</Button>}</div>
          </fieldset>{editing && <Button variant="ghost" className="session-cancel-correction" disabled={locked} onClick={onCancelCorrection}>Cancel correction</Button>}
        </div> : <div className="session-all-done">
          <span className="session-complete-icon"><Check aria-hidden="true"/></span>
          <p className="session-eyebrow">Session plan complete</p>
          <h3>Ready to finish?</h3>
          <p>{completed} working sets logged{skipped > 0 ? ` · ${skipped} skipped` : ''}. Review your sets or finish to save this session to history.</p>
          <Button onClick={onFinish} disabled={locked || setDirty}>Finish workout<Check aria-hidden="true"/></Button>
        </div>}
        </div>
      </div>
    </div>
  </section>;
}
