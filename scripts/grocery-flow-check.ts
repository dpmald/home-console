import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';
import { validateGroceryDevelopmentDatabase } from '../lib/grocery-dev-isolation.mjs';

const fixtureUrl = process.env.HOME_CONSOLE_PR_DATABASE_URL;
const config = fixtureUrl ? {} : Object.fromEntries(readFileSync('.env.grocery-dev.local', 'utf8')
  .split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line))
  .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const connectionString = validateGroceryDevelopmentDatabase(fixtureUrl ?? config.HOME_CONSOLE_GROCERY_DEV_DATABASE_URL, Boolean(fixtureUrl));
const client=new pg.Client({connectionString,connectionTimeoutMillis:5000,statement_timeout:15000});
const rpc=async(name:string,value?:unknown)=>{
  const queries:Record<string,string>={device:'select public.grocery_trusted_device_mutate($1::jsonb) as result',list:'select public.grocery_device_list() as result',pending:'select public.grocery_agent_list_pending($1::text) as result',progress:'select public.grocery_agent_progress($1::jsonb) as result'};
  const args=name==='list'?[]:[name==='pending'?value:JSON.stringify(value)];
  return (await client.query(queries[name],args)).rows[0].result;
};
async function main() {
await client.connect();
try {
  await client.query('begin');
  const marker=randomUUID();
  const input={action:'add',operation_id:`test:${marker}`,added_by:'kiosk',items:[{name:'Synthetic flow milk',quantity:'2 cartons',notes:'Synthetic; never use a real cart'},{name:'Synthetic flow eggs',quantity:null,notes:null}]};
  const saved=await rpc('device',input);assert.equal(saved.ok,true);assert.equal(saved.added_ids.length,2);
  const [milk,eggs]=saved.added_ids;
  const replay=await rpc('device',input);assert.equal(replay.replayed,true);assert.deepEqual(replay.added_ids,saved.added_ids);
  assert.equal((await rpc('device',{...input,items:[{name:'other'}]})).code,'idempotency_conflict');
  const duplicate=await rpc('device',{...input,operation_id:`other:${marker}`,items:[{name:'Synthetic flow milk',quantity:'3 cartons'}]});
  assert.notEqual(duplicate.added_ids[0],milk);assert.equal(duplicate.items.find((i:any)=>i.id===duplicate.added_ids[0]).quantity,'3 cartons');
  const beforeCount=(await client.query('select count(*)::int as count from public.grocery_items')).rows[0].count;
  assert.equal((await rpc('device',{...input,operation_id:`invalid:${marker}`,items:[{name:'valid'},{name:''}]})).ok,false);
  assert.equal((await client.query('select count(*)::int as count from public.grocery_items')).rows[0].count,beforeCount);
  const run=`flow-${marker}`;const snap=await rpc('pending',run);assert.ok(snap.requests.some((r:any)=>r.id===milk));
  const product={product_id:'SIMULATED-FLOW-MILK',name:'Synthetic milk',size:'carton',quantity:2};
  const common={run_id:run,request_id:milk,revision:1,retailer:'Morton Williams Supermarket'};
  // Transactions contain the entire test; any expired development lease is replaced only until rollback.
  const prepared=await rpc('progress',{...common,phase:'prepare',operation_id:`prepare:${marker}`,product,observed_cart:[],observed_at:new Date().toISOString()});
  assert.equal(prepared.ok,true,prepared.code);
  const completion={...common,phase:'complete',operation_id:`complete:${marker}`,outcome:'in_cart',product,worker_token:prepared.worker_token,claim_token:prepared.claim_token,observed_at:new Date().toISOString()};
  assert.equal((await rpc('progress',completion)).ok,true);
  assert.equal((await rpc('progress',completion)).replayed,true);
  const displayed=await rpc('list');const item=displayed.items.find((i:any)=>i.id===milk);
  assert.equal(item.status,'in_cart');assert.equal(item.result.product_name,'Synthetic milk');assert.equal(item.result.retailer,'Morton Williams Supermarket');
  assert.equal(item.result.product_size,'carton');assert.equal(item.result.product_quantity,2);
  const visible=JSON.stringify(displayed);assert.equal(visible.includes(prepared.worker_token),false);assert.equal(visible.includes(prepared.claim_token),false);
  const edited=await rpc('device',{action:'edit',id:eggs,revision:1,name:'Synthetic flow eggs',quantity:'two cartons',notes:null});assert.equal(edited.ok,true);
  assert.equal(edited.items.find((i:any)=>i.id===eggs).revision,2);
  assert.equal((await rpc('device',{action:'status',id:eggs,revision:1,status:'cancelled'})).code,'revision_conflict');
  assert.equal((await rpc('device',{action:'status',id:eggs,revision:2,status:'cancelled'})).ok,true);
  assert.equal((await rpc('progress',{...common,request_id:eggs,phase:'complete',operation_id:`stale:${marker}`,outcome:'already_in_cart',product,observed_at:new Date().toISOString()})).code,'revision_conflict');
  assert.equal((await rpc('list')).items.find((i:any)=>i.id===eggs).status,'cancelled');
  const next=await rpc('pending',`after-${marker}`);assert.equal(next.requests.some((r:any)=>r.id===milk||r.id===eggs),false);
  assert.equal((await client.query("select has_function_privilege('anon','public.grocery_device_list()','EXECUTE') as allowed")).rows[0].allowed,false);
  assert.equal((await client.query("select has_function_privilege('authenticated','public.grocery_trusted_device_mutate(jsonb)','EXECUTE') as allowed")).rows[0].allowed,false);
  assert.equal((await client.query("select has_function_privilege('service_role','public.grocery_trusted_device_mutate(jsonb)','EXECUTE') as allowed")).rows[0].allowed,true);
  await client.query('rollback');
  console.log('PASS: durable batch/replay, quantity preservation, invalid batch atomicity, connector prepare/complete/replay, safe display results, stale edit/cancel, snapshots and grants (fixtures rolled back).');
  for(const file of ['supabase/tests/grocery_agent.sql','supabase/tests/grocery_agent_lease.sql','supabase/tests/grocery_trusted_intake.sql','supabase/tests/grocery_cart_worker.sql','supabase/tests/grocery_household_cart_check.sql','supabase/tests/grocery_provider_quantities.sql']) {
    await client.query(readFileSync(file,'utf8'));
    console.log(`PASS: ${file} (rollback-only).`);
  }
  const database=`grocery_check_${randomUUID().replaceAll('-','')}`;
  if(!/^grocery_check_[a-f0-9]{32}$/.test(database))throw new Error('Invalid temporary database identity');
  await client.query(`create database "${database}"`);
  const freshUrl=new URL(connectionString);freshUrl.pathname=`/${database}`;
  const fresh=new pg.Client({connectionString:freshUrl.href,connectionTimeoutMillis:5000,statement_timeout:15000});
  try {
    await fresh.connect();
    await fresh.query(readFileSync('supabase/tests/grocery_agent_bootstrap.sql', 'utf8'));
    for (const name of readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).sort()) {
      await fresh.query(readFileSync('supabase/migrations/' + name, 'utf8'));
    }
    assert.deepEqual((await fresh.query('select public.grocery_device_list() as result')).rows[0].result.items,[]);
    console.log('PASS: fresh canonical migration history, including calendar and grocery migrations.');
  } finally {await fresh.end();await client.query(`drop database "${database}"`);}
} catch(error) {
  await client.query('rollback').catch(()=>{});
  console.error('Grocery database verification failed; no private rows or database error details printed.');
  if(error instanceof assert.AssertionError) console.error(error.message);
  process.exitCode=1;
} finally {await client.end();}
}
main().catch(()=>{console.error('Synthetic grocery verification could not connect.');process.exitCode=1;});
