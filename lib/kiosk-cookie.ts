// Localhost cookies are shared across ports. Keep the synthetic grocery preview
// separate from the private-data preview's ordinary kiosk session.
export function kioskCookieName() {
  if (process.env.HOME_CONSOLE_GROCERY_DEVELOPMENT === '1') return 'grocery_dev_kiosk_key';
  return process.env.HOME_CONSOLE_BETA_DEPLOYMENT === '1' ? 'beta_kiosk_key' : 'kiosk_key';
}
