(function initExtensionContext(globalScope) {
  'use strict';

  const INVALIDATED_RESPONSE = Object.freeze({
    ok: false,
    code: 'EXTENSION_CONTEXT_INVALIDATED',
    message: '扩展已更新，请刷新 Midjourney 页面',
  });

  function isInvalidatedError(error) {
    return /extension context invalidated/i.test(String(error?.message || error || ''));
  }

  function createGuard(runtime, onInvalidated = () => {}) {
    if (!runtime || typeof runtime.sendMessage !== 'function') {
      throw new TypeError('Chrome runtime is required');
    }
    let invalidated = false;
    let notified = false;

    function invalidate() {
      invalidated = true;
      if (notified) return;
      notified = true;
      onInvalidated();
    }

    async function sendMessage(message) {
      if (invalidated) return INVALIDATED_RESPONSE;
      try {
        if (!runtime.id) {
          invalidate();
          return INVALIDATED_RESPONSE;
        }
        return await runtime.sendMessage(message);
      } catch (error) {
        if (!isInvalidatedError(error)) throw error;
        invalidate();
        return INVALIDATED_RESPONSE;
      }
    }

    return Object.freeze({ sendMessage });
  }

  const api = Object.freeze({ INVALIDATED_RESPONSE, isInvalidatedError, createGuard });
  globalScope.MJExtensionContext = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : self));
