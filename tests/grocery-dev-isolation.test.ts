import assert from 'node:assert/strict';
import test from 'node:test';
import { validateGroceryDevelopmentDatabase } from '../lib/grocery-agent-store';
import { groceryDockerEnvironment, validateGrocerySmokeEndpoint } from '../lib/grocery-dev-isolation.mjs';

test('development database accepts only its dedicated loopback port/database', () => {
  const valid = 'postgresql://postgres:test@127.0.0.1:55432/home_console_grocery_dev';
  assert.equal(validateGroceryDevelopmentDatabase(valid), valid);
  for (const invalid of [valid.replace('127.0.0.1', 'example.com'), valid.replace('55432', '54322'), valid.replace('home_console_grocery_dev', 'postgres'), `${valid}?host=example.com`, `${valid}#fragment`, valid.replace('postgresql:', 'https:'), 'not-a-url']) {
    assert.throws(() => validateGroceryDevelopmentDatabase(invalid));
  }
});

test('Docker environment cannot override the inspected local endpoint', () => {
  assert.deepEqual(groceryDockerEnvironment({ PATH: 'keep', DOCKER_HOST: 'tcp://remote', Docker_Context: 'remote', docker_tls_verify: '1', DOCKER_CERT_PATH: '/remote' }), { PATH: 'keep' });
});

test('external credential destination must match the exact approved tunnel', () => {
  const approved = 'https://approved-fixture.trycloudflare.com/mcp';
  assert.equal(validateGrocerySmokeEndpoint('http://127.0.0.1:3003/mcp').href, 'http://127.0.0.1:3003/mcp');
  assert.equal(validateGrocerySmokeEndpoint(approved, approved).href, approved);
  assert.throws(() => validateGrocerySmokeEndpoint('https://unapproved-fixture.trycloudflare.com/mcp', approved));
  assert.throws(() => validateGrocerySmokeEndpoint(approved));
});
