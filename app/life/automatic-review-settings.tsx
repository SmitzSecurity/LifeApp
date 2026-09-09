"use client";
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { AutomaticConsent } from '@/lib/life/automatic-consent';
import { request } from './shared';

type State = { consent: AutomaticConsent; available: boolean; schedule: { enabled: boolean; time: string; timezone: string } | null };
export default function AutomaticReviewSettings({ setupDirty }: { setupDirty: boolean }) {
  const [data, setData] = useState<State | null>(null), [agreed, setAgreed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function refresh() {
    try { setData(await request('?automatic=1')); } catch { setError('Automatic review settings are unavailable. Refresh to check your saved choice.'); }
  }
  useEffect(() => { void refresh(); }, []);
  async function save(enabled: boolean) {
    if (!data || (enabled && !agreed)) return;
    setBusy(true); setError('');
    try { setData(await request('', { action: 'automatic-consent', consent: { enabled, version: data.consent.version, policyVersion: data.consent.policyVersion } })); setAgreed(false); }
    catch (e) { setError((e as Error).message); await refresh(); }
    finally { setBusy(false); }
  }
  return <section className="review-settings">
    <h3>Automatic daily reviews</h3>
    <p className="muted">Choose whether LifeApp can send your completed check-ins, saved goals and feedback preferences, and relevant enabled budget/workout records to Google Gemini automatically. Reviews use your saved daily time and timezone, starting with the day you opt in.</p>
    <p className="muted">Unfinished days wait. If you finish a scheduled day later, it can run on a later schedule check. Existing reviews stay in history. Automatic reviews share your AI usage limit; no customer payment is collected.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {!data ? <Button variant="outline" onClick={refresh}>Refresh settings</Button> : <>
      {data.schedule && <p>Saved schedule: {data.schedule.time} · {data.schedule.timezone}{!data.schedule.enabled ? ' · daily reviews off' : ''}</p>}
      <p role="status">{data.consent.enabled ? `You opted in for check-ins dated ${data.consent.startDate} onward.` : 'Automatic analysis is off for your account.'}{!data.available ? ' The automatic service is awaiting activation.' : ''}</p>
      {setupDirty && <p className="completion-help">Save your setup changes before turning automatic analysis on.</p>}
      {data.consent.enabled ? <Button variant="outline" disabled={busy} onClick={() => save(false)}>{busy ? 'Saving…' : 'Turn off automatic analysis'}</Button> : <>
        <label className="inline-check"><Checkbox checked={agreed} disabled={busy || setupDirty || !data.available || !data.schedule?.enabled} onCheckedChange={v => setAgreed(v === true)} />I agree to automatic use of this saved context for daily AI analysis.</label>
        <Button disabled={busy || !agreed || setupDirty || !data.available || !data.schedule?.enabled} onClick={() => save(true)}>{busy ? 'Saving…' : 'Turn on automatic analysis'}</Button>
      </>}
      <small>Turning this off blocks new automatic reviews. A review already started may still finish and use tokens. This choice saves separately from your setup. It does not enable email or external searches.</small>
    </>}
  </section>;
}
