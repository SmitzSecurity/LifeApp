"use client";

import { useEffect, useId, useRef, useState } from 'react';
import { Check, CircleHelp, Info, Plus, SkipForward, Vibrate, VibrateOff, Volume2, VolumeX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/life/date-display';
import { repTarget } from '@/lib/life/exercise-presets';
import { exerciseGuide } from '@/lib/life/exercise-guides';
import { nextSet, type Exercise, type Saved, type Workout } from '@/lib/life/modules';
import ExerciseSymbol from './exercise-symbol';
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
  onCancelCorrection: () => void;
};

/** The parent owns saved records, drafts, timers and exact write retries. */
export default function WorkoutSession({
  workout, target, previousPerformance, previousPerformanceLoading = false, previousPerformanceUnavailable = false, reps, load, warmup, remaining, editing, busy,
  pending = false, setDirty, sound, onSound, vibration, onVibration, supportsVibration,
  onReps, onLoad, onWarmup, onSaveSet, onSkipSet, onSkipRest,
  onExtendRest, onPlan, onFinish, onExit, onCancelCorrection,
}: WorkoutSessionProps) {
  const id = useId();
  const [demonstrationPlayback, setDemonstrationPlayback] = useState<'auto' | 'play' | 'pause'>('auto');
  const plan = workout.data;
  const current = nextSet(plan);
  const completed = plan.sets.filter(set => !set.warmup).length;
  const skipped = plan.skippedSets?.length ?? 0;
  const resting = remaining > 0 && !editing;
  const locked = busy || pending;
  const exerciseIndex = target ? plan.exercises.findIndex(exercise => exercise.id === target.exercise.id) : -1;
  const following = target ? plan.exercises[exerciseIndex + 1] : undefined;
  const clock = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
  }, [resting, editing, target?.exercise.id, target?.setNumber, target?.workingSetNumber]);

  return <section className="workout-session" aria-label="Active workout">
    <div className={`session-stage${resting ? ' session-stage-rest' : ''}`}>
      <div className="session-focus">
        <div className="session-controls">
          <Button variant="ghost" size="icon" onClick={onExit} disabled={locked} aria-label="Workout options" title="Workout options"><X aria-hidden="true"/></Button>
          <div className="session-utilities">
            <Button variant="ghost" size="icon" onClick={onPlan} disabled={locked} aria-label="Workout information" title="Workout information"><Info aria-hidden="true"/></Button>
            <Button variant="ghost" size="icon" onClick={onSound} aria-label="Rest sound" aria-pressed={sound} title={sound ? 'Rest sound on' : 'Rest sound off'}>{sound ? <Volume2 aria-hidden="true"/> : <VolumeX aria-hidden="true"/>}</Button>
            <Button variant="ghost" size="icon" onClick={onVibration} disabled={!supportsVibration} aria-label="Rest vibration" aria-pressed={vibration} title={!supportsVibration ? 'Vibration unavailable in this browser' : vibration ? 'Rest vibration on' : 'Rest vibration off'}>{vibration ? <Vibrate aria-hidden="true"/> : <VibrateOff aria-hidden="true"/>}</Button>
          </div>
        </div>
        <div className="session-content" ref={content}>
        {resting ? <div className="session-rest">
          {current ? <div className="session-up-next">
            <span>Up next · Working set {current.workingSetNumber} of {current.exercise.sets}</span>
            <ExerciseHeading name={current.exercise.name}/>
            <p>Target {repTarget(current.exercise)} reps · {current.exercise.load} {current.exercise.unit}</p>
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
            <ExerciseSymbol name={target.exercise.name} playback={demonstrationPlayback} onPlayback={setDemonstrationPlayback}/>
            <p className="session-set-number">{editing ? `Logged set ${target.setNumber}` : `Working set ${target.workingSetNumber ?? current?.workingSetNumber ?? 1} of ${target.exercise.sets}`}</p>
            <div className="session-targets"><span>Target {repTarget(target.exercise)} reps</span><span>{target.exercise.restSeconds}s rest</span></div>
            {!editing && !warmup && <p className="session-previous-performance" aria-live="polite">
              {previousPerformanceLoading ? 'Loading last performance…' : previousPerformanceUnavailable ? 'Previous set unavailable.' : previousPerformance
                ? <>Last time <strong>{previousPerformance.reps} reps × {previousPerformance.load} {previousPerformance.unit}</strong><span> · {formatDate(previousPerformance.date)} · {previousPerformance.workoutName}</span></>
                : 'No previous performance for this set.'}
            </p>}
          </div>
          <fieldset className="session-set-entry" disabled={locked}>
            <legend className="sr-only">{editing ? 'Correct logged reps and load' : 'Log your completed set'}</legend>
            {!editing && <p className="session-ready" role="status">{plan.restUntil ? 'Rest complete. Ready for your next set.' : 'Ready when you are'}</p>}
            <div className="session-inputs">
              <label htmlFor={`${id}-reps`}><span>Reps completed</span><input id={`${id}-reps`} type="number" inputMode="numeric" min={0} max={100} step={1} value={reps} onChange={event => onReps(event.target.value)}/></label>
              <label htmlFor={`${id}-load`}><span>Load ({target.exercise.unit})</span><input id={`${id}-load`} inputMode="decimal" aria-describedby={`${id}-bodyweight`} value={load} onChange={event => onLoad(event.target.value)}/><small id={`${id}-bodyweight`}>Use 0 for bodyweight.</small></label>
            </div>
            <label className="session-warmup"><input type="checkbox" checked={warmup} onChange={event => onWarmup(event.target.checked)}/><span>Warm-up <small>Keep the planned working set</small></span></label>
            <Button className="session-save-set" onClick={onSaveSet}><Check aria-hidden="true"/>{editing ? 'Save correction' : target.exercise.restSeconds ? 'Save set & start rest' : 'Save set'}</Button>
            {!editing && <Button variant="ghost" className="session-skip-set" onClick={onSkipSet}><SkipForward aria-hidden="true"/>Skip set</Button>}
            {editing && <Button variant="ghost" className="session-cancel-correction" onClick={onCancelCorrection}>Cancel correction</Button>}
          </fieldset>
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
