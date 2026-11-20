export function validateGroceryDevelopmentDatabase(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid grocery development database configuration'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || url.hostname !== '127.0.0.1' || url.port !== '55432'
    || url.pathname !== '/home_console_grocery_dev' || url.search || url.hash
    || !url.username || !url.password) {
    throw new Error('Grocery development database must use the dedicated loopback instance');
  }
  return value;
}

export function groceryDockerEnvironment(inherited) {
  const blocked = new Set(['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']);
  return Object.fromEntries(Object.entries(inherited).filter(([key]) => !blocked.has(key.toUpperCase())));
}

export function validateGrocerySmokeEndpoint(value, approvedEndpoint) {
  const url = new URL(value);
  const local = 'http://127.0.0.1:3003/mcp';
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/mcp') throw new Error('Invalid smoke endpoint');
  if (url.href === local) return url;
  if (url.protocol !== 'https:' || url.port || !url.hostname.endsWith('.trycloudflare.com') || url.href !== approvedEndpoint) {
    throw new Error('External smoke endpoint must match the exact approved development URL');
  }
  return url;
}
