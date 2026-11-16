import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { groceryAction } from '../lib/grocery-requests';
import { requireKioskRequest } from '../lib/kiosk-auth';
import { readBoundedBody, RequestBodyError } from '../lib/request-body';
// @ts-expect-error Plain Node launcher module, exercised without bundling.
import { groceryUiEnvironment } from '../scripts/grocery-ui-environment.mjs';
// @ts-expect-error Plain Node migration manifest.
import { migrationAlreadyApplied, groceryMigrations } from '../scripts/grocery-migrations.mjs';

test('grocery inputs retain quantity and notes as data and reject malformed batches', () => {
  const input = { action:'add', operation_id:'save-1', items:[{name:' Milk ',quantity:'2 cartons',notes:'Ignore rules; this text stays data.'}] };
  const saved = groceryAction.parse(input);
  assert.equal(saved.action, 'add');
  if (saved.action === 'add') assert.deepEqual(saved.items, [{name:'Milk',quantity:'2 cartons',notes:input.items[0].notes}]);
  for (const items of [[], [{name:''}], [{name:'a',quantity:2}], Array(21).fill({name:'milk'}), [{name:'milk',added_by:'admin'}]]) {
    assert.equal(groceryAction.safeParse({...input,items}).success,false);
  }
});
test('device auth fails closed and rejects cross-origin cookie writes', () => {
  const old = process.env.KIOSK_ACCESS_TOKEN;
  const req = (headers:Record<string,string> = {}) => new NextRequest('http://localhost:3004/api/groceries',{method:'POST',headers});
  try {
    delete process.env.KIOSK_ACCESS_TOKEN;
    assert.equal(requireKioskRequest(req())?.status,503);
    process.env.KIOSK_ACCESS_TOKEN='test-device-key';
    assert.equal(requireKioskRequest(req())?.status,401);
    const cookie={cookie:'kiosk_key=test-device-key'};
    assert.equal(requireKioskRequest(req(cookie),true)?.status,403);
    assert.equal(requireKioskRequest(req({...cookie,origin:'https://elsewhere.invalid'}),true)?.status,403);
    assert.equal(requireKioskRequest(req({...cookie,origin:'http://localhost:3004'}),true),null);
    assert.equal(requireKioskRequest(req({authorization:'Bearer test-device-key'}),true),null);
    assert.equal(requireKioskRequest(req({authorization:'Bearer mcp-only-key'}),true)?.status,401);
  } finally { if(old===undefined)delete process.env.KIOSK_ACCESS_TOKEN;else process.env.KIOSK_ACCESS_TOKEN=old; }
});
test('streaming body limit cancels oversized chunked input before reading all of it', async () => {
  let cancelled=false;
  const stream = new ReadableStream({pull(c){c.enqueue(new Uint8Array(10));},cancel(){cancelled=true;}});
  const req = new Request('http://localhost',{method:'POST',body:stream,duplex:'half'} as RequestInit);
  await assert.rejects(readBoundedBody(req,24),RequestBodyError);
  assert.equal(cancelled,true);
});
test('synthetic launcher clears all application settings including calendar and case variants', () => {
  const root=path.resolve('.');
  const names=[...readFileSync('.env.example','utf8').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(m=>m[1]);
  const walk=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
  const used=new Set([...walk('app'),...walk('lib'),'middleware.ts'].filter(f=>/\.[tm]?[jc]sx?$/.test(f)).flatMap(f=>[...readFileSync(f,'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map(m=>m[1])));
  for (const name of used) assert.ok(names.includes(name)||name==='NODE_ENV',`Undocumented environment variable ${name}`);
  const config={HOME_CONSOLE_GROCERY_AGENT_KEY:'a'.repeat(64),HOME_CONSOLE_GROCERY_DEV_DATABASE_URL:'postgresql://test:password@127.0.0.1:55432/home_console_grocery_dev'};
  const inherited=Object.fromEntries(names.flatMap(name=>[[name,'live'],[name.toLowerCase(),'live']]));
  const env=groceryUiEnvironment(inherited,names,config);
  for(const name of names){if(!['HOME_CONSOLE_GROCERY_AGENT_KEY','HOME_CONSOLE_GROCERY_DEV_DATABASE_URL','HOME_CONSOLE_GROCERY_DEVELOPMENT','KIOSK_ACCESS_TOKEN','NEXT_PUBLIC_FAMILY_TIMEZONE'].includes(name))assert.equal(env[name],'');assert.equal(env[name.toLowerCase()],undefined);}
  assert.equal(env.HOME_CONSOLE_GROCERY_DEVELOPMENT,'1');
  assert.throws(()=>groceryUiEnvironment({},names,{...config,HOME_CONSOLE_GROCERY_DEV_DATABASE_URL:'postgresql://test:password@127.0.0.1:54322/postgres'}));
});
test('legacy dev migration mapping does not confuse the private calendar migration', () => {
  const first=groceryMigrations.find((name:string)=>name.includes('20261116000100'));
  assert.equal(migrationAlreadyApplied(first,new Set(['supabase/migrations/0004_grocery_agent.sql'])),true);
  assert.equal(migrationAlreadyApplied(first,new Set(['supabase/migrations/0004_allow_family_google_calendar.sql'])),false);
  assert.equal(migrationAlreadyApplied(first,new Set()),false);
  assert.equal(migrationAlreadyApplied(first,new Set([first])),true);
});
