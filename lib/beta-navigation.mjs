/** Public destinations only: never put device credentials in navigation URLs. */
export function parseConsoleUrl(value, allowLocalHttp = false) {
  if (typeof value !== 'string' || value !== value.trim() || !/^https?:\/\//i.test(value)) return null;
  // Reject even an empty query/fragment rather than silently normalizing it away.
  if (value.includes('?') || value.includes('#')) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.username || url.password || !url.hostname) return null;
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (loopback && !allowLocalHttp) return null;
  if (url.protocol !== 'https:' && !(allowLocalHttp && loopback && url.protocol === 'http:')) return null;
  return url.href;
}

/** Missing or invalid beta configuration leaves the normal kitchen unchanged. */
export function getBetaDestination(environment = process.env) {
  const local = environment.HOME_CONSOLE_LOCAL_DEVELOPMENT === '1' && environment.NODE_ENV !== 'production';
  if (environment.HOME_CONSOLE_BETA_URL) return parseConsoleUrl(environment.HOME_CONSOLE_BETA_URL, local);
  return local ? 'http://localhost:3004/beta' : null;
}
