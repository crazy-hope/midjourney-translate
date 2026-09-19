const test = require('node:test');
const assert = require('node:assert/strict');

let normalizeSource;
let createPageTranslationCache;
try {
  ({ normalizeSource, createPageTranslationCache } = require('../content/page-translation-cache.js'));
} catch {
  createPageTranslationCache = undefined;
}

function fakeStorage(initial = []) {
  const values = { mjptPageTranslationCacheV1: structuredClone(initial) };
  return {
    writes: [],
    async get(key) { return { [key]: structuredClone(values[key]) }; },
    async set(update) {
      this.writes.push(structuredClone(update));
      Object.assign(values, structuredClone(update));
    },
  };
}

function tickingClock() {
  let value = 0;
  return () => { value += 1; return value; };
}

test('normalizes whitespace and separates providers', async () => {
  assert.equal(typeof normalizeSource, 'function');
  assert.equal(normalizeSource('  Create \n  image '), 'Create image');
  const cache = createPageTranslationCache(fakeStorage(), { now: tickingClock() });
  await cache.load();
  cache.put('deepseek', '  Create   image ', '创建图像');
  assert.equal(cache.get('deepseek', 'Create image'), '创建图像');
  assert.equal(cache.get('qwen', 'Create image'), undefined);
});

test('evicts least recently used entries above the configured bound', async () => {
  const storage = fakeStorage();
  const cache = createPageTranslationCache(storage, { maxEntries: 2, now: tickingClock() });
  await cache.load();
  cache.put('deepseek', 'A', '甲');
  cache.put('deepseek', 'B', '乙');
  assert.equal(cache.get('deepseek', 'A'), '甲');
  cache.put('deepseek', 'C', '丙');
  await cache.flush();
  assert.equal(cache.get('deepseek', 'B'), undefined);
  assert.equal(cache.get('deepseek', 'C'), '丙');
  assert.equal(storage.writes.at(-1).mjptPageTranslationCacheV1.length, 2);
});

test('corrupt storage becomes an empty cache and empty translations are rejected', async () => {
  const cache = createPageTranslationCache(fakeStorage('corrupt'));
  await cache.load();
  assert.equal(cache.get('deepseek', 'A'), undefined);
  assert.throws(() => cache.put('deepseek', 'A', ''), /不能为空/);
});

test('default capacity retains only the newest one thousand entries', async () => {
  const cache = createPageTranslationCache(fakeStorage(), { now: tickingClock() });
  await cache.load();
  for (let index = 0; index < 1001; index += 1) cache.put('free', `K${index}`, `V${index}`);
  await cache.flush();
  assert.equal(cache.snapshot().size, 1000);
  assert.equal(cache.get('free', 'K0'), undefined);
});

test('loads valid entries and discards malformed entries', async () => {
  const cache = createPageTranslationCache(fakeStorage([
    { key: 'ignored', provider: 'deepseek', source: ' Create ', translated: '创建', lastUsed: 4 },
    { provider: '', source: 'Bad', translated: '坏', lastUsed: 5 },
  ]), { now: tickingClock() });
  await cache.load();
  assert.equal(cache.get('deepseek', 'Create'), '创建');
  assert.equal(cache.snapshot().size, 1);
});

test('flush calls are serialized and keep memory after a write failure', async () => {
  let active = 0;
  let maxActive = 0;
  let fail = true;
  const storage = {
    async get() { return { mjptPageTranslationCacheV1: [] }; },
    async set() {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      if (fail) { fail = false; throw new Error('write failed'); }
    },
  };
  const cache = createPageTranslationCache(storage, { now: tickingClock() });
  await cache.load();
  cache.put('free', 'Create', '创建');
  const first = cache.flush();
  const second = cache.flush();
  await assert.rejects(first);
  await second;
  assert.equal(maxActive, 1);
  assert.equal(cache.get('free', 'Create'), '创建');
});
