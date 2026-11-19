import { createHmac } from 'node:crypto';
import { validateGroceryDevelopmentDatabase } from './grocery-dev-isolation.mjs';

export function localBetaRestCredentials(databaseUrl) {
  const { password } = new URL(validateGroceryDevelopmentDatabase(databaseUrl));
  const derive = label => createHmac('sha256', password).update(label).digest('hex');
  const jwtSecret = derive('home-console-beta/postgrest-jwt/v1');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role: 'beta_kiosk' })).toString('base64url');
  const signed = header + '.' + payload;
  return { jwtSecret, password: derive('home-console-beta/rest-login/v1'),
    token: signed + '.' + createHmac('sha256', jwtSecret).update(signed).digest('base64url') };
}
