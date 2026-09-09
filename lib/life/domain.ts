import { reviewPreferencesSchema, defaultReviewPreferences } from './reviews.ts';
import { z } from "zod/v3";
export const modules = [
{id:"reflection",name:"Journal",hint:"A little room to think.",prompt:"What stood out today?",habit:"Take five minutes to reflect",glyph:"◈"},
{id:"fitness",name:"Movement",hint:"Build a rhythm that feels good.",prompt:"How did you move or recover?",habit:"Move for 20 minutes",glyph:"↗"},
{id:"work",name:"Work & learning",hint:"Make space for meaningful progress.",prompt:"What did you move forward?",habit:"Complete one focused work session",glyph:"▤"},
{id:"money",name:"Money",hint:"Notice the choices you make.",prompt:"Any spending or money decisions to note?",habit:"Review today's spending",glyph:"◎"},
{id:"social",name:"Connection",hint:"Be intentional with your people.",prompt:"Who did you connect with?",habit:"Reach out to someone I care about",glyph:"◇"},
{id:"spiritual",name:"Spiritual life",hint:"Optional. Guided by your own tradition.",prompt:"What would you like to reflect on spiritually?",habit:"Make time for my chosen spiritual practice",glyph:"✧"},
] as const;
export const moduleId=z.enum(["reflection","fitness","work","money","social","spiritual"]);
export const coreModules=['reflection','fitness','money'] as const;
export const withCoreModules=(ids:readonly z.infer<typeof moduleId>[])=>[...new Set<z.infer<typeof moduleId>>([...coreModules,...ids])];
export const statusSchema=z.enum(["unrecorded","done","missed","exempt"]);
export type HabitStatus=z.infer<typeof statusSchema>;
export const habitSchema=z.object({id:z.string().uuid(),title:z.string().trim().min(1).max(100),module:moduleId,archived:z.boolean()}).strict();
export const profileSchema=z.object({
goal:z.string().trim().max(300),
budgetGoals:z.object({spending:z.string().max(1000),saving:z.string().max(1000),investing:z.string().max(1000)}).strict().nullable().default(null),
analysisGuidance:z.array(z.object({id:z.string().uuid(),text:z.string().trim().min(1).max(500),createdAt:z.string().datetime(),sourceDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),cadence:z.enum(['daily','weekly','monthly','annual'])}).strict()).max(12).default([]),
reviewPreferences:reviewPreferencesSchema.default(defaultReviewPreferences),
timezone:z.string().max(80).refine(v=>{try{new Intl.DateTimeFormat("en",{timeZone:v});return true}catch{return false}},"Choose a valid timezone"),
timezoneMode:z.enum(["automatic","manual"]).default("automatic"),
moduleGoals:z.record(moduleId,z.string().trim().max(1000)).default({}),
spiritualTradition:z.string().trim().max(200).default(""),
modules:z.array(moduleId).min(1).max(6).refine(ids=>new Set(ids).size===ids.length,'Duplicate modules').transform(withCoreModules),habits:z.array(habitSchema).max(50),version:z.number().int().min(0)
}).strict().superRefine((v,c)=>{
if(new Set(v.modules).size!==v.modules.length)c.addIssue({code:"custom",message:"Duplicate modules"});
if(new Set(v.habits.map(h=>h.id)).size!==v.habits.length)c.addIssue({code:"custom",message:"Duplicate habits"});
if(new Set(v.analysisGuidance.map(g=>g.id)).size!==v.analysisGuidance.length)c.addIssue({code:'custom',message:'Duplicate guidance'});
});
export type Profile=z.infer<typeof profileSchema>;
export type Habit=z.infer<typeof habitSchema>;
export type RecordedHabit=Omit<Habit,"archived">&{status:HabitStatus};
export type Entry={date:string;journal:string;context:Partial<Record<z.infer<typeof moduleId>,string>>;habits:RecordedHabit[];version:number;mutationId?:string;complete?:boolean;updatedAt?:string};
export const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+"T12:00:00Z");return !isNaN(d.valueOf())&&d.toISOString().slice(0,10)===v},"Choose a real date");
export const entryInputSchema=z.object({date:dateSchema,mutationId:z.string().uuid().optional(),complete:z.boolean().default(false),journal:z.string().max(6000),context:z.record(moduleId,z.string().max(2000)),statuses:z.array(z.object({id:z.string().uuid(),status:statusSchema}).strict()).max(50),version:z.number().int().min(0)}).strict();
export function todayIn(timezone:string,now=new Date()):string{
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
 return ["year","month","day"].map(k=>parts.find(p=>p.type===k)!.value).join("-");
}
export function activeHabits(p:Profile):Habit[]{return p.habits.filter(h=>!h.archived&&p.modules.includes(h.module));}
export function emptyEntry(p:Profile,date:string):Entry{return{date,complete:false,journal:"",context:{},habits:activeHabits(p).map(({archived,...h})=>({...h,status:"unrecorded"})),version:0};}
export function score(habits:Pick<RecordedHabit,"status">[]){
const done=habits.filter(h=>h.status==="done").length,missed=habits.filter(h=>h.status==="missed").length,exempt=habits.filter(h=>h.status==="exempt").length;
const eligible=done+missed,unrecorded=habits.length-eligible-exempt;
return{done,missed,exempt,unrecorded,eligible,percent:eligible?Math.round(done/eligible*100):null};
}

export const standardHabits:Record<Profile["modules"][number],string[]>={
reflection:["Write a daily journal","Name three things I am grateful for","Take five minutes to reflect","Keep my planned bedtime","Spend ten minutes without screens","Practice a breathing exercise"],
fitness:["Follow my planned workout","Take a walk","Do a mobility session","Prepare a balanced meal","Take a planned recovery day","Drink water with meals"],
work:["Complete one focused work session","Read for 20 minutes","Practice a skill","Choose my top priority","Review what I learned","Plan tomorrow's work"],
money:["Log today's transactions","Review my spending plan","Check before an unplanned purchase","Prepare food for tomorrow","Review my savings goal","Complete my planned savings transfer"],
social:["Reach out to someone I care about","Have a conversation without my phone","Make time for family","Express appreciation","Follow through on a commitment","Make plans with a friend"],
spiritual:["Make time for my chosen spiritual practice","Pray or meditate","Read a text from my tradition","Reflect on my intentions","Practice generosity","Follow a personally chosen observance"]
};
