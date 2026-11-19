import fs from 'node:fs';
import pg from 'pg';
for (const line of fs.readFileSync('.env','utf8').split(/\r?\n/)) {
  const i=line.indexOf('='); if(i<1 || line.startsWith('#')) continue;
  let value=line.slice(i+1); if (/^(['"]).*\1$/.test(value)) value=value.slice(1,-1);
  process.env[line.slice(0,i)]=value;
}
const db=new pg.Client({connectionString:process.env.DATABASE_URL});
try { await db.connect(); await db.query(fs.readFileSync('sql/005_app.sql','utf8')); console.log('App schema ready'); }
finally { await db.end(); }
