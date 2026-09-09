import {z} from 'zod/v3';
import type {LifeAppEmailBindings} from '../../worker-email-bindings';
import type {EmailSettings} from './email-service.ts';

export type EmailEnvironment=Partial<LifeAppEmailBindings>&{LIFEAPP_AUTH_MODE?:string;LIFEAPP_EMAIL_ENABLED?:string;LIFEAPP_EMAIL_FROM?:string;BETTER_AUTH_URL?:string;LIFEAPP_BETA_EMAILS?:string};
export function settingsForEmail(env:EmailEnvironment):EmailSettings{
 const address=z.string().email().max(254).safeParse(env.LIFEAPP_EMAIL_FROM);
 let origin='';try{const url=new URL(env.BETTER_AUTH_URL||'');if(url.protocol==='https:'&&!url.username&&!url.password)origin=url.origin;}catch{}
 const binding=env.REPORT_EMAILS;
 return {enabled:env.LIFEAPP_AUTH_MODE==='google'&&env.LIFEAPP_EMAIL_ENABLED==='true',from:address.success?address.data:'',origin,
  allowedEmails:(env.LIFEAPP_BETA_EMAILS||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean),
  send:binding?message=>binding.send(message):null};
}
