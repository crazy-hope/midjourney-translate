(function initPageTranslationCache(globalScope) {
  'use strict';

  const DEFAULT_KEY = 'mjptPageTranslationCacheV1';
  const DEFAULT_MAX_ENTRIES = 1000;

  function normalizeSource(text) {
    return String(text || '').trim().replace(/\s+/g, ' ');
  }

  function cacheKey(provider, source) {
    return `${provider}\u0000${normalizeSource(source)}`;
  }

  function createPageTranslationCache(storageArea, options = {}) {
    if (!storageArea || typeof storageArea.get !== 'function'
      || typeof storageArea.set !== 'function') {
      throw new TypeError('Chrome storage area is required');
    }
    const key = options.key || DEFAULT_KEY;
    const maxEntries = Math.max(1, Math.floor(Number(options.maxEntries) || DEFAULT_MAX_ENTRIES));
    const now = options.now || Date.now;
    const entries = new Map();
    let writeChain = Promise.resolve();

    function timestamp() {
      const value = Number(now());
      return Number.isFinite(value) ? value : Date.now();
    }

    function trimToLimit() {
      if (entries.size <= maxEntries) return;
      const oldest = [...entries.values()]
        .sort((left, right) => left.lastUsed - right.lastUsed)
        .slice(0, entries.size - maxEntries);
      for (const entry of oldest) entries.delete(entry.key);
    }

    async function load() {
      entries.clear();
      let stored;
      try {
        stored = await storageArea.get(key);
      } catch {
        return;
      }
      if (!Array.isArray(stored?.[key])) return;
      for (const value of stored[key]) {
        const provider = typeof value?.provider === 'string' ? value.provider.trim() : '';
        const source = normalizeSource(value?.source);
        const translated = typeof value?.translated === 'string' ? value.translated.trim() : '';
        const lastUsed = Number(value?.lastUsed);
        if (!provider || !source || !translated || !Number.isFinite(lastUsed)) continue;
        const entryKey = cacheKey(provider, source);
        entries.set(entryKey, { key: entryKey, provider, source, translated, lastUsed });
      }
      trimToLimit();
    }

    function get(provider, source) {
      const entry = entries.get(cacheKey(provider, source));
      if (!entry) return undefined;
      entry.lastUsed = timestamp();
      return entry.translated;
    }

    function put(provider, source, translated) {
      const normalizedProvider = String(provider || '').trim();
      const normalizedSource = normalizeSource(source);
      const normalizedTranslation = typeof translated === 'string' ? translated.trim() : '';
      if (!normalizedProvider || !normalizedSource) throw new TypeError('缓存来源不能为空');
      if (!normalizedTranslation) throw new TypeError('缓存翻译不能为空');
      const entryKey = cacheKey(normalizedProvider, normalizedSource);
      entries.set(entryKey, {
        key: entryKey,
        provider: normalizedProvider,
        source: normalizedSource,
        translated: normalizedTranslation,
        lastUsed: timestamp(),
      });
      trimToLimit();
    }

    function flush() {
      trimToLimit();
      const snapshot = [...entries.values()].map((entry) => ({ ...entry }));
      const operation = writeChain.catch(() => {}).then(() => storageArea.set({ [key]: snapshot }));
      writeChain = operation;
      return operation;
    }

    function snapshot() {
      return Object.freeze({ size: entries.size, maxEntries });
    }

    return Object.freeze({ load, get, put, flush, snapshot });
  }

  const api = Object.freeze({
    DEFAULT_KEY,
    DEFAULT_MAX_ENTRIES,
    normalizeSource,
    cacheKey,
    createPageTranslationCache,
  });
  globalScope.MJPageTranslationCache = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : self));
