"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import Image from 'next/image';
import { Pause, Play } from 'lucide-react';
import { exerciseSymbol } from '@/lib/life/exercise-symbols';
import './exercise-symbol.css';

const motionQuery='(prefers-reduced-motion: reduce)';
const subscribeMotion=(notify:()=>void)=>{const query=matchMedia(motionQuery);query.addEventListener('change',notify);return()=>query.removeEventListener('change',notify);};
const reducedMotion=()=>matchMedia(motionQuery).matches;
const subscribeVisibility=(notify:()=>void)=>{document.addEventListener('visibilitychange',notify);return()=>document.removeEventListener('visibilitychange',notify);};
const documentIsVisible=()=>!document.hidden;
const serverReducedMotion=()=>true;
const serverVisible=()=>true;

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
  const [motionFrame, setMotionFrame] = useState({key:frameKey,index:0});
  if(motionFrame.key!==frameKey)setMotionFrame({key:frameKey,index:0});
  const frame=motionFrame.key===frameKey?motionFrame.index:0;
  const reduceMotion=useSyncExternalStore(subscribeMotion,reducedMotion,serverReducedMotion);
  const [visible, setVisible] = useState(true);
  const documentVisible=useSyncExternalStore(subscribeVisibility,documentIsVisible,serverVisible);
  const playing = animated && playback !== 'pause' && (!reduceMotion || playback === 'play');

  useEffect(() => {
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)));
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const frameCount=frames.length;
  useEffect(() => {
    if (!playing || !visible || !documentVisible) return;
    const order = frameCount === 3 ? [0, 1, 2, 1] : Array.from({length:frameCount},(_, index) => index);
    let position = 0;
    const timer = setInterval(() => { position = (position + 1) % order.length; setMotionFrame({key:frameKey,index:order[position]}); }, 1200);
    return () => clearInterval(timer);
  }, [frameKey, frameCount, playing, visible, documentVisible]);

  if (!art) return <div className="exercise-symbol exercise-symbol-fallback" ref={container} aria-hidden="true">
    <svg viewBox="0 0 240 240" focusable="false"><g transform="translate(120 120) rotate(-32)" fill="currentColor">
      <rect x="-71" y="-38" width="26" height="76" rx="10"/><rect x="45" y="-38" width="26" height="76" rx="10"/>
      <rect x="-45" y="-8" width="90" height="16" rx="8"/><path d="M-82-19V19M82-19V19" stroke="currentColor" strokeWidth="9" strokeLinecap="round"/>
    </g></svg>
  </div>;

  return <div className="exercise-symbol exercise-demonstration" ref={container} role="group" aria-label={`${name} demonstration`} data-exercise-art={art.slug}>
    {art.presentation === 'image'
      ? frames.map((src, index) => <Image key={src} className="exercise-motion-frame" src={src} width={320} height={320} unoptimized loading="eager" alt="" aria-hidden="true" draggable={false} hidden={index !== frame % frames.length}/> )
      : <span className="exercise-symbol-art" aria-hidden="true" style={{ '--exercise-art': `url("${art.src}")` } as CSSProperties}/>}
    {animated && <button type="button" className="exercise-motion-toggle" onClick={() => onPlayback(playing ? 'pause' : 'play')}
      aria-label={playing ? 'Pause exercise demonstration' : 'Play exercise demonstration'} title={playing ? 'Pause demonstration' : 'Play demonstration'}>
      {playing ? <Pause aria-hidden="true"/> : <Play aria-hidden="true"/>}
    </button>}
  </div>;
}
