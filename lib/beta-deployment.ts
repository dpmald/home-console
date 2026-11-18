import { parseConsoleUrl } from './beta-navigation.mjs';

type Environment = Record<string, string | undefined>;

export function isBetaDeployment(environment: Environment = process.env) {
  return environment.HOME_CONSOLE_BETA_DEPLOYMENT === '1';
}

export function getBetaDeployment(environment: Environment = process.env) {
  const testData = environment.HOME_CONSOLE_GROCERY_DEVELOPMENT === '1';
  const local = testData && environment.NODE_ENV !== 'production';
  return {
    enabled: isBetaDeployment(environment),
    kitchenUrl: parseConsoleUrl(environment.HOME_CONSOLE_KITCHEN_URL || (local ? 'http://localhost:3001/' : ''), local),
    testData,
  };
}

/** A beta host serves experiments, never the stable kitchen's integrations. */
export function isBetaPathAllowed(pathname: string) {
  return pathname === '/' || pathname === '/beta' || pathname.startsWith('/beta/')
    || pathname === '/api/groceries' || pathname === '/api/mcp';
}
