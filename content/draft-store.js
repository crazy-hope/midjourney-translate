(function initDraftStore(globalScope) {
  'use strict';

  const DEFAULT_KEY = 'mjptPromptDraft';

  function createDraftStore(storageArea, key = DEFAULT_KEY) {
    if (!storageArea || typeof storageArea.get !== 'function'
      || typeof storageArea.set !== 'function') {
      throw new TypeError('Chrome storage area is required');
    }
    return Object.freeze({
      async load() {
        const stored = await storageArea.get(key);
        return typeof stored?.[key] === 'string' ? stored[key] : '';
      },
      async save(value) {
        await storageArea.set({ [key]: String(value ?? '') });
      },
    });
  }

  function clearPanelContent(input, preview) {
    input.value = '';
    preview.value = '';
    delete preview.dataset.english;
  }

  async function savePanelState(draftStore, runtime, prompt, provider, params) {
    if (!draftStore || typeof draftStore.save !== 'function'
      || !runtime || typeof runtime.sendMessage !== 'function') {
      throw new TypeError('Draft store and Chrome runtime are required');
    }
    const [, response] = await Promise.all([
      draftStore.save(prompt),
      runtime.sendMessage({ type: 'save-ui-settings', provider, params }),
    ]);
    if (!response?.ok) throw new Error(response?.message || '参数保存失败');
  }

  const api = Object.freeze({ DEFAULT_KEY, createDraftStore, clearPanelContent, savePanelState });
  globalScope.MJDraftStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : self));
