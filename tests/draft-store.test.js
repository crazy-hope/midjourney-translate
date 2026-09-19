const test = require('node:test');
const assert = require('node:assert/strict');

let createDraftStore;
let savePanelState;
let clearPanelContent;
try {
  ({ createDraftStore, savePanelState, clearPanelContent } = require('../content/draft-store.js'));
} catch {
  createDraftStore = undefined;
  savePanelState = undefined;
  clearPanelContent = undefined;
}

test('temporarily clearing the panel preserves the saved draft for reload', async () => {
  assert.equal(typeof createDraftStore, 'function');
  assert.equal(typeof clearPanelContent, 'function');
  const values = {};
  const storage = {
    async get(key) { return { [key]: values[key] }; },
    async set(update) { Object.assign(values, update); },
  };
  const firstPage = createDraftStore(storage);
  await firstPage.save('云海中的宫殿');

  const input = { value: '云海中的宫殿' };
  const preview = { value: 'A palace in a sea of clouds', dataset: { english: 'A palace in a sea of clouds' } };
  clearPanelContent(input, preview);

  assert.equal(input.value, '');
  assert.equal(preview.value, '');
  assert.equal('english' in preview.dataset, false);
  const nextPage = createDraftStore(storage);
  assert.equal(await nextPage.load(), '云海中的宫殿');
});

test('manual save persists the Chinese prompt, selected provider, and every current parameter', async () => {
  assert.equal(typeof savePanelState, 'function');
  const saved = [];
  const draftStore = { async save(prompt) { saved.push({ prompt }); } };
  const runtime = {
    async sendMessage(message) {
      saved.push(message);
      return { ok: true };
    },
  };
  const params = { aspectRatio: '3:2', stylize: 600, chaos: 12, quality: '2', hd: true };

  await savePanelState(draftStore, runtime, '云海中的宫殿', 'qwen', params);

  assert.deepEqual(saved, [
    { prompt: '云海中的宫殿' },
    { type: 'save-ui-settings', provider: 'qwen', params },
  ]);
});
