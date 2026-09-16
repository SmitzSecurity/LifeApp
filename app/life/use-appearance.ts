"use client";
import {useEffect} from 'react';
import {appearanceCacheKey,defaultAppearance,themeColors,themeVariables,typographyVariables,type Appearance} from '@/lib/life/appearance';
export function useAppearance(saved:Appearance|undefined,preview:Appearance|undefined,loaded:boolean){
 useEffect(()=>{if(!loaded)return;const value=preview||saved||defaultAppearance(),root=document.documentElement;for(const [key,setting] of Object.entries({...themeVariables(themeColors(value)),...typographyVariables(value.typography)}))root.style.setProperty(key,setting);root.style.colorScheme=value.mode==='light'?'light':'dark';root.dataset.theme=value.mode;},[saved,preview,loaded]);
 useEffect(()=>{if(!loaded)return;try{localStorage.setItem(appearanceCacheKey,JSON.stringify(saved||defaultAppearance()));}catch{}},[saved,loaded]);
}
