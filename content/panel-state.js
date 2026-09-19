(function initPanelState(globalScope) {
  'use strict';

  function markPreviewStale(preview) {
    if (preview?.dataset?.english) preview.dataset.stale = 'true';
  }

  function setPreviewResult(preview, bilingual, english, stale = false) {
    preview.value = bilingual;
    preview.dataset.english = english;
    if (stale) preview.dataset.stale = 'true';
    else delete preview.dataset.stale;
  }

  function isPreviewFresh(preview) {
    return Boolean(preview?.dataset?.english) && preview.dataset.stale !== 'true';
  }

  function syncInstructionAvailability(providerSelect, instructionInput, note) {
    const isFree = providerSelect.value === 'free';
    instructionInput.disabled = isFree;
    note.hidden = !isFree;
  }

  const api = Object.freeze({
    markPreviewStale,
    setPreviewResult,
    isPreviewFresh,
    syncInstructionAvailability,
  });
  globalScope.MJPanelState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : self));
