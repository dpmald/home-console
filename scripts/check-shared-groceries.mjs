// Read-only deployment check. Never submit example groceries to the household cart.
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { item: { type: 'string' } } });
const family = 'https://home-console-pied.vercel.app/';
const beta = 'https://home-console-beta.vercel.app';
const list = beta + '/beta/groceries';

async function get(url, format) {
  const response = await fetch(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(new URL(url).hostname + ' returned HTTP ' + response.status);
  return format === 'json' ? response.json() : response.text();
}

const [familyPage, betaPage, display] = await Promise.all([
  get(family), get(list), get(beta + '/api/groceries', 'json'),
]);
if (display.ok !== true || !Array.isArray(display.items)) throw new Error('Invalid grocery list response');
const linked = familyPage.includes('href="' + list + '"');
const guarded = betaPage.includes('href="/unlock"');
console.log('Family kitchen link to shared groceries:', linked ? 'present' : 'missing');
console.log('Hosted grocery list:', 'readable');
console.log('Household device unlock link:', guarded ? 'present' : 'missing');
if (!linked || !guarded) process.exitCode = 1;

if (values.item) {
  const name = values.item.trim().toLowerCase();
  const match = display.items.filter(row => row.name?.toLowerCase() === name)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (!match) {
    console.log('No matching item in the displayed requests.');
    process.exitCode = 1;
  } else {
    const state = match.status === 'needed' && match.revision !== match.cart_authorized_revision ?
      'needs_confirmation' : match.status;
    console.log('Latest matching request:', match.name, '×', match.quantity, '·', state);
    if (match.result?.product_name) {
      console.log('Recorded retailer result:', match.result.retailer, '·', match.result.product_name,
        match.result.product_size || '', '×', match.result.product_quantity ?? '?');
    }
    if (match.result?.reason) console.log('Reason:', match.result.reason);
    if (state !== 'in_cart' || !match.result?.product_name || !(match.result.product_quantity > 0)) process.exitCode = 1;
  }
}
