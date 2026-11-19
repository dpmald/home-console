type Environment = Record<string, string | undefined>;

/** Never let a hosted beta silently inherit the normal kitchen's database. */
export function getBetaDatabaseConfiguration(environment: Environment = process.env) {
  const url = environment.HOME_CONSOLE_BETA_SUPABASE_URL;
  const key = environment.HOME_CONSOLE_BETA_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || url !== url.trim() || key !== key.trim()) {
    throw new Error('Separate beta database credentials are required.');
  }
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('Invalid beta database URL.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('Invalid beta database URL.');
  }
  if (parsed.hostname === 'oovlsrfczswrmnmhqbpt.supabase.co') throw new Error('Beta must not use the family production project.');
  let stableOrigin: string | undefined;
  if (environment.NEXT_PUBLIC_SUPABASE_URL) {
    try { stableOrigin = new URL(environment.NEXT_PUBLIC_SUPABASE_URL).origin; }
    catch { throw new Error('Cannot verify the normal kitchen database identity.'); }
  }
  if (parsed.origin === stableOrigin || key === environment.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Beta must not share the normal kitchen database credentials.');
  }
  return { url: parsed.origin, key };
}
