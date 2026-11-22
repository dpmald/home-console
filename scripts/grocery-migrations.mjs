// These legacy entries belong only to the standalone synthetic development DB.
// Never repair or rewrite a Supabase migration ledger with this mapping.
export const groceryMigrations = [
  'supabase/tests/grocery_agent_bootstrap.sql',
  'supabase/migrations/0001_init.sql',
  'supabase/migrations/20261116000100_grocery_agent.sql',
  'supabase/migrations/20261116000200_grocery_lease_diagnostics.sql',
  'supabase/migrations/20261116000300_grocery_display.sql',
  'supabase/migrations/20261122000100_trusted_grocery_intake.sql',
];
export const legacyGroceryMigrations = {
  'supabase/migrations/20261116000100_grocery_agent.sql': 'supabase/migrations/0004_grocery_agent.sql',
  'supabase/migrations/20261116000200_grocery_lease_diagnostics.sql': 'supabase/migrations/0005_grocery_lease_diagnostics.sql',
};
export function migrationAlreadyApplied(name, applied) {
  return applied.has(name) || Boolean(legacyGroceryMigrations[name] && applied.has(legacyGroceryMigrations[name]));
}
