// Localhost cookies are shared across ports. Keep the synthetic grocery preview
// separate from the private-data preview's ordinary kiosk session.
export function kioskCookieName() {
  return process.env.HOME_CONSOLE_GROCERY_DEVELOPMENT === '1' ? 'grocery_dev_kiosk_key' : 'kiosk_key';
}
