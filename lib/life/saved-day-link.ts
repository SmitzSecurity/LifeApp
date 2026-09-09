import {dateSchema} from './domain.ts';
import {cadenceSchema} from './reviews.ts';
// Carry only a calendar date through sign-in, never a caller-supplied redirect URL.
export function savedDayQuery(value:unknown,analysis:unknown=undefined){const date=dateSchema.safeParse(value),cadence=cadenceSchema.safeParse(analysis||'daily');return date.success&&cadence.success?'?date='+encodeURIComponent(date.data)+(cadence.data!=='daily'?'&analysis='+cadence.data:''):'';}
