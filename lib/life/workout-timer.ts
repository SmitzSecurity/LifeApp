export type WorkoutTimer = { id: string; restUntil: string | null } | null;

export function timerSeconds(timer: WorkoutTimer, now: number): number {
  const end = timer?.restUntil ? Date.parse(timer.restUntil) : NaN;
  return Number.isFinite(end) ? Math.max(0, Math.ceil((end - now) / 1000)) : 0;
}

export function timerText(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function restNotification(timer: WorkoutTimer, now: number) {
  if (!timer?.restUntil || !Number.isFinite(Date.parse(timer.restUntil))) return null;
  const end = new Date(timer.restUntil);
  const complete = timerSeconds(timer, now) === 0;
  return {
    key: `${timer.id}:${timer.restUntil}:${complete ? 'complete' : 'rest'}`,
    title: complete ? 'LifeApp · Rest complete' : 'LifeApp · Workout rest',
    body: complete ? 'Ready for your next set. Tap to return to your workout.'
      : `Rest ends at ${end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}. Tap to return to your workout.`,
  };
}
