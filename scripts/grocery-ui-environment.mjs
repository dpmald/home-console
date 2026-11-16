import { validateGroceryDevelopmentDatabase } from '../lib/grocery-dev-isolation.mjs';

export function groceryUiEnvironment(inherited, names, config) {
  const blocked = new Set([...names, 'NODE_ENV', 'NEXT_TELEMETRY_DISABLED',
    'SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'HOME_CONSOLE_GROCERY_DEVELOPMENT',
    'HOME_CONSOLE_GROCERY_AGENT_KEY', 'HOME_CONSOLE_GROCERY_DEV_DATABASE_URL',
    'KIOSK_ACCESS_TOKEN', 'GOOGLE_CALENDAR_ICS_URLS', 'GOOGLE_CALENDAR_ACCESS_TOKEN',
    'GOOGLE_FAMILY_CALENDAR_ID'].map(name => name.toUpperCase()));
  const env = Object.fromEntries(Object.entries(inherited).filter(([name]) => !blocked.has(name.toUpperCase())));
  for (const name of blocked) env[name] = '';
  if (!/^[a-f0-9]{64}$/.test(config.HOME_CONSOLE_GROCERY_AGENT_KEY ?? '')) throw new Error('Missing dedicated development credential');
  return { ...env, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1',
    HOME_CONSOLE_GROCERY_DEVELOPMENT: '1', NEXT_PUBLIC_FAMILY_TIMEZONE: 'America/New_York',
    KIOSK_ACCESS_TOKEN: 'home-console-groceries-local-only',
    HOME_CONSOLE_GROCERY_AGENT_KEY: config.HOME_CONSOLE_GROCERY_AGENT_KEY,
    HOME_CONSOLE_GROCERY_DEV_DATABASE_URL: validateGroceryDevelopmentDatabase(config.HOME_CONSOLE_GROCERY_DEV_DATABASE_URL),
  };
}
