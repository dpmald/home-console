import { Pool } from 'pg';
import { db } from './supabase/server';
import { validateGroceryDevelopmentDatabase } from './grocery-dev-isolation.mjs';
export { validateGroceryDevelopmentDatabase } from './grocery-dev-isolation.mjs';

type RpcName = 'grocery_agent_list_pending' | 'grocery_agent_progress' | 'grocery_device_list' | 'grocery_trusted_device_mutate';
let localPool: Pool | undefined;
export async function groceryAgentRpc(name: RpcName, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const developmentUrl = process.env.HOME_CONSOLE_GROCERY_DEV_DATABASE_URL;
  if (developmentUrl) {
    if (process.env.NODE_ENV === 'production') throw new Error('Development database is disabled in production');
    const connectionString = validateGroceryDevelopmentDatabase(developmentUrl, developmentUrl === process.env.HOME_CONSOLE_PR_DATABASE_URL);
    localPool ??= new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    // RPC name is a closed union, and values are always parameters.
    const queries = {
      grocery_agent_list_pending: { text: 'select public.grocery_agent_list_pending($1::text) as result', values: [args.p_run_id] },
      grocery_agent_progress: { text: 'select public.grocery_agent_progress($1::jsonb) as result', values: [JSON.stringify(args.p_operation)] },
      grocery_device_list: { text: 'select public.grocery_device_list() as result', values: [] },
      grocery_trusted_device_mutate: { text: 'select public.grocery_trusted_device_mutate($1::jsonb) as result', values: [JSON.stringify(args.p_action)] },
    };
    const query = queries[name];
    const result = await localPool.query(query);
    return result.rows[0].result as Record<string, unknown>;
  }
  const { data, error } = await db().rpc(name, args);
  if (error || !data || typeof data !== 'object') throw new Error('Grocery request storage unavailable');
  return data as Record<string, unknown>;
}
