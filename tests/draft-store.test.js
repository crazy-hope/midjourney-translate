const test = require('node:test');
const assert = require('node:assert/strict');

let savePanelConfig;
let clearPanelContent;
try {
  ({ savePanelConfig, clearPanelContent } = require('../content/draft-store.js'));
} catch {
  savePanelConfig = undefined;
  clearPanelContent = undefined;
}

test('clear removes only current editor state', () => {
  assert.equal(typeof clearPanelContent, 'function');
  const input = { value: '云海宫殿' };
  const preview = { value: '云海宫殿\nCloud palace', dataset: { english: 'Cloud palace' } };
  clearPanelContent(input, preview);
  assert.equal(input.value, '');
  assert.equal(preview.value, '');
  assert.deepEqual(preview.dataset, {});
});

test('configuration save never persists prompt text', async () => {
  assert.equal(typeof savePanelConfig, 'function');
  const saved = [];
  const runtime = {
    async sendMessage(message) {
      saved.push(message);
      return { ok: true };
    },
  };
  const params = { aspectRatio: '3:2', stylize: 600, chaos: 12, quality: '2', hd: true };

  await savePanelConfig(runtime, 'qwen', '强调电影镜头', params);

  assert.deepEqual(saved, [
    {
      type: 'save-ui-settings',
      provider: 'qwen',
      translationInstruction: '强调电影镜头',
      params,
    },
  ]);
  assert.equal(JSON.stringify(saved).includes('云海中的宫殿'), false);
});
