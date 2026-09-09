import {dateSchema} from './domain.ts';
// Carry only a calendar date through sign-in, never a caller-supplied redirect URL.
export function savedDayQuery(value:unknown){const date=dateSchema.safeParse(value);return date.success?'?date='+encodeURIComponent(date.data):'';}
