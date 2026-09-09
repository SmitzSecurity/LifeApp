import {defineConfig} from 'vite';
import vinext from 'vinext';
import {existsSync} from 'node:fs';
export default defineConfig(async()=>{
 const {cloudflare}=await import('@cloudflare/vite-plugin');
 return {
  server:{host:'127.0.0.1',port:3000,strictPort:true},
  plugins:[vinext(),cloudflare({
   configPath:process.env.LIFEAPP_CLOUDFLARE_BUILD==='true'?'wrangler.cloudflare.generated.json':existsSync('wrangler.standalone.local.json')?'wrangler.standalone.local.json':'wrangler.standalone.json',
   viteEnvironment:{name:'rsc',childEnvironments:['ssr']},inspectorPort:false,
  })]
 };
});
