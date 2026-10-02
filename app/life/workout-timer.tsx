"use client";

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Bell, BellOff, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { restNotification, timerSeconds, timerText, type WorkoutTimer } from '@/lib/life/workout-timer';
import './workout-timer.css';

const notificationTag = 'life-workout-rest';
// One tag is shared by successive account shells, so their browser writes must
// share a queue too. A superseded shell may never close the next shell's notice.
const notificationQueue = { pending: Promise.resolve(), revision: 0 };
const subscribeCapabilities = () => () => {};
const supportsNotifications = () => typeof Notification !== 'undefined' && 'serviceWorker' in navigator;
const serverCapabilities = () => false;
const TimerContext = createContext({
  timer: null as WorkoutTimer, now: 0, enabled: false, supported: false, message: '',
  setWorkoutTimer: (value: WorkoutTimer) => { void value; }, toggleNotifications: async () => {},
});
export const useWorkoutTimer = () => useContext(TimerContext);

export function WorkoutTimerProvider({ children }: { children: ReactNode }) {
  const [timer, setWorkoutTimer] = useState<WorkoutTimer>(null);
  const [now, setNow] = useState(Date.now);
  const [enabled, setEnabled] = useState(false), [message, setMessage] = useState('');
  const supported = useSyncExternalStore(subscribeCapabilities, supportsNotifications, serverCapabilities);
  const lastShown = useRef('');
  const mounted = useRef(true), notificationIntent = useRef(false), permissionSerial = useRef(0);
  useEffect(() => {
    if (!timer) return;
    const tick = () => setNow(Date.now());
    tick();
    const interval = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', tick); };
  }, [timer]);
  const complete = timerSeconds(timer, now) === 0;
  useEffect(() => {
    const notice = enabled ? restNotification(timer, Date.now()) : null;
    const revision = ++notificationQueue.revision;
    notificationQueue.pending = notificationQueue.pending.catch(() => {}).then(async () => {
      if (!supported || revision !== notificationQueue.revision) return;
      const registration = await navigator.serviceWorker.getRegistration('/');
      if (!registration || revision !== notificationQueue.revision) return;
      if (!notice || Notification.permission !== 'granted') {
        const shownNotifications = await registration.getNotifications({ tag: notificationTag });
        if (revision !== notificationQueue.revision) return;
        for (const shown of shownNotifications) shown.close();
        lastShown.current = '';
        return;
      }
      if (lastShown.current === notice.key) return;
      await registration.showNotification(notice.title, { body: notice.body, tag: notificationTag,
        silent: true, data: { type: 'workout-rest' } });
      lastShown.current = notice.key;
    }).catch(() => { if (mounted.current && revision === notificationQueue.revision) setMessage('Phone notifications are unavailable. The timer in LifeApp is still running.'); });
    // The key changes only for a new deadline or completion, never every second.
  }, [timer, complete, enabled, supported]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; notificationIntent.current = false; permissionSerial.current += 1;
      const revision = ++notificationQueue.revision;
      if ('serviceWorker' in navigator) notificationQueue.pending = notificationQueue.pending.catch(() => {}).then(async () => {
        if (revision !== notificationQueue.revision) return;
        const registration = await navigator.serviceWorker.getRegistration('/');
        if (!registration || revision !== notificationQueue.revision) return;
        const shownNotifications = await registration.getNotifications({ tag: notificationTag });
        if (revision !== notificationQueue.revision) return;
        for (const shown of shownNotifications) shown.close();
        lastShown.current = '';
      }).catch(() => {});
    };
  }, []);
  async function toggleNotifications() {
    const revision = ++permissionSerial.current;
    if (notificationIntent.current) { notificationIntent.current = false; setEnabled(false); setMessage(''); return; }
    if (!supported) { setMessage('Phone notifications are unavailable here. On iPhone, add LifeApp to your Home Screen and open it there.'); return; }
    notificationIntent.current = true;
    try {
      const permission = await Notification.requestPermission();
      if (!mounted.current || revision !== permissionSerial.current) return;
      if (permission !== 'granted') { notificationIntent.current = false; setMessage('Allow notifications in your browser settings to show the rest deadline on your phone.'); return; }
      const registration = await navigator.serviceWorker.getRegistration('/');
      if (!mounted.current || revision !== permissionSerial.current) return;
      if (!registration) throw Error('unavailable');
      setEnabled(true); setMessage('');
    } catch { if (mounted.current && revision === permissionSerial.current) { notificationIntent.current = false; setMessage('Phone notifications are unavailable here. The timer in LifeApp is still running.'); } }
  }
  return <TimerContext.Provider value={{ timer, now, enabled, supported, message, setWorkoutTimer, toggleNotifications }}>{children}</TimerContext.Provider>;
}

export function WorkoutHeaderTimer({ onOpen }: { onOpen: () => void }) {
  const { timer, now } = useWorkoutTimer();
  if (!timer?.restUntil) return null;
  const seconds = timerSeconds(timer, now);
  return <Button className="workout-header-timer" variant="ghost" onClick={()=>{onOpen();window.dispatchEvent(new Event('life:resume-workout'));}}
    title="Return to workout" aria-label={`Return to workout · ${seconds ? `rest ${timerText(seconds)}` : 'rest complete'}`}>
    <Timer aria-hidden="true"/><span>{seconds ? timerText(seconds) : 'Ready'}</span>
  </Button>;
}

export function WorkoutNotificationControl() {
  const { enabled, message, toggleNotifications } = useWorkoutTimer();
  return <div className="workout-notifications"><Button variant="outline" aria-pressed={enabled} onClick={() => void toggleNotifications()}>
    {enabled ? <Bell aria-hidden="true"/> : <BellOff aria-hidden="true"/>}Phone rest notifications {enabled ? 'on' : 'off'}
  </Button><p className="muted">Show the rest end time in your phone’s notification panel. Completion updates require LifeApp to keep running; your phone may pause it in the background. On iPhone, open LifeApp from your Home Screen.</p>
  {message && <p role="status">{message}</p>}</div>;
}
