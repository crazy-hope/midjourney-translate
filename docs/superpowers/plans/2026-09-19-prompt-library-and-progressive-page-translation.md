# Prompt Library and Progressive Page Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace automatic prompt drafting with an ID-based local prompt library and make page translation viewport-driven, bounded, inline, and reusable across sessions.

**Architecture:** Add isolated data modules for prompt records, import/export codecs, and a provider-aware persistent page-translation cache. Refactor the page translator around incremental discovery plus visibility observation, then wire those modules into the existing content panel without adding a backend or runtime dependency.

**Tech Stack:** Chrome Manifest V3, dependency-free JavaScript, `chrome.storage.local`, `IntersectionObserver`, `MutationObserver`, Blob downloads, Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-19-prompt-library-and-progressive-page-translation-design.md`

## Global Constraints

- No backend, remote script, or third-party runtime dependency.
- Prompt identity is the local `id`; duplicate titles must coexist.
- A prompt has exactly one `date`, refreshed on add, update, or import overwrite.
- Configuration save must never read or write prompt text.
- Page translation is off by default and sends only near-viewport eligible text after explicit opt-in.
- At most two page-translation requests may be active and at most 200 normalized keys may be queued.
- Candidate discovery handles at most 100 text nodes before yielding; mutation roots are coalesced for 100 milliseconds.
- Persistent page cache identity is provider plus normalized English source and holds at most 1,000 entries.
- All new behavior follows red-green-refactor TDD and preserves the complete existing suite.

## Review Focus

- A Midjourney mutation inserts a large ancestor and many descendants: discovery must inspect the subtree once per batch, yield every 100 nodes, and not form overlapping full-page scans.
- Hundreds of identical visible labels arrive across separate mutations: they must share one in-flight request and one persistent cache entry.
- A prompt title is duplicated while IDs differ: both records must stay selectable and show date-based disambiguation.
- Imported content contains blank lines, Markdown fences, separator-like text, Unicode, and duplicate IDs: round-trip content exactly and use the last valid duplicate ID.
- Storage or parsing fails midway: preserve the previous library/cache and keep current editor content usable.

---

### Task 1: Make the save action configuration-only

**Files:**
- Modify: `content/draft-store.js`
- Modify: `tests/draft-store.test.js`
- Modify: `content/content.js`

**Interfaces:**
- Produces: `savePanelConfig(runtime, provider, translationInstruction, params) -> Promise<void>`.
- Retains: `clearPanelContent(input, preview)` for temporary UI clearing.
- Removes from runtime use: `createDraftStore`, automatic draft loading, and automatic draft saving.

- [ ] **Step 1: Replace the old persistence expectation with failing tests**

```js
test('configuration save never persists prompt text', async () => {
  const sent = [];
  const runtime = { async sendMessage(message) { sent.push(message); return { ok: true }; } };
  await savePanelConfig(runtime, 'qwen', '电影镜头', { aspectRatio: '3:2' });
  assert.deepEqual(sent, [{
    type: 'save-ui-settings',
    provider: 'qwen',
    translationInstruction: '电影镜头',
    params: { aspectRatio: '3:2' },
  }]);
  assert.equal(JSON.stringify(sent).includes('中文提示词'), false);
});
```

Retain this explicit temporary-clear test:

```js
test('clear removes only current editor state', () => {
  const input = { value: '云海宫殿' };
  const preview = { value: '云海宫殿\nCloud palace', dataset: { english: 'Cloud palace' } };
  clearPanelContent(input, preview);
  assert.equal(input.value, '');
  assert.equal(preview.value, '');
  assert.deepEqual(preview.dataset, {});
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/draft-store.test.js`

Expected: FAIL because `savePanelConfig` is not exported and the old helper still requires a draft store and prompt.

- [ ] **Step 3: Implement the configuration-only helper**

```js
async function savePanelConfig(runtime, provider, translationInstruction, params) {
  if (!runtime || typeof runtime.sendMessage !== 'function') {
    throw new TypeError('Chrome runtime is required');
  }
  const response = await runtime.sendMessage({
    type: 'save-ui-settings', provider, translationInstruction, params,
  });
  if (!response?.ok) throw new Error(response?.message || '配置保存失败');
}
```

Remove the content script's `draftStore`, `draftSaveTimer`, `load()` call, input debounce, and prompt arguments. Change the button label and status copy to “保存配置” and “配置已保存到本地”. Change clear status copy so it does not promise refresh restoration. Leave the legacy storage key untouched.

- [ ] **Step 4: Verify the focused and complete suites**

Run: `node --test tests/draft-store.test.js && npm test`

Expected: PASS with no draft read/write expectation remaining.

- [ ] **Step 5: Commit**

```bash
git add content/draft-store.js content/content.js tests/draft-store.test.js
git commit -m "refactor: save translator configuration only"
```

### Task 2: Add the ID-based prompt library

**Files:**
- Create: `content/prompt-library.js`
- Create: `tests/prompt-library.test.js`
- Modify: `manifest.json`

**Interfaces:**
- Produces: `normalizeRecord(value) -> record|null`.
- Produces: `createPromptLibrary(storageArea, options) -> { list, add, update, merge }`.
- `add({ title, chinese, english }) -> record` always creates a new ID.
- `update(id, { chinese, english }) -> record` preserves ID/title and refreshes date.
- `merge(records) -> { records, added, overwritten, skipped }` performs one atomic storage write and matches only by ID.

- [ ] **Step 1: Write failing normalization and CRUD tests**

```js
test('duplicate titles create distinct records with one date each', async () => {
  const library = createPromptLibrary(fakeStorage(), {
    createId: sequence('id-1', 'id-2'), now: () => '2026-09-19T10:00:00.000Z',
  });
  const first = await library.add({ title: '云宫', chinese: '云海宫殿', english: 'Cloud palace' });
  const second = await library.add({ title: '云宫', chinese: '金色云宫', english: 'Golden cloud palace' });
  assert.deepEqual([first.id, second.id], ['id-1', 'id-2']);
  assert.equal((await library.list()).length, 2);
  assert.ok((await library.list()).every((item) => Object.keys(item).sort().join(',') === 'chinese,date,english,id,title'));
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
  assert.deepEqual({ added: result.added, overwritten: result.overwritten }, { added: 1, overwritten: 1 });
  assert.deepEqual(result.records.map((item) => item.id).sort(), ['id-1', 'id-2']);
});

test('invalid add and failed atomic write do not replace stored records', async () => {
  const storage = fakeStorage([{ id: 'safe', title: '保留', chinese: '内容', english: '', date: 'd' }]);
  const library = createPromptLibrary(storage, { createId: () => 'new', now: () => 'now' });
  await assert.rejects(() => library.add({ title: ' ', chinese: '', english: '' }));
  storage.failNextSet();
  await assert.rejects(() => library.merge([{ id: 'new', title: '新', chinese: '新', english: '' }]));
  assert.equal((await library.list())[0].id, 'safe');
});

test('last valid imported duplicate ID wins and malformed stored entries are ignored', async () => {
  const library = createPromptLibrary(fakeStorage([null, { id: '', title: '坏' }]), { now: () => 'now' });
  const result = await library.merge([
    { id: 'same', title: '第一版', chinese: '一', english: '' },
    { id: 'same', title: '第二版', chinese: '二', english: '' },
  ]);
  assert.equal(result.records.find((item) => item.id === 'same').title, '第二版');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/prompt-library.test.js`

Expected: FAIL because `content/prompt-library.js` does not exist.

- [ ] **Step 3: Implement normalized records and atomic storage operations**

```js
const DEFAULT_KEY = 'mjptPromptLibraryV1';

function createPromptLibrary(storageArea, options = {}) {
  const key = options.key || DEFAULT_KEY;
  const now = options.now || (() => new Date().toISOString());
  const createId = options.createId || (() => crypto.randomUUID());
  async function read() {
    const stored = await storageArea.get(key);
    const byId = new Map();
    for (const value of Array.isArray(stored?.[key]) ? stored[key] : []) {
      const record = normalizeRecord(value);
      if (record) byId.set(record.id, record);
    }
    return [...byId.values()];
  }
  async function write(records) { await storageArea.set({ [key]: records }); }
  return Object.freeze({ list, add, update, merge });
}
```

Build every next array in memory before one `storageArea.set`. Reject add/update without mutating stored data. For import merge, assign `now()` to every added or overwritten result, ignore imported dates, and use only ID equality for overwrite.

- [ ] **Step 4: Add the new module before `content/content.js` in the manifest**

```json
"content/prompt-library.js"
```

- [ ] **Step 5: Verify focused tests and extension validation**

Run: `node --test tests/prompt-library.test.js && npm run validate`

Expected: PASS; manifest validation finds the new file.

- [ ] **Step 6: Commit**

```bash
git add content/prompt-library.js tests/prompt-library.test.js manifest.json
git commit -m "feat: add local prompt library"
```

### Task 3: Add robust Markdown and TXT import/export codecs

**Files:**
- Create: `content/prompt-file.js`
- Create: `tests/prompt-file.test.js`
- Modify: `manifest.json`

**Interfaces:**
- Produces: `serialize(records, 'md'|'txt') -> string`.
- Produces: `parse(text, 'md'|'txt') -> { records, skipped }`.
- Produces: `exportFilename(format, date) -> string`.
- Format version marker: `MJPT_PROMPT_LIBRARY_V1`.

- [ ] **Step 1: Write failing round-trip and malformed-file tests**

```js
for (const format of ['md', 'txt']) {
  test(`${format} round trips Unicode, blank lines, fences, and separators`, () => {
    const records = [{
      id: 'id-1', title: '云宫 --- ```', chinese: '第一行\n\n第二行',
      english: 'Cloud palace\n```json\nnot metadata', date: '2026-09-19T10:00:00.000Z',
    }];
    assert.deepEqual(parse(serialize(records, format), format).records, records);
  });
}

test('rejects a file without a valid format marker before returning records', () => {
  assert.throws(() => parse('ordinary notes', 'txt'), /无法识别/);
});

test('counts invalid payloads as skipped while retaining valid records', () => {
  const text = 'MJPT_PROMPT_LIBRARY_V1\nMJPT_RECORD 4\nnope\nMJPT_RECORD 72\n'
    + '{"id":"a","title":"A","chinese":"中","english":"EN","date":"d"}';
  const result = parse(text, 'txt');
  assert.equal(result.skipped, 1);
  assert.equal(result.records[0].id, 'a');
});

test('rejects unsupported formats and creates deterministic filenames', () => {
  assert.throws(() => serialize([], 'csv'), /格式/);
  assert.equal(exportFilename('md', new Date('2026-09-19T10:00:00Z')), 'mj-prompts-2026-09-19.md');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/prompt-file.test.js`

Expected: FAIL because the codec module is absent.

- [ ] **Step 3: Implement a readable wrapper around exact JSON payloads**

Markdown layout:

````markdown
<!-- MJPT_PROMPT_LIBRARY_V1 -->
# 标题

日期：2026-09-19T10:00:00.000Z

```mjpt-record
{"id":"...","title":"...","chinese":"...","english":"...","date":"..."}
```
````

TXT layout begins with `MJPT_PROMPT_LIBRARY_V1` and stores one `MJPT_RECORD <javascript-string-length>` header followed by an exact JSON payload. Parse with `String.prototype.slice` using the declared UTF-16 code-unit length, not visual separators, so arbitrary prompt text round-trips.

- [ ] **Step 4: Load the codec before `content/content.js` and verify**

Run: `node --test tests/prompt-file.test.js && npm run validate`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add content/prompt-file.js tests/prompt-file.test.js manifest.json
git commit -m "feat: add prompt library import and export codecs"
```

### Task 4: Add the bounded persistent page-translation cache

**Files:**
- Create: `content/page-translation-cache.js`
- Create: `tests/page-translation-cache.test.js`
- Modify: `manifest.json`

**Interfaces:**
- Produces: `normalizeSource(text) -> string`.
- Produces: `createPageTranslationCache(storageArea, { key, maxEntries, now })`.
- Cache methods: `load()`, `get(provider, source)`, `put(provider, source, translated)`, `flush()`.
- Stored entry: `{ key, provider, source, translated, lastUsed }`.

- [ ] **Step 1: Write failing cache tests**

```js
test('normalizes whitespace and separates providers', async () => {
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
});

test('corrupt storage becomes an empty cache and empty translations are rejected', async () => {
  const cache = createPageTranslationCache(fakeStorage('corrupt'));
  await cache.load();
  assert.equal(cache.get('deepseek', 'A'), undefined);
  assert.throws(() => cache.put('deepseek', 'A', ''));
});

test('default capacity retains only the newest one thousand entries', async () => {
  const cache = createPageTranslationCache(fakeStorage(), { now: tickingClock() });
  await cache.load();
  for (let index = 0; index < 1001; index += 1) cache.put('free', `K${index}`, `V${index}`);
  await cache.flush();
  assert.equal(cache.snapshot().size, 1000);
  assert.equal(cache.get('free', 'K0'), undefined);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/page-translation-cache.test.js`

Expected: FAIL because the cache module is absent.

- [ ] **Step 3: Implement memory-first LRU with explicit flush**

```js
function normalizeSource(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

function cacheKey(provider, source) {
  return `${provider}\u0000${normalizeSource(source)}`;
}
```

`put` updates memory synchronously; `flush` snapshots the newest 1,000 entries and serializes writes through one promise chain. Loading malformed data resolves to an empty cache. A storage error rejects `flush` but does not erase the in-memory map.

- [ ] **Step 4: Add the cache module before the page translator and verify**

Run: `node --test tests/page-translation-cache.test.js && npm run validate`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add content/page-translation-cache.js tests/page-translation-cache.test.js manifest.json
git commit -m "feat: persist deduplicated page translations"
```

### Task 5: Replace full-page scanning with progressive visibility scheduling

**Files:**
- Modify: `content/page-translator.js`
- Modify: `tests/page-translator.test.js`
- Modify: `content/styles.css`

**Interfaces:**
- `createController({ adapter, cache, request, concurrency: 2, maxPending: 200, onProgress, onError })`.
- Controller methods become `enable`, `disable`, `register(root)`, `setKeepOriginal`, `setProvider`, `snapshot`, `flushCache`.
- Browser adapter provides `discover(root, { batchSize, yieldControl, onRecord })`, `observe(item, onVisible)`, `unobserve(item)`, `render`, `setKeepOriginal`, and `restore`.

- [ ] **Step 1: Write failing scheduling and reuse tests**

```js
test('offscreen records do not request until their visibility callback fires', async () => {
  const adapter = visibilityAdapter([record(1, 'Create')]);
  const controller = createController({ adapter, cache: emptyCache(), request: countedRequest() });
  controller.enable({ provider: 'deepseek', keepOriginal: true });
  await controller.register({});
  assert.equal(requests.length, 0);
  await adapter.show(1);
  assert.equal(requests.length, 1);
});

test('equal text across mutation registrations shares one in-flight request', async () => {
  const adapter = visibilityAdapter({ one: [record(1, 'Create image')], two: [record(2, ' Create   image ')] });
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

test('queue never owns more than 200 waiting keys', async () => {
  const adapter = visibilityAdapter(uniqueRecords(250));
  const controller = createController({
    adapter, cache: emptyCache(), request: neverResolvingRequest(), maxPending: 200,
  });
  controller.enable({ provider: 'deepseek', keepOriginal: true });
  await controller.register({});
  adapter.showAllWithoutWaiting();
  assert.equal(controller.snapshot().pending, 200);
  assert.equal(adapter.observedCount(), 250);
});

test('discovery yields after each one hundred visited text nodes and coalesces nested roots', async () => {
  const adapter = yieldingAdapter(250);
  const controller = createController({ adapter, cache: emptyCache(), request: countedRequest() });
  controller.enable({ provider: 'free', keepOriginal: true });
  await controller.register(adapter.parentWithNestedChild());
  assert.equal(adapter.discoveryPasses(), 1);
  assert.equal(adapter.yieldCount(), 2);
});

test('cache hits avoid requests and provider changes use separate cache entries', async () => {
  const cache = seededCache('deepseek', 'Create', '创建');
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
```

Retain and adapt the existing explicit tests for two-request global concurrency, first-error halting, disable cancellation, provider switching, and delayed responses to call `register` plus visibility callbacks instead of `scan`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/page-translator.test.js`

Expected: FAIL because the current controller requests during a whole-root scan and has no visibility registration contract.

- [ ] **Step 3: Implement a generation-scoped bounded scheduler**

Use one `pendingKeys` queue, one `queuedKeys` set, one `inflightByKey` map, and `waitingRecordsByKey`. A visibility callback adds its record to the normalized provider key, checks the persistent cache, and queues only if capacity exists. Completion renders every connected waiter for that key, writes the cache, frees capacity, and reconsiders visible overflow records. Generation checks guard every await boundary.

The browser adapter uses one `IntersectionObserver` configured with:

```js
{ root: null, rootMargin: '300px 0px', threshold: 0 }
```

Discovery deduplicates nested mutation roots, visits at most 100 text nodes per slice, and yields with an injected `requestAnimationFrame` promise. If `IntersectionObserver` is unavailable, use bounding-rectangle checks in the same bounded discovery slices; do not translate the full tree immediately.

- [ ] **Step 4: Make retained-original translations inline**

```css
.mjpt-page-translation {
  display: inline;
  margin-inline-start: .35em;
  color: #7c6cf2;
  font-size: .9em;
  pointer-events: none !important;
}
.mjpt-page-translation::before { content: "（"; }
.mjpt-page-translation::after { content: "）"; }
```

Keep the original text node and parent element intact so Midjourney's click target and listeners are unchanged.

- [ ] **Step 5: Verify focused tests, full tests, and validation**

Run: `node --test tests/page-translator.test.js tests/page-translation-cache.test.js && npm test && npm run validate`

Expected: PASS; no whole-document request burst remains.

- [ ] **Step 6: Commit**

```bash
git add content/page-translator.js content/styles.css tests/page-translator.test.js
git commit -m "fix: translate page content progressively"
```

### Task 6: Integrate prompt library controls and file actions into the panel

**Files:**
- Modify: `content/content.js`
- Modify: `content/panel-state.js`
- Modify: `content/styles.css`
- Modify: `tests/panel-state.test.js`
- Modify: `tests/dom-adapter.test.js`

**Interfaces:**
- Consumes: `MJPromptLibrary.createPromptLibrary`, `MJPromptFile.serialize/parse`, and the progressive page controller.
- Produces pure UI helpers in `panel-state.js`: `formatPromptOption(record)`, `filterPromptRecords(records, query)`, `canUpdateSelectedPrompt(selectedId, preview)`.

- [ ] **Step 1: Write failing pure panel-state tests**

```js
test('duplicate prompt titles are disambiguated by date and remain searchable', () => {
  const records = [
    { id: 'a', title: '云宫', date: '2026-09-18T10:00:00.000Z' },
    { id: 'b', title: '云宫', date: '2026-09-19T10:00:00.000Z' },
  ];
  assert.deepEqual(filterPromptRecords(records, '云宫').map(formatPromptOption), [
    '云宫 · 2026-09-18', '云宫 · 2026-09-19',
  ]);
});

test('selected stale preview cannot update a stored prompt', () => {
  assert.equal(canUpdateSelectedPrompt('id-1', { dataset: { english: 'Old', stale: 'true' } }), false);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/panel-state.test.js`

Expected: FAIL because the library UI helpers do not exist.

- [ ] **Step 3: Implement heading, combobox, dialog, and selection markup**

Add `data-mjpt` controls for `import`, `export`, `library-search`, `library-results`, `prompt-add`, `prompt-update`, `title-dialog`, and a hidden `.txt,.md` file input. Keep all popovers/dialogs inside `#mjpt-panel` so interaction-scope logic keeps the panel open.

On selection:

```js
input.value = record.chinese;
const previewText = MJPromptCore.buildBilingualResult(
  MJPromptCore.splitPromptParagraphs(record.chinese),
  MJPromptCore.splitPromptParagraphs(record.english),
).preview;
MJPanelState.setPreviewResult(preview, previewText, record.english, false);
selectedPromptId = record.id;
```

Handle empty saved English by clearing the preview's English dataset so “填入” remains blocked.

- [ ] **Step 4: Wire add and update behavior**

“新增” validates title and non-empty prompt content, calls `library.add`, refreshes results, and selects the returned ID. “更新” requires a selected ID and `isPreviewFresh(preview)`, then calls `library.update`; stale content produces “请先重新翻译后再更新”. Clear resets current selection without deleting a record.

- [ ] **Step 5: Wire atomic import and two-format export**

Read the selected file with `file.text()`, infer `md`/`txt` from the lower-cased extension, fully parse first, then call `library.merge`. Report “新增 N，覆盖 N，跳过 N”. Export opens an in-panel format choice, serializes all records, creates a UTF-8 Blob, clicks a temporary download anchor, and always revokes its object URL.

- [ ] **Step 6: Wire progressive page registration**

On enable call `pageTranslator.enable(...)` followed by `pageTranslator.register(document.body)`. MutationObserver collects non-extension added roots into a `Set`, waits 100 milliseconds, drops roots contained by another collected root, and calls `register` once per remaining root. On disable clear the root timer/set and call `disable`. Switching provider starts a fresh generation and registers the body progressively rather than calling the removed `scan` method.

- [ ] **Step 7: Style controls without covering Midjourney**

Use wrapping flex rows in both heading areas, a bounded results popover within the panel, and an in-panel modal layer. Preserve `position: fixed`, calculated composer width, and the existing panel-host placement. Add narrow-screen stacking without increasing page-level z-index beyond the panel.

- [ ] **Step 8: Verify integration-oriented tests and full suite**

Run: `node --test tests/panel-state.test.js tests/dom-adapter.test.js tests/prompt-library.test.js tests/prompt-file.test.js && npm test && npm run validate`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add content/content.js content/panel-state.js content/styles.css tests/panel-state.test.js tests/dom-adapter.test.js
git commit -m "feat: integrate reusable prompt library"
```

### Task 7: Update documentation and perform browser acceptance

**Files:**
- Modify: `README.md`
- Modify: `PRIVACY.md`
- Modify: `manifest.json`

**Interfaces:**
- Documents the exact shipped storage, page-translation, import/export, and manual-reload behavior.

- [ ] **Step 1: Update user documentation**

Replace draft-save instructions with prompt-library add/select/update instructions. Document duplicate titles, ID-based import overwrite, Markdown/TXT export, configuration-only save, visible-area translation, inline Chinese, persistent provider-separated reuse, and how to retry after a provider error.

- [ ] **Step 2: Update privacy disclosure**

List prompt-library records and bounded page-translation cache under locally stored data. Remove claims that page results are memory-only and remove automatic Chinese draft storage. State that imported files are parsed locally and exported files are generated locally.

- [ ] **Step 3: Increment the extension patch version**

Change `manifest.json` from `0.1.0` to `0.1.1` because this is a user-visible compatible feature and performance fix.

- [ ] **Step 4: Run fresh automated verification**

Run: `git diff --check && npm test && npm run validate`

Expected: all tests pass, the manifest validates, and there are no whitespace errors.

- [ ] **Step 5: Perform Midjourney browser acceptance**

Reload the unpacked extension and refresh Midjourney. Verify:

1. enabling page translation on a long gallery leaves scrolling and clicks responsive;
2. repeated buttons reuse one translated result and Chinese appears inline in parentheses;
3. offscreen text translates only as it approaches the viewport;
4. add two prompts with the same title, distinguish and select both, retranslate before update, then reload and select them again;
5. export both formats, import each, and observe ID-based overwrite counts;
6. save configuration, refresh, and confirm unsaved prompt editor text is not restored;
7. the panel remains composer-width and does not cover Midjourney submit controls.

If live provider credentials are unavailable, complete DOM/UI acceptance with cached or stubbed translations and explicitly report that live endpoint behavior remains for the user to verify.

- [ ] **Step 6: Commit**

```bash
git add README.md PRIVACY.md manifest.json
git commit -m "docs: explain prompt library and progressive translation"
```

### Task 8: Whole-branch review and completion gate

**Files:**
- Review all files changed since the design commit.

**Interfaces:**
- No new interface; this task validates the integrated branch against the spec.

- [ ] **Step 1: Review the complete diff against the specification**

Run:

```bash
git diff --stat 7fb34c8..HEAD
git diff --check 7fb34c8..HEAD
```

Check every success criterion and Review Focus item, especially bounded queues, storage atomicity, ID-only merges, stale-preview rejection, and absence of prompt text in configuration messages.

- [ ] **Step 2: Run the final verification suite**

Run: `npm test && npm run validate`

Expected: zero failures and a successful Manifest V3 validation.

- [ ] **Step 3: Inspect repository state**

Run: `git status --short && git log --oneline 7fb34c8..HEAD`

Expected: only intentional commits and no uncommitted product changes.

- [ ] **Step 4: Use the finishing-development-branch workflow**

Offer local merge, push/PR, or keeping the feature branch. Do not delete work until the selected integration path succeeds and the merged result passes the full suite.
