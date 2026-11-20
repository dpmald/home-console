import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { validateGroceryDevelopmentDatabase } from '../lib/grocery-dev-isolation.mjs';

async function main() {
  const config=Object.fromEntries(readFileSync('.env.grocery-dev.local','utf8').split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
  const db=new pg.Client({connectionString:validateGroceryDevelopmentDatabase(config.HOME_CONSOLE_GROCERY_DEV_DATABASE_URL)});
  const base='http://localhost:3004';
  const device={Authorization:'Bearer home-console-groceries-local-only','Content-Type':'application/json',Origin:base};
  const callId=`flow_${randomUUID().replaceAll('-','')}`, runId=`ui-${randomUUID()}`;
  const requestIds:string[]=[];
  let rpcId=0;
  const rpc=async(method:string,params:object={})=>{
    const response=await fetch(`${base}/api/mcp`,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${config.HOME_CONSOLE_GROCERY_AGENT_KEY}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params}),signal:AbortSignal.timeout(20000)});
    assert.equal(response.status,200);const body=await response.json();assert.ok(!body.error);return body.result;
  };
  await db.connect();
  try {
    assert.equal((await fetch(`${base}/api/groceries`,{redirect:'manual'})).status,401);
    assert.equal((await fetch(`${base}/api/mcp`,{method:'POST',headers:device,body:'{}'})).status,401);
    const voice={name:'add_grocery_items',call_id:callId,args:{items:[{name:'Synthetic HTTP milk',quantity:'2 cartons',notes:'Simulated voice; never a real cart'},{name:'Synthetic HTTP eggs',quantity:null,notes:null}]}};
    const added=await fetch(`${base}/api/voice/tool`,{method:'POST',headers:device,body:JSON.stringify(voice)});
    assert.equal(added.status,200);const {result}=await added.json();assert.equal(result.ok,true);requestIds.push(...result.added_ids);assert.equal(requestIds.length,2);
    const duplicate=await (await fetch(`${base}/api/voice/tool`,{method:'POST',headers:device,body:JSON.stringify(voice)})).json();
    assert.equal(duplicate.result.replayed,true);assert.deepEqual(duplicate.result.added_ids,requestIds);
    assert.equal((await fetch(`${base}/api/voice/session`,{method:'POST',headers:{...device,'Content-Type':'application/sdp'},body:'synthetic'})).status,503);
    assert.equal((await fetch(`${base}/api/voice/tool`,{method:'POST',headers:device,body:JSON.stringify({name:'post_to_slack',args:{message:'Do not send'}})})).status,400);
    assert.equal((await fetch(`${base}/api/groceries`,{method:'POST',headers:{...device,Origin:'https://elsewhere.invalid'},body:'{}'})).status,403);
    await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'synthetic-ui-flow',version:'1'}});
    const pending=(await rpc('tools/call',{name:'list_pending',arguments:{run_id:runId}})).structuredContent;
    assert.ok(pending.requests.some((r:any)=>r.id===requestIds[0]&&r.quantity==='2 cartons'));
    const product={product_id:'SIMULATED-UI-FLOW',name:'Synthetic milk evidence',size:'1 carton',quantity:2};
    const common={run_id:runId,request_id:requestIds[0],revision:1,retailer:'Morton Williams Supermarket'};
    const prepared=(await rpc('tools/call',{name:'record_request_progress',arguments:{operation:{...common,phase:'prepare',operation_id:`prepare:${runId}`,product,observed_cart:[],observed_at:new Date().toISOString()}}})).structuredContent;
    assert.equal(prepared.ok,true,prepared.code);
    const operation={...common,phase:'complete',operation_id:`complete:${runId}`,product,outcome:'in_cart',worker_token:prepared.worker_token,claim_token:prepared.claim_token,observed_at:new Date().toISOString()};
    const done=(await rpc('tools/call',{name:'record_request_progress',arguments:{operation}})).structuredContent;assert.equal(done.ok,true);
    const replay=(await rpc('tools/call',{name:'record_request_progress',arguments:{operation}})).structuredContent;assert.equal(replay.replayed,true);assert.equal(replay.attempt_id,done.attempt_id);
    const display=await (await fetch(`${base}/api/groceries`,{headers:device})).json();
    const milk=display.items.find((r:any)=>r.id===requestIds[0]);assert.equal(milk.status,'in_cart');assert.equal(milk.result.product_name,product.name);assert.equal(milk.quantity,'2 cartons');
    assert.equal(JSON.stringify(display).includes(prepared.worker_token),false);
    console.log('PASS: actual Next routes, voice batch/replay, MCP snapshot/prepare/complete/replay, display readback, split credentials, cross-origin rejection and disabled external actions. No real cart or voice provider used.');
  } finally {
    await db.query('begin');
    try {
      await db.query("delete from public.grocery_agent_operations where payload->>'run_id'=$1",[runId]);
      await db.query('delete from public.grocery_agent_attempts where run_id=$1',[runId]);
      await db.query('delete from public.grocery_agent_cart_leases where run_id=$1',[runId]);
      await db.query('delete from public.grocery_agent_runs where run_id=$1',[runId]);
      // Recover generated IDs even if a response was lost before the test saw them.
      await db.query('delete from public.grocery_items where id=any(select unnest(request_ids) from public.grocery_device_operations where operation_id=$1)',[`voice:${callId}`]);
      await db.query('delete from public.grocery_device_operations where operation_id=$1',[`voice:${callId}`]);
      await db.query('commit');
    } catch {await db.query('rollback');throw new Error('Synthetic smoke cleanup failed');}
    await db.end();
  }
}
main().catch(e=>{console.error(e instanceof assert.AssertionError?e.message:'Synthetic HTTP verification failed; private error details suppressed.');process.exitCode=1;});
