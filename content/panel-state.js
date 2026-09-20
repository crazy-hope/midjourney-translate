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

  function formatPromptOption(record) {
    const date = typeof record?.date === 'string'
      ? record.date.slice(0, 16).replace('T', ' ')
      : '';
    return date ? `${record.title} · ${date}` : String(record?.title || '');
  }

  function promptSearchValue(record) {
    return String(record?.title || '');
  }

  function filterPromptRecords(records, query) {
    const needle = String(query || '').trim().toLocaleLowerCase();
    const values = Array.isArray(records) ? records : [];
    if (!needle) return values.slice();
    return values.filter((record) => String(record?.title || '').toLocaleLowerCase().includes(needle));
  }

  function canUpdateSelectedPrompt(selectedId, preview) {
    return Boolean(String(selectedId || '').trim()) && isPreviewFresh(preview);
  }

  function coalesceRoots(roots) {
    const unique = [...new Set(Array.isArray(roots) ? roots.filter(Boolean) : [])];
    return unique.filter((candidate) => !unique.some((ancestor) => (
      ancestor !== candidate && typeof ancestor.contains === 'function' && ancestor.contains(candidate)
    )));
  }

  function shouldPreventPanelSubmit(event) {
    return event?.key === 'Enter' && String(event?.target?.tagName || '').toUpperCase() === 'INPUT';
  }

  function shouldStopPanelKeydown(event) {
    return event?.key === 'Enter';
  }

  const api = Object.freeze({
    markPreviewStale,
    setPreviewResult,
    isPreviewFresh,
    syncInstructionAvailability,
    formatPromptOption,
    promptSearchValue,
    filterPromptRecords,
    canUpdateSelectedPrompt,
    coalesceRoots,
    shouldPreventPanelSubmit,
    shouldStopPanelKeydown,
  });
  globalScope.MJPanelState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : self));
