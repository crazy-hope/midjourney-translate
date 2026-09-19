(function initDraftStore(globalScope) {
  'use strict';

  function clearPanelContent(input, preview) {
    input.value = '';
    preview.value = '';
    delete preview.dataset.english;
    delete preview.dataset.stale;
  }

  async function savePanelConfig(runtime, provider, translationInstruction, params) {
    if (!runtime || typeof runtime.sendMessage !== 'function') {
      throw new TypeError('Chrome runtime is required');
    }
    const response = await runtime.sendMessage({
      type: 'save-ui-settings', provider, translationInstruction, params,
    });
    if (!response?.ok) throw new Error(response?.message || '配置保存失败');
  }

  const api = Object.freeze({ clearPanelContent, savePanelConfig });
  globalScope.MJDraftStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : self));
