"use client";
import {useEffect,useState} from 'react';

// Keep saved aliases (for example US/Eastern) intact; choosing a zone is explicit.
const common=['UTC','America/New_York','America/Chicago','America/Denver','America/Phoenix','America/Los_Angeles','America/Anchorage','Pacific/Honolulu','Europe/London','Europe/Paris','Asia/Kolkata','Asia/Tokyo','Australia/Sydney'];
export default function TimezoneSelect({value,disabled,onChange}:{value:string;disabled:boolean;onChange:(zone:string)=>void}){
 const [zones,setZones]=useState(common);
 useEffect(()=>{try{setZones(Intl.supportedValuesOf('timeZone'));}catch{/* Older browsers keep the common choices and current value. */}},[]);
 const choices=[...new Set(['UTC',value,...zones])].sort();
 return <label className="compact-field">Timezone<select disabled={disabled} value={value} onChange={e=>onChange(e.target.value)}>{choices.map(zone=><option key={zone} value={zone}>{zone.replaceAll('_',' ').replaceAll('/',' / ')}</option>)}</select></label>;
}
