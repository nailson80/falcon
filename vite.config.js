import {defineConfig,loadEnv} from 'vite';
export default defineConfig(({mode})=>{
  const env=loadEnv(mode,process.cwd(),'');
  return {define:{'import.meta.env.VITE_NEON_AUTH_URL':JSON.stringify(env.VITE_NEON_AUTH_URL||env.NEON_AUTH_URL||'')}};
});
