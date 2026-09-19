const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isTranslationCandidate,
  shouldSkipElement,
  isVisibleElement,
  restoreOwnedRecord,
  createController,
} = require('../content/page-translator.js');

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
    assert.equal(isTranslationCandidate(text), expected);
  });
}

test('skips protected, editable, extension-owned, and hidden content', () => {
  const element = (tagName, parentElement = null, extra = {}) => ({ tagName, parentElement, ...extra });
  const panel = element('SECTION', null, { id: 'mjpt-panel' });
  const editable = element('DIV', null, { getAttribute: (name) => (name === 'contenteditable' ? 'true' : null) });
  assert.ok([
    element('SPAN', panel), element('INPUT'), element('TEXTAREA'), element('SCRIPT'),
    element('STYLE'), element('CODE'), element('SPAN', editable),
  ].every((item) => shouldSkipElement(item)));
  const hidden = { hidden: true, parentElement: null, getAttribute: () => null };
  const child = { hidden: false, parentElement: hidden, getAttribute: () => null };
  assert.equal(isVisibleElement(child, () => ({ display: 'block', visibility: 'visible' })), false);
});

function record(id, text) {
  return { id, text, connected: true };
}

function emptyCache(seed = []) {
  const values = new Map(seed.map(({ provider, source, translated }) => [`${provider}\0${source}`, translated]));
  return {
    puts: [],
    get(provider, source) { return values.get(`${provider}\0${source.trim().replace(/\s+/g, ' ')}`); },
    put(provider, source, translated) {
      const normalized = source.trim().replace(/\s+/g, ' ');
      values.set(`${provider}\0${normalized}`, translated);
      this.puts.push({ provider, source: normalized, translated });
    },
    flushes: 0,
    async flush() { this.flushes += 1; },
  };
}

function visibilityAdapter(source) {
  const callbacks = new Map();
  const events = [];
  const recordsFor = (root) => (Array.isArray(source) ? source : source[root] || []);
  return {
    events,
    async discover(root, { batchSize, yieldControl, onRecord }) {
      let visited = 0;
      for (const item of recordsFor(root)) {
        visited += 1;
        onRecord(item);
        if (visited % batchSize === 0) await yieldControl();
      }
    },
    observe(item, onVisible) { callbacks.set(item.id, { item, onVisible }); },
    unobserve(item) { callbacks.delete(item.id); },
    render(item, chinese, keepOriginal) { events.push({ type: 'render', id: item.id, chinese, keepOriginal }); },
    setKeepOriginal(item, keepOriginal) { events.push({ type: 'mode', id: item.id, keepOriginal }); },
    restore(item) { events.push({ type: 'restore', id: item.id }); },
    show(id) {
      const entry = callbacks.get(id);
      return entry ? entry.onVisible(entry.item) : Promise.resolve();
    },
    showAllWithoutWaiting() {
      for (const { item, onVisible } of [...callbacks.values()]) onVisible(item);
    },
    observedCount() { return callbacks.size; },
    renderedIds() { return events.filter((event) => event.type === 'render').map((event) => event.id); },
  };
}

function countedRequest(result = (payload) => ({ text: `中:${payload.text}`, provider: payload.provider })) {
  const request = async (payload) => {
    request.calls.push(payload);
    return result(payload);
  };
  request.calls = [];
  return request;
}

function deferredRequest() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  const request = countedRequest(() => promise);
  return { request, calls: request.calls, resolve };
}

test('offscreen records do not request until their visibility callback fires', async () => {
  const adapter = visibilityAdapter([record(1, 'Create')]);
  const request = countedRequest();
  const controller = createController({ adapter, cache: emptyCache(), request });
  controller.enable({ provider: 'deepseek', keepOriginal: true });
  await controller.register({});
  assert.equal(request.calls.length, 0);
  await adapter.show(1);
  assert.equal(request.calls.length, 1);
});

test('equal text across mutation registrations shares one in-flight request', async () => {
  const adapter = visibilityAdapter({
    one: [record(1, 'Create image')], two: [record(2, ' Create   image ')],
  });
  const pending = deferredRequest();
  const controller = createController({ adapter, cache: emptyCache(), request: pending.request });
  controller.enable({ provider: 'deepseek', keepOriginal: true });
  await Promise.all([controller.register('one'), controller.register('two')]);
  const rendering = Promise.all([adapter.show(1), adapter.show(2)]);
  assert.equal(pending.calls.length, 1);
  pending.resolve({ text: '创建图像', provider: 'deepseek' });
  await rendering;
  assert.deepEqual(adapter.renderedIds(), [1, 2]);
});

test('queue never owns more than two hundred service keys', async () => {
  const records = Array.from({ length: 250 }, (_, index) => record(index, `Create ${index}`));
  const adapter = visibilityAdapter(records);
  const controller = createController({
    adapter, cache: emptyCache(), request: () => new Promise(() => {}), maxPending: 200,
  });
  controller.enable({ provider: 'deepseek', keepOriginal: true });
  await controller.register({});
  adapter.showAllWithoutWaiting();
  assert.equal(controller.snapshot().pending, 200);
  assert.equal(adapter.observedCount(), 250);
});

test('discovery yields after each one hundred visited records', async () => {
  const adapter = visibilityAdapter(Array.from({ length: 250 }, (_, index) => record(index, `Create ${index}`)));
  let yields = 0;
  const controller = createController({
    adapter,
    cache: emptyCache(),
    request: countedRequest(),
    yieldControl: async () => { yields += 1; },
  });
  controller.enable({ provider: 'free', keepOriginal: true });
  await controller.register({});
  assert.equal(yields, 2);
});

test('cache hits avoid requests and provider changes use separate entries', async () => {
  const cache = emptyCache([{ provider: 'deepseek', source: 'Create', translated: '创建' }]);
  const request = countedRequest();
  const adapter = visibilityAdapter([record(1, 'Create')]);
  const controller = createController({ adapter, cache, request });
  controller.enable({ provider: 'deepseek', keepOriginal: true });
  await controller.register({});
  await adapter.show(1);
  assert.equal(request.calls.length, 0);
  controller.setProvider('qwen');
  await controller.register({});
  await adapter.show(1);
  assert.equal(request.calls.length, 1);
});

test('switching away and back never reuses a cancelled provider request', async () => {
  const adapter = visibilityAdapter([record(1, 'Create')]);
  const pending = [];
  const request = (payload) => new Promise((resolve) => pending.push({ payload, resolve }));
  const controller = createController({ adapter, cache: emptyCache(), request });
  controller.enable({ provider: 'deepseek', keepOriginal: true });
  await controller.register({});
  const oldShowing = adapter.show(1);
  assert.equal(pending.length, 1);

  controller.setProvider('qwen');
  controller.setProvider('deepseek');
  await controller.register({});
  const newShowing = adapter.show(1);
  assert.equal(pending.length, 2);

  pending[0].resolve({ text: '旧结果', provider: 'deepseek' });
  pending[1].resolve({ text: '新结果', provider: 'deepseek' });
  await Promise.all([oldShowing, newShowing]);
  assert.deepEqual(
    adapter.events.filter((event) => event.type === 'render').map((event) => event.chinese),
    ['新结果'],
  );
});

test('flushes a dirty persistent cache when the request queue becomes idle', async () => {
  const cache = emptyCache();
  const adapter = visibilityAdapter([record(1, 'Create')]);
  const controller = createController({ adapter, cache, request: countedRequest() });
  controller.enable({ provider: 'deepseek', keepOriginal: true });
  await controller.register({});
  await adapter.show(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cache.flushes, 1);
});

test('global request concurrency never exceeds two', async () => {
  const adapter = visibilityAdapter([record(1, 'Create'), record(2, 'Explore'), record(3, 'Imagine')]);
  let active = 0;
  let maxActive = 0;
  const controller = createController({
    adapter,
    cache: emptyCache(),
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
  await controller.register({});
  await Promise.all([adapter.show(1), adapter.show(2), adapter.show(3)]);
  assert.equal(maxActive, 2);
});

test('first request failure halts later queued jobs', async () => {
  const adapter = visibilityAdapter([record(1, 'Create'), record(2, 'Explore'), record(3, 'Imagine')]);
  let requests = 0;
  const errors = [];
  const controller = createController({
    adapter,
    cache: emptyCache(),
    concurrency: 1,
    request: async () => { requests += 1; throw new Error('provider unavailable'); },
    onError: (error) => errors.push(error.message),
  });
  controller.enable({ provider: 'free', keepOriginal: true });
  await controller.register({});
  await Promise.all([adapter.show(1), adapter.show(2), adapter.show(3)]);
  assert.equal(requests, 1);
  assert.deepEqual(errors, ['provider unavailable']);
});

test('disable restores records and ignores a delayed response', async () => {
  const adapter = visibilityAdapter([record(1, 'Create')]);
  const pending = deferredRequest();
  const controller = createController({ adapter, cache: emptyCache(), request: pending.request });
  controller.enable({ provider: 'free', keepOriginal: true });
  await controller.register({});
  const showing = adapter.show(1);
  controller.disable();
  pending.resolve({ text: '创建', provider: 'free' });
  await showing;
  assert.equal(adapter.renderedIds().length, 0);
  assert.ok(adapter.events.some((event) => event.type === 'restore'));
});

test('keep-original mode changes rendered records without retranslating', async () => {
  const adapter = visibilityAdapter([record(1, 'Create')]);
  const request = countedRequest();
  const controller = createController({ adapter, cache: emptyCache(), request });
  controller.enable({ provider: 'free', keepOriginal: true });
  await controller.register({});
  await adapter.show(1);
  controller.setKeepOriginal(false);
  assert.equal(request.calls.length, 1);
  assert.deepEqual(adapter.events.at(-1), { type: 'mode', id: 1, keepOriginal: false });
});

test('restore skips disconnected and externally changed source nodes', () => {
  const removed = [];
  const disconnected = {
    node: { isConnected: false, nodeValue: '' }, originalText: 'Create',
    translationNode: { remove() { removed.push('disconnected'); } },
  };
  const changed = {
    node: { isConnected: true, nodeValue: 'Changed by Midjourney' }, originalText: 'Create',
    translationNode: { remove() { removed.push('changed'); } },
  };
  assert.equal(restoreOwnedRecord(disconnected), false);
  assert.equal(restoreOwnedRecord(changed), false);
  assert.deepEqual(removed, []);
});
