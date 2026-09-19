const test = require('node:test');
const assert = require('node:assert/strict');

let isTranslationCandidate;
let shouldSkipElement;
let isVisibleElement;
let restoreOwnedRecord;
let createController;
try {
  ({
    isTranslationCandidate,
    shouldSkipElement,
    isVisibleElement,
    restoreOwnedRecord,
    createController,
  } = require('../content/page-translator.js'));
} catch {
  isTranslationCandidate = undefined;
}

for (const [text, expected] of [
  ['Create', true],
  ['Explore community creations', true],
  ['16:9', false],
  ['--stylize 450', false],
  ['https://midjourney.com', false],
  ['12345', false],
  ['创建图片', false],
  ['A', false],
]) {
  test(`page candidate ${JSON.stringify(text)} => ${expected}`, () => {
    assert.equal(typeof isTranslationCandidate, 'function');
    assert.equal(isTranslationCandidate(text), expected);
  });
}

test('skips protected elements and descendants of editable or translator content', () => {
  assert.equal(typeof shouldSkipElement, 'function');
  const element = (tagName, parentElement = null, extra = {}) => ({ tagName, parentElement, ...extra });
  const panel = element('SECTION', null, { id: 'mjpt-panel' });
  const editable = element('DIV', null, { getAttribute: (name) => (name === 'contenteditable' ? 'true' : null) });
  const fixtures = [
    element('SPAN', panel),
    element('INPUT'),
    element('TEXTAREA'),
    element('SCRIPT'),
    element('STYLE'),
    element('CODE'),
    element('SPAN', editable),
  ];
  assert.ok(fixtures.every((item) => shouldSkipElement(item)));
  assert.equal(shouldSkipElement(element('SPAN')), false);
});

test('treats descendants of hidden containers as invisible', () => {
  assert.equal(typeof isVisibleElement, 'function');
  assert.equal(isVisibleElement(null), false);
  const hiddenParent = {
    hidden: false,
    parentElement: null,
    getAttribute: () => null,
  };
  const child = {
    hidden: false,
    parentElement: hiddenParent,
    getAttribute: () => null,
  };
  const getStyle = (element) => ({
    display: element === hiddenParent ? 'none' : 'block',
    visibility: 'visible',
  });
  assert.equal(isVisibleElement(child, getStyle), false);
});

function record(id, text) {
  return { id, text, connected: true };
}

function adapterFor(records) {
  const events = [];
  return {
    events,
    collect() { return records; },
    render(item, chinese, keepOriginal) {
      events.push({ type: 'render', id: item.id, chinese, keepOriginal });
    },
    setKeepOriginal(item, keepOriginal) {
      events.push({ type: 'mode', id: item.id, keepOriginal });
    },
    restore(item) { events.push({ type: 'restore', id: item.id }); },
  };
}

test('deduplicates equal text and renders both records from one request', async () => {
  assert.equal(typeof createController, 'function');
  const adapter = adapterFor([record(1, 'Create'), record(2, 'Create')]);
  let requests = 0;
  const controller = createController({
    adapter,
    request: async () => { requests += 1; return { text: '创建', provider: 'free' }; },
  });
  controller.enable({ provider: 'free', keepOriginal: true });
  await controller.scan({});
  assert.equal(requests, 1);
  assert.deepEqual(
    adapter.events.filter((event) => event.type === 'render').map((event) => event.id),
    [1, 2],
  );
});

test('cache separates providers', async () => {
  const adapter = adapterFor([record(1, 'Create')]);
  const providers = [];
  const controller = createController({
    adapter,
    request: async ({ provider }) => {
      providers.push(provider);
      return { text: provider, provider };
    },
  });
  controller.enable({ provider: 'free', keepOriginal: true });
  await controller.scan({});
  controller.setProvider('deepseek');
  await controller.scan({});
  assert.deepEqual(providers, ['free', 'deepseek']);
});

test('keep-original mode changes without retranslating', async () => {
  const adapter = adapterFor([record(1, 'Create')]);
  let requests = 0;
  const controller = createController({
    adapter,
    request: async () => { requests += 1; return { text: '创建', provider: 'free' }; },
  });
  controller.enable({ provider: 'free', keepOriginal: true });
  await controller.scan({});
  controller.setKeepOriginal(false);
  assert.equal(requests, 1);
  assert.deepEqual(adapter.events.at(-1), {
    type: 'mode', id: 1, keepOriginal: false,
  });
});

test('disable restores records and ignores a delayed response', async () => {
  const adapter = adapterFor([record(1, 'Create')]);
  let resolveRequest;
  const controller = createController({
    adapter,
    request: () => new Promise((resolve) => { resolveRequest = resolve; }),
  });
  controller.enable({ provider: 'free', keepOriginal: true });
  const scanning = controller.scan({});
  await Promise.resolve();
  controller.disable();
  resolveRequest({ text: '创建', provider: 'free' });
  await scanning;
  assert.equal(adapter.events.some((event) => event.type === 'render'), false);
  assert.equal(adapter.events.some((event) => event.type === 'restore'), true);
});

test('restore skips disconnected and externally changed source nodes', () => {
  assert.equal(typeof restoreOwnedRecord, 'function');
  const removed = [];
  const disconnected = {
    node: { isConnected: false, nodeValue: '' },
    originalText: 'Create',
    translationNode: { remove() { removed.push('disconnected'); } },
  };
  const changed = {
    node: { isConnected: true, nodeValue: 'Changed by Midjourney' },
    originalText: 'Create',
    translationNode: { remove() { removed.push('changed'); } },
  };
  assert.equal(restoreOwnedRecord(disconnected), false);
  assert.equal(restoreOwnedRecord(changed), false);
  assert.deepEqual(removed, []);
});

test('queue never exceeds two concurrent requests', async () => {
  const adapter = adapterFor([
    record(1, 'Create'), record(2, 'Explore'), record(3, 'Imagine'),
  ]);
  let active = 0;
  let maxActive = 0;
  const controller = createController({
    adapter,
    concurrency: 2,
    request: async ({ text, provider }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return { text: `中:${text}`, provider };
    },
  });
  controller.enable({ provider: 'free', keepOriginal: true });
  await controller.scan({});
  assert.equal(maxActive, 2);
});

test('concurrent scans share one global concurrency limit', async () => {
  const roots = [
    { records: [record(1, 'Create')] },
    { records: [record(2, 'Explore')] },
    { records: [record(3, 'Imagine')] },
  ];
  const adapter = adapterFor([]);
  adapter.collect = (root) => root.records;
  let active = 0;
  let maxActive = 0;
  const controller = createController({
    adapter,
    concurrency: 2,
    request: async ({ text, provider }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return { text: `中:${text}`, provider };
    },
  });
  controller.enable({ provider: 'free', keepOriginal: true });
  await Promise.all(roots.map((root) => controller.scan(root)));
  assert.equal(maxActive, 2);
});

test('first request failure stops later queued jobs in the same generation', async () => {
  const adapter = adapterFor([
    record(1, 'Create'), record(2, 'Explore'), record(3, 'Imagine'),
  ]);
  let requests = 0;
  const controller = createController({
    adapter,
    concurrency: 1,
    request: async () => {
      requests += 1;
      throw new Error('provider unavailable');
    },
  });
  controller.enable({ provider: 'free', keepOriginal: true });
  await controller.scan({});
  assert.equal(requests, 1);
});
