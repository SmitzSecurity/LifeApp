"use client";

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Pause, Play } from 'lucide-react';
import { exerciseSymbol } from '@/lib/life/exercise-symbols';
import './exercise-symbol.css';

/** Demonstrations use local, attributed artwork; guides open only on request. */
export default function ExerciseSymbol({ name, playback, onPlayback }: {
  name: string;
  playback: 'auto' | 'play' | 'pause';
  onPlayback: (value: 'play' | 'pause') => void;
}) {
  const art = exerciseSymbol(name);
  const frames = art?.frames ?? [];
  const frameKey = frames.join('|');
  const animated = frames.length > 1;
  const container = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [visible, setVisible] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(true);
  const playing = animated && playback !== 'pause' && (!reduceMotion || playback === 'play');

  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setReduceMotion(preference.matches);
    const visibility = () => setDocumentVisible(!document.hidden);
    motion(); visibility();
    preference.addEventListener('change', motion);
    document.addEventListener('visibilitychange', visibility);
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)));
    if (container.current) observer.observe(container.current);
    return () => { preference.removeEventListener('change', motion); document.removeEventListener('visibilitychange', visibility); observer.disconnect(); };
  }, []);
  useEffect(() => { setFrame(0); }, [frameKey]);
  useEffect(() => {
    if (!playing || !visible || !documentVisible) return;
    const order = frames.length === 3 ? [0, 1, 2, 1] : frames.map((_, index) => index);
    let position = 0;
    const timer = setInterval(() => { position = (position + 1) % order.length; setFrame(order[position]); }, 1200);
    return () => clearInterval(timer);
  }, [frameKey, playing, visible, documentVisible]);

  if (!art) return <div className="exercise-symbol exercise-symbol-fallback" ref={container} aria-hidden="true">
    <svg viewBox="0 0 240 240" focusable="false"><g transform="translate(120 120) rotate(-32)" fill="currentColor">
      <rect x="-71" y="-38" width="26" height="76" rx="10"/><rect x="45" y="-38" width="26" height="76" rx="10"/>
      <rect x="-45" y="-8" width="90" height="16" rx="8"/><path d="M-82-19V19M82-19V19" stroke="currentColor" strokeWidth="9" strokeLinecap="round"/>
    </g></svg>
  </div>;

  return <div className="exercise-symbol exercise-demonstration" ref={container} role="group" aria-label={`${name} demonstration`} data-exercise-art={art.slug}>
    {art.presentation === 'image'
      ? frames.map((src, index) => <img key={src} className="exercise-motion-frame" src={src} alt="" aria-hidden="true" draggable={false} hidden={index !== frame % frames.length}/> )
      : <span className="exercise-symbol-art" aria-hidden="true" style={{ '--exercise-art': `url("${art.src}")` } as CSSProperties}/>}
    {animated && <button type="button" className="exercise-motion-toggle" onClick={() => onPlayback(playing ? 'pause' : 'play')}
      aria-label={playing ? 'Pause exercise demonstration' : 'Play exercise demonstration'} title={playing ? 'Pause demonstration' : 'Play demonstration'}>
      {playing ? <Pause aria-hidden="true"/> : <Play aria-hidden="true"/>}
    </button>}
  </div>;
}
