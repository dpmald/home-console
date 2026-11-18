import assert from 'node:assert/strict';
import test from 'node:test';
import { getBetaDestination, parseConsoleUrl } from '../lib/beta-navigation.mjs';

test('unconfigured stable kitchens have no beta destination, including production with a stale local flag', () => {
  assert.equal(getBetaDestination({}), null);
  assert.equal(getBetaDestination({ NODE_ENV: 'production', HOME_CONSOLE_LOCAL_DEVELOPMENT: '1' }), null);
  assert.equal(getBetaDestination({ NODE_ENV: 'development' }), null);
});

test('explicit local development uses the separate beta server and permits loopback destinations', () => {
  const local = { NODE_ENV: 'development', HOME_CONSOLE_LOCAL_DEVELOPMENT: '1' };
  assert.equal(getBetaDestination(local), 'http://localhost:3004/beta');
  assert.equal(getBetaDestination({ ...local, HOME_CONSOLE_BETA_URL: 'http://127.0.0.1:3005/beta' }), 'http://127.0.0.1:3005/beta');
  assert.equal(parseConsoleUrl('http://[::1]:3005/beta', true), 'http://[::1]:3005/beta');
  assert.equal(getBetaDestination({ ...local, HOME_CONSOLE_BETA_URL: 'http://beta.example/beta' }), null);
});

test('hosted destinations require HTTPS and never fall back to a local beta server', () => {
  assert.equal(getBetaDestination({ NODE_ENV: 'production', HOME_CONSOLE_BETA_URL: 'https://BETA.example/beta' }), 'https://beta.example/beta');
  for (const HOME_CONSOLE_BETA_URL of ['http://beta.example/beta', 'http://localhost:3005/beta', 'https://localhost/beta']) {
    assert.equal(getBetaDestination({ NODE_ENV: 'production', HOME_CONSOLE_LOCAL_DEVELOPMENT: '1', HOME_CONSOLE_BETA_URL }), null);
  }
});

test('navigation rejects credential-bearing, relative, malformed and executable URLs', () => {
  for (const value of [undefined, null, '', ' https://beta.example/beta', '/beta', '//beta.example/beta',
    'javascript:alert(1)', 'data:text/html,test', 'https:beta.example/beta', 'https://',
    'https://user:secret@beta.example/beta', 'https://user@beta.example/beta',
    'https://beta.example/beta?key=secret', 'https://beta.example/beta#secret',
    'https://beta.example/beta?', 'https://beta.example/beta#']) {
    assert.equal(parseConsoleUrl(value, true), null, String(value));
  }
  assert.equal(getBetaDestination({ HOME_CONSOLE_LOCAL_DEVELOPMENT: '1', HOME_CONSOLE_BETA_URL: 'javascript:alert(1)' }), null);
});
