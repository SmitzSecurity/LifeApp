// Binding surface used by LifeApp. No runtime values or credentials live here.
declare module "cloudflare:workers" {
  export const env: import("./lib/auth/config").AuthEnvironment & import("./lib/life/ai-configuration").AIEnvironment & { DB?: import("./lib/life/service").Database };
}
