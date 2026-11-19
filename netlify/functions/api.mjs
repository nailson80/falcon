import pg from 'pg';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {explainException} from '../../src/exception-ai.mjs';

const authUrl=process.env.NEON_AUTH_URL?.replace(/\/$/,'');
const jwks=authUrl && createRemoteJWKSet(new URL(`${authUrl}/.well-known/jwks.json`));
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3});
const json=(status,body)=>({statusCode:status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'},body:JSON.stringify(body)});
const fail=(status,message)=>json(status,{error:message});
function route(event){return (event.path||'').replace(/^\/\.netlify\/functions\/api/,'').replace(/^\/api/,'')||'/';}
async function identity(event){
  const token=/^Bearer (.+)$/i.exec(event.headers.authorization||event.headers.Authorization||'')?.[1];
  if(!token||!jwks) throw Object.assign(new Error('Sign in required'),{status:401});
  const {payload}=await jwtVerify(token,jwks,{algorithms:['RS256','ES256','EdDSA']});
  if(!payload.sub || payload.iss!==new URL(authUrl).origin) throw Object.assign(new Error('Invalid session'),{status:401});
  const {rows}=await pool.query('SELECT auth_user_id,role,advisor_name FROM reconciliation.app_user WHERE auth_user_id=$1',[payload.sub]);
  if(!rows[0]) throw Object.assign(new Error('Account has no app access'),{status:403});
  return rows[0];
}
const operations=(user)=>{if(user.role!=='operations')throw Object.assign(new Error('Operations access required'),{status:403});};
async function listExceptions(user){
  const {rows}=await pool.query(`SELECT s.run_id,s.source_kind,s.source_file,s.source_row,s.custodian,s.account_number_key,
    s.sf_account_id,s.status,s.reason_codes,s.counterpart_source_file,s.counterpart_source_row,
    sa.sf_household_id, h.household_name,h.primary_advisor_name,
    ar.sf_household_id AS resolved_household_id,
    COALESCE(hm.target_household_id,ar.sf_household_id,sa.sf_household_id) AS canonical_household_id,
    COALESCE(ch.household_name,rh.household_name,h.household_name) AS canonical_household_name,
    CASE WHEN s.status='custodian_only' AND ar.proposal_id IS NOT NULL THEN 'linked'
         WHEN er.review_outcome='accepted_as_reported' THEN 'accepted'
         WHEN er.review_outcome='needs_source_follow_up' THEN 'follow_up'
         WHEN EXISTS (SELECT 1 FROM reconciliation.proposed_change p WHERE p.status='pending' AND
           ((p.action='resolve_exception' AND p.target_run_id=s.run_id AND p.target_source_kind=s.source_kind AND p.target_source_file=s.source_file AND p.target_source_row=s.source_row)
           OR (p.action='link_account' AND p.target_account_id=s.custodian||':'||s.account_number_key AND s.status='custodian_only'))) THEN 'pending'
         ELSE 'open' END AS review_state
    FROM reconciliation.current_exceptions s
    LEFT JOIN core.salesforce_account sa ON sa.sf_account_id=s.sf_account_id
    LEFT JOIN core.household h ON h.sf_household_id=sa.sf_household_id
    LEFT JOIN reconciliation.account_household_resolution ar ON ar.custodian=s.custodian AND ar.account_number_key=s.account_number_key AND ar.source_run_id=s.run_id
    LEFT JOIN reconciliation.exception_resolution er ON er.run_id=s.run_id AND er.source_kind=s.source_kind AND er.source_file=s.source_file AND er.source_row=s.source_row
    LEFT JOIN core.household rh ON rh.sf_household_id=ar.sf_household_id
    LEFT JOIN reconciliation.household_merge_resolution hm ON hm.source_household_id=COALESCE(ar.sf_household_id,sa.sf_household_id)
    LEFT JOIN core.household ch ON ch.sf_household_id=hm.target_household_id
    WHERE $1='operations' OR h.primary_advisor_name=$2 OR rh.primary_advisor_name=$2
    ORDER BY s.custodian,s.source_kind,s.source_file,s.source_row`,[user.role,user.advisor_name]);
  return rows;
}
async function households(){const {rows}=await pool.query('SELECT sf_household_id,household_name,primary_advisor_name FROM core.household ORDER BY primary_advisor_name,household_name');return rows;}
async function proposals(){const {rows}=await pool.query(`SELECT p.*,h.household_name AS target_household_name FROM reconciliation.proposed_change p LEFT JOIN core.household h ON h.sf_household_id=p.target_household_id ORDER BY p.proposal_id DESC LIMIT 200`);return rows;}
async function audit(){const {rows}=await pool.query('SELECT * FROM reconciliation.change_audit ORDER BY audit_id DESC LIMIT 300');return rows;}
async function propose(user,input){
  operations(user); const action=input.action, target=input.target_household_id?String(input.target_household_id):null, reason=String(input.rationale||'').trim();
  if(!['link_account','merge_household','resolve_exception'].includes(action)||(!target&&action!=='resolve_exception')||!reason||reason.length>1000)throw Object.assign(new Error('Invalid proposal'),{status:400});
  const client=await pool.connect();try{
    await client.query('BEGIN');
    if(target&&!(await client.query('SELECT 1 FROM core.household WHERE sf_household_id=$1',[target])).rowCount)throw Object.assign(new Error('Unknown target household'),{status:400});
    let account=null,source=null,exception=null;
    if(action==='link_account'){
      const custodian=String(input.custodian||''),key=String(input.account_number_key||'');
      if(!['Fidelity','Schwab'].includes(custodian)||!key||!(await client.query("SELECT 1 FROM reconciliation.current_exceptions WHERE status='custodian_only' AND source_kind='custodian' AND custodian=$1 AND account_number_key=$2",[custodian,key])).rowCount)throw Object.assign(new Error('Unknown custodian account'),{status:400});
      account=`${custodian}:${key}`;
    } else if(action==='merge_household') {
      source=String(input.source_household_id||'');
      if(source===target||!(await client.query('SELECT 1 FROM core.household WHERE sf_household_id=$1',[source])).rowCount)throw Object.assign(new Error('Invalid source household'),{status:400});
      const pair=await client.query('SELECT count(*)::int AS n, count(DISTINCT primary_advisor_name)::int AS advisors, count(primary_advisor_name)::int AS assigned FROM core.household WHERE sf_household_id=ANY($1)',[[source,target]]);
      if(pair.rows[0].n!==2||pair.rows[0].advisors!==1||pair.rows[0].assigned!==2)throw Object.assign(new Error('Household merges require the same assigned advisor'),{status:400});
    }
    if(action==='resolve_exception'){
      if(!['accepted_as_reported','needs_source_follow_up'].includes(input.review_outcome))throw Object.assign(new Error('Choose a review outcome'),{status:400});
      const run=Number(input.target_run_id),kind=String(input.target_source_kind||''),file=String(input.target_source_file||''),row=Number(input.target_source_row);
      if(!Number.isSafeInteger(run)||!Number.isSafeInteger(row)||!['custodian','salesforce'].includes(kind)||!(await client.query('SELECT 1 FROM reconciliation.current_exceptions WHERE run_id=$1 AND source_kind=$2 AND source_file=$3 AND source_row=$4',[run,kind,file,row])).rowCount)throw Object.assign(new Error('Unknown current exception'),{status:400});
      exception={run,kind,file,row};
    }
    const {rows:[p]}=await client.query(`INSERT INTO reconciliation.proposed_change(action,target_account_id,source_household_id,target_household_id,rationale,proposed_by,target_run_id,target_source_kind,target_source_file,target_source_row,review_outcome) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[action,account,source,target,reason,user.auth_user_id,exception?.run||null,exception?.kind||null,exception?.file||null,exception?.row||null,action==='resolve_exception'?input.review_outcome:null]);
    await client.query(`INSERT INTO reconciliation.change_audit(proposal_id,event,actor_id,after_value,reason) VALUES($1,'proposed',$2,$3,$4)`,[p.proposal_id,user.auth_user_id,p,reason]);
    await client.query('COMMIT');return p;
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}
async function decide(user,id,decision,reason){
  operations(user); if(!['approve','reject','undo'].includes(decision))throw Object.assign(new Error('Invalid decision'),{status:400});
  if(!String(reason||'').trim())throw Object.assign(new Error('A decision reason is required'),{status:400});
  const client=await pool.connect();try{
    await client.query('BEGIN');
    const {rows:[p]}=await client.query('SELECT * FROM reconciliation.proposed_change WHERE proposal_id=$1 FOR UPDATE',[id]);
    if(!p)throw Object.assign(new Error('Proposal not found'),{status:404});
    if((decision==='undo'&&p.status!=='approved')||(decision!=='undo'&&p.status!=='pending'))throw Object.assign(new Error('Proposal is not in the required state'),{status:409});
    const lockKey=p.target_account_id||p.source_household_id||`${p.target_run_id}:${p.target_source_kind}:${p.target_source_file}:${p.target_source_row}`;
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[lockKey]);
    const table=p.action==='link_account'?'reconciliation.account_household_resolution':p.action==='merge_household'?'reconciliation.household_merge_resolution':'reconciliation.exception_resolution';
    const keys=p.action==='link_account'?p.target_account_id.split(':'):p.action==='merge_household'?[p.source_household_id]:[p.target_run_id,p.target_source_kind,p.target_source_file,p.target_source_row];
    const keyWhere=p.action==='link_account'?'custodian=$1 AND account_number_key=$2':p.action==='merge_household'?'source_household_id=$1':'run_id=$1 AND source_kind=$2 AND source_file=$3 AND source_row=$4';
    const {rows:[before] }=await client.query(`SELECT * FROM ${table} WHERE ${keyWhere} FOR UPDATE`,keys);
    if(decision==='approve'){
      if(before)throw Object.assign(new Error('An active resolution already exists for this target'),{status:409});
      if(p.action==='merge_household'){
        const pair=await client.query('SELECT count(*)::int AS n, count(DISTINCT primary_advisor_name)::int AS advisors, count(primary_advisor_name)::int AS assigned FROM core.household WHERE sf_household_id=ANY($1)',[[p.source_household_id,p.target_household_id]]);
        if(pair.rows[0].n!==2||pair.rows[0].advisors!==1||pair.rows[0].assigned!==2)throw Object.assign(new Error('Households no longer share one advisor'),{status:409});
        const existingChain=await client.query('SELECT 1 FROM reconciliation.household_merge_resolution WHERE source_household_id=$1 OR target_household_id=$2 LIMIT 1',[p.target_household_id,p.source_household_id]);
        if(existingChain.rowCount)throw Object.assign(new Error('Merge would create a chain; choose a canonical household with no outgoing merge'),{status:409});
        const cycle=await client.query(`WITH RECURSIVE chain AS (SELECT target_household_id FROM reconciliation.household_merge_resolution WHERE source_household_id=$1 UNION ALL SELECT m.target_household_id FROM reconciliation.household_merge_resolution m JOIN chain c ON m.source_household_id=c.target_household_id) SELECT 1 FROM chain WHERE target_household_id=$2 LIMIT 1`,[p.target_household_id,p.source_household_id]);
        if(cycle.rowCount)throw Object.assign(new Error('Merge would create a cycle'),{status:409});
      }
      if(p.action==='link_account'){
        if(!(await client.query("SELECT 1 FROM reconciliation.current_exceptions WHERE status='custodian_only' AND source_kind='custodian' AND custodian=$1 AND account_number_key=$2",keys)).rowCount)throw Object.assign(new Error('Account is no longer a current custodian-only exception'),{status:409});
        const run=(await client.query('SELECT max(run_id) AS id FROM reconciliation.run')).rows[0].id;
        await client.query(`INSERT INTO ${table}(custodian,account_number_key,sf_household_id,proposal_id,source_run_id) VALUES($1,$2,$3,$4,$5)`,[...keys,p.target_household_id,id,run]);
      } else if(p.action==='merge_household') await client.query(`INSERT INTO ${table}(source_household_id,target_household_id,proposal_id) VALUES($1,$2,$3)`,[p.source_household_id,p.target_household_id,id]);
      else {
        if(!(await client.query('SELECT 1 FROM reconciliation.current_exceptions WHERE run_id=$1 AND source_kind=$2 AND source_file=$3 AND source_row=$4',keys)).rowCount)throw Object.assign(new Error('Exception is no longer current'),{status:409});
        await client.query(`INSERT INTO ${table}(run_id,source_kind,source_file,source_row,proposal_id,rationale,review_outcome) VALUES($1,$2,$3,$4,$5,$6,$7)`,[...keys,id,p.rationale,p.review_outcome]);
      }
    }
    if(decision==='undo'){
      if(!before||String(before.proposal_id)!==String(id))throw Object.assign(new Error('Resolution changed since approval; review newer proposal first'),{status:409});
      await client.query(`DELETE FROM ${table} WHERE ${keyWhere}`,keys);
    }
    const {rows:[after]}=await client.query(`SELECT * FROM ${table} WHERE ${keyWhere}`,keys);
    const status=decision==='approve'?'approved':decision==='reject'?'rejected':'undone';
    await client.query('UPDATE reconciliation.proposed_change SET status=$1,decided_by=$2,decided_at=now() WHERE proposal_id=$3',[status,user.auth_user_id,id]);
    const prior=decision==='undo'?(await client.query("SELECT audit_id FROM reconciliation.change_audit WHERE proposal_id=$1 AND event='approved' ORDER BY audit_id DESC LIMIT 1",[id])).rows[0]?.audit_id:null;
    await client.query(`INSERT INTO reconciliation.change_audit(proposal_id,event,actor_id,before_value,after_value,reason,reverses_audit_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,status,user.auth_user_id,before||null,after||null,reason||null,prior||null]);
    await client.query('COMMIT');return {status};
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}
export async function handler(event){
  try{
    const user=await identity(event),path=route(event),method=event.httpMethod;
    if(method==='GET'&&path==='/me')return json(200,user);
    if(method==='GET'&&path==='/exceptions')return json(200,await listExceptions(user));
    if(method==='POST'&&path==='/explain'){
      const input=JSON.parse(event.body||'{}');
      const rows=await listExceptions(user);
      const row=rows.find(x=>x.run_id===Number(input.run_id)&&x.source_kind===input.source_kind&&x.source_file===input.source_file&&x.source_row===Number(input.source_row));
      if(!row)return fail(404,'Exception not found');
      return json(200,await explainException(row));
    }
    if(method==='GET'&&path==='/households'){operations(user);return json(200,await households())}
    if(method==='GET'&&path==='/proposals'){operations(user);return json(200,await proposals())}
    if(method==='GET'&&path==='/audit'){operations(user);return json(200,await audit())}
    if(method==='POST'&&path==='/proposals')return json(201,await propose(user,JSON.parse(event.body||'{}')));
    const m=/^\/proposals\/(\d+)\/(approve|reject|undo)$/.exec(path);
    if(method==='POST'&&m)return json(200,await decide(user,Number(m[1]),m[2],JSON.parse(event.body||'{}').reason));
    return fail(404,'Not found');
  }catch(e){if(e instanceof SyntaxError)return fail(400,'Invalid JSON');return fail(e.status||500,e.status?e.message:'Request failed')}
}
