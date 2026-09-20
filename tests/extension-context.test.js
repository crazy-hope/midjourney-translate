const test = require('node:test');
const assert = require('node:assert/strict');

let createGuard;
let isInvalidatedError;
try {
  ({ createGuard, isInvalidatedError } = require('../content/extension-context.js'));
} catch {
  createGuard = undefined;
  isInvalidatedError = undefined;
}

test('invalidated extension messages resolve as a refresh-required response', async () => {
  assert.equal(typeof createGuard, 'function');
  let invalidations = 0;
  const runtime = {
    id: 'extension-id',
    async sendMessage() {
      throw new Error('Extension context invalidated.');
    },
  };
  const guard = createGuard(runtime, () => { invalidations += 1; });

  const first = await guard.sendMessage({ type: 'get-ui-settings' });
  const second = await guard.sendMessage({ type: 'open-options' });

  assert.deepEqual(first, {
    ok: false,
    code: 'EXTENSION_CONTEXT_INVALIDATED',
    message: '扩展已更新，请刷新 Midjourney 页面',
  });
  assert.deepEqual(second, first);
  assert.equal(invalidations, 1);
});

test('unrelated runtime failures still reject for their caller to handle', async () => {
  assert.equal(typeof createGuard, 'function');
  const runtime = {
    id: 'extension-id',
    async sendMessage() {
      throw new Error('Network unavailable');
    },
  };
  const guard = createGuard(runtime, () => assert.fail('must not invalidate'));

  await assert.rejects(
    guard.sendMessage({ type: 'translate' }),
    /Network unavailable/,
  );
});

test('only Chrome extension-context failures are classified as invalidation', () => {
  assert.equal(typeof isInvalidatedError, 'function');
  assert.equal(isInvalidatedError(new Error('Extension context invalidated.')), true);
  assert.equal(isInvalidatedError(new Error('The message port closed before a response was received.')), false);
});
