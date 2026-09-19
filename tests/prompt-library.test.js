const test = require('node:test');
const assert = require('node:assert/strict');

let createPromptLibrary;
let normalizeRecord;
try {
  ({ createPromptLibrary, normalizeRecord } = require('../content/prompt-library.js'));
} catch {
  createPromptLibrary = undefined;
}

function fakeStorage(initial = []) {
  const values = { mjptPromptLibraryV1: structuredClone(initial) };
  let fail = false;
  return {
    async get(key) { return { [key]: structuredClone(values[key]) }; },
    async set(update) {
      if (fail) { fail = false; throw new Error('storage failed'); }
      Object.assign(values, structuredClone(update));
    },
    failNextSet() { fail = true; },
  };
}

function sequence(...values) {
  let index = 0;
  return () => values[index++];
}

test('duplicate titles create distinct records with one date each', async () => {
  assert.equal(typeof createPromptLibrary, 'function');
  const library = createPromptLibrary(fakeStorage(), {
    createId: sequence('id-1', 'id-2'), now: () => '2026-09-19T10:00:00.000Z',
  });
  const first = await library.add({ title: '云宫', chinese: '云海宫殿', english: 'Cloud palace' });
  const second = await library.add({ title: '云宫', chinese: '金色云宫', english: 'Golden cloud palace' });
  assert.deepEqual([first.id, second.id], ['id-1', 'id-2']);
  assert.equal((await library.list()).length, 2);
  assert.ok((await library.list()).every(
    (item) => Object.keys(item).sort().join(',') === 'chinese,date,english,id,title',
  ));
});

test('update uses ID, preserves title, and refreshes the single date', async () => {
  let date = '2026-09-19T10:00:00.000Z';
  const library = createPromptLibrary(fakeStorage(), { createId: () => 'id-1', now: () => date });
  await library.add({ title: '云宫', chinese: '旧中文', english: 'Old English' });
  date = '2026-09-20T10:00:00.000Z';
  const updated = await library.update('id-1', { chinese: '新中文', english: 'New English' });
  assert.deepEqual(updated, {
    id: 'id-1', title: '云宫', chinese: '新中文', english: 'New English', date,
  });
});

test('merge overwrites matching IDs but preserves equal titles with different IDs', async () => {
  const library = createPromptLibrary(fakeStorage(), {
    createId: () => 'id-1', now: () => '2026-09-20T10:00:00.000Z',
  });
  await library.add({ title: 'X', chinese: '旧', english: 'Old' });
  const result = await library.merge([
    { id: 'id-1', title: 'Y', chinese: '覆盖', english: 'Overwrite' },
    { id: 'id-2', title: 'X', chinese: '新增', english: 'Added' },
  ]);
  assert.deepEqual(
    { added: result.added, overwritten: result.overwritten },
    { added: 1, overwritten: 1 },
  );
  assert.deepEqual(result.records.map((item) => item.id).sort(), ['id-1', 'id-2']);
});

test('invalid add and failed atomic write do not replace stored records', async () => {
  const storage = fakeStorage([{
    id: 'safe', title: '保留', chinese: '内容', english: '', date: '2026-09-19T10:00:00.000Z',
  }]);
  const library = createPromptLibrary(storage, { createId: () => 'new', now: () => '2026-09-20T10:00:00.000Z' });
  await assert.rejects(() => library.add({ title: ' ', chinese: '', english: '' }));
  storage.failNextSet();
  await assert.rejects(() => library.merge([{ id: 'new', title: '新', chinese: '新', english: '' }]));
  assert.equal((await library.list())[0].id, 'safe');
});

test('last valid imported duplicate ID wins and malformed stored entries are ignored', async () => {
  const library = createPromptLibrary(
    fakeStorage([null, { id: '', title: '坏' }]),
    { now: () => '2026-09-20T10:00:00.000Z' },
  );
  const result = await library.merge([
    { id: 'same', title: '第一版', chinese: '一', english: '' },
    { id: 'same', title: '第二版', chinese: '二', english: '' },
    { id: '', title: '无效', chinese: '坏', english: '' },
  ]);
  assert.equal(result.records.find((item) => item.id === 'same').title, '第二版');
  assert.equal(result.skipped, 1);
});

test('normalization trims fields and rejects invalid records', () => {
  assert.equal(typeof normalizeRecord, 'function');
  assert.deepEqual(normalizeRecord({
    id: ' id ', title: ' 标题 ', chinese: ' 中文 ', english: ' English ',
    date: '2026-09-19T10:00:00.000Z',
  }), {
    id: 'id', title: '标题', chinese: ' 中文 ', english: ' English ',
    date: '2026-09-19T10:00:00.000Z',
  });
  assert.equal(normalizeRecord({ id: 'x', title: '', chinese: '中', date: 'bad' }), null);
  assert.equal(normalizeRecord({ id: 'x', title: 'X', chinese: '', english: '', date: '2026-09-19T10:00:00.000Z' }), null);
});
