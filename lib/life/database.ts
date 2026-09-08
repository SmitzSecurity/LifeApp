import { env } from 'cloudflare:workers';
import type { Database } from './service';
export function lifeDatabase():Database{if(!env.DB)throw new Error('LifeApp database unavailable');return env.DB as unknown as Database;}
