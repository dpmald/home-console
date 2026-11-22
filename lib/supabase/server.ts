import { createClient } from '@supabase/supabase-js';
import { PostgrestClient } from '@supabase/postgrest-js';
import { isBetaDeployment } from '../beta-deployment';
import { getBetaDatabaseConfiguration } from '../beta-database';
import { localBetaRestCredentials } from '../beta-local-rest.mjs';

let _db: PostgrestClient<any> | null = null;

/** Server-only Supabase client (service role — bypasses RLS). */
export function db(): PostgrestClient<any> {
  if (!_db) {
    const beta = isBetaDeployment();
    if (beta && process.env.NODE_ENV === 'development' && process.env.HOME_CONSOLE_GROCERY_DEVELOPMENT === '1') {
      const { token, restUrl } = localBetaRestCredentials(process.env.HOME_CONSOLE_GROCERY_DEV_DATABASE_URL || '');
      _db = new PostgrestClient(restUrl, { headers: { Authorization: 'Bearer ' + token } });
      return _db;
    }
    const { url, key } = beta ? getBetaDatabaseConfiguration() : {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    _db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).schema('public');
  }
  return _db;
}

export function unwrap<T = any>(
  res: { data: T | null; error: { message: string } | null },
  ctx: string,
): T {
  if (res.error) throw new Error(`${ctx}: ${res.error.message}`);
  return res.data as T;
}
