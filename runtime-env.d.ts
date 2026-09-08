// Binding surface used by LifeApp. No runtime values or credentials live here.
declare module "cloudflare:workers" {
  export const env: import("./lib/auth/config").AuthEnvironment & { GEMINI_API_KEY?:string;LIFEAPP_AI_ENABLED?:string;LIFEAPP_AI_PAID_PROJECT?:string;DB?: import("./lib/life/service").Database };
}
