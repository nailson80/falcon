import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
const envPath='.env';let content=fs.readFileSync(envPath,'utf8');
for(const line of content.split(/\r?\n/)){const i=line.indexOf('=');if(i<1||line.startsWith('#'))continue;let v=line.slice(i+1);if(/^(['"]).*\1$/.test(v))v=v.slice(1,-1);process.env[line.slice(0,i)]=v}
if(!process.env.TEST_USER_PASSWORD){const password=crypto.randomBytes(18).toString('base64url');fs.appendFileSync(envPath,`\nTEST_USER_PASSWORD=${password}\n`,{mode:0o600});process.env.TEST_USER_PASSWORD=password}
const authUrl=process.env.NEON_AUTH_URL;
async function authPost(path,body){const r=await fetch(`${authUrl}/${path}`,{method:'POST',headers:{'content-type':'application/json',Origin:new URL(authUrl).origin},body:JSON.stringify(body)});return {status:r.status,body:await r.json()}}
const db=new pg.Client({connectionString:process.env.DATABASE_URL});
const slug=s=>s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'.').replace(/^\.|\.$/g,'');
await db.connect();
try{
 const advisors=(await db.query('SELECT advisor_name FROM core.advisor ORDER BY advisor_name')).rows.map(x=>x.advisor_name);
 const users=[{name:'Falcon Operations',email:'operations@falcon.example',role:'operations',advisor:null},...advisors.map(name=>({name,email:`${slug(name)}@falcon.example`,role:'advisor',advisor:name}))];
 for(const user of users){
  let result=await authPost('sign-up/email',{email:user.email,password:process.env.TEST_USER_PASSWORD,name:user.name});
  if(result.status!==200) result=await authPost('sign-in/email',{email:user.email,password:process.env.TEST_USER_PASSWORD});
  if(result.status!==200)throw new Error(`${user.email}: Neon Auth returned ${result.status} ${result.body.code||''}`);
  const id=result.body.user?.id;
  if(!id)throw new Error(`${user.email}: Auth did not return a user ID`);
  await db.query(`INSERT INTO reconciliation.app_user(auth_user_id,role,advisor_name) VALUES($1,$2,$3) ON CONFLICT(auth_user_id) DO UPDATE SET role=EXCLUDED.role,advisor_name=EXCLUDED.advisor_name`,[id,user.role,user.advisor]);
  console.log(user.email,user.role);
 }
 console.log('Shared test password stored only in ignored .env as TEST_USER_PASSWORD');
}finally{await db.end()}
