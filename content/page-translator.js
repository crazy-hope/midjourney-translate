(function initPageTranslator(globalScope) {
  'use strict';

  const SKIPPED_TAGS = new Set([
    'INPUT', 'TEXTAREA', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'SVG', 'OPTION',
  ]);

  function isTranslationCandidate(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text || /^--/.test(text) || /https?:\/\/|www\./i.test(text)) return false;
    if (/[\u3400-\u9fff]/u.test(text)) return false;
    const latinLetters = text.match(/[A-Za-z]/g) || [];
    if (latinLetters.length < 2) return false;
    if (/^[\d\s\p{P}\p{S}]+$/u.test(text)) return false;
    return true;
  }

  function shouldSkipElement(element, panelId = 'mjpt-panel') {
    for (let current = element; current; current = current.parentElement) {
      if (current.id === panelId || current.dataset?.mjptPageTranslation === 'true') return true;
      if (SKIPPED_TAGS.has(String(current.tagName || '').toUpperCase())) return true;
      if (current.isContentEditable === true
        || current.getAttribute?.('contenteditable') === 'true') return true;
    }
    return false;
  }

  function restoreOwnedRecord(record) {
    const { node, originalText, translationNode } = record || {};
    if (!node?.isConnected || ![originalText, ''].includes(node.nodeValue)) return false;
    node.nodeValue = originalText;
    translationNode?.remove?.();
    record.translationNode = null;
    return true;
  }

  function createController(options = {}) {
    const {
      adapter,
      request,
      concurrency = 2,
      onProgress = () => {},
      onError = () => {},
    } = options;
    if (!adapter || typeof adapter.collect !== 'function'
      || typeof adapter.render !== 'function' || typeof adapter.restore !== 'function'
      || typeof request !== 'function') {
      throw new TypeError('Page translation adapter and request function are required');
    }

    const workerCount = Math.max(1, Math.floor(Number(concurrency) || 2));
    let enabled = false;
    let keepOriginal = true;
    let provider = 'deepseek';
    let generation = 0;
    let errorGeneration = -1;
    const cache = new Map();
    const records = new Set();
    const pendingByKey = new Map();

    function keyFor(text) {
      return `${provider}\u0000${text}`;
    }

    function restoreAll() {
      for (const item of records) adapter.restore(item);
      records.clear();
    }

    async function scan(root) {
      if (!enabled) return;
      const scanGeneration = generation;
      const groups = new Map();
      for (const item of adapter.collect(root) || []) {
        if (!isTranslationCandidate(item.text)) continue;
        records.add(item);
        const key = keyFor(item.text);
        if (!groups.has(key)) groups.set(key, { key, text: item.text, records: [] });
        groups.get(key).records.push(item);
      }

      let completed = 0;
      const jobs = [...groups.values()];
      onProgress({ completed, pending: jobs.length });
      let cursor = 0;

      async function runJob(job) {
        if (!enabled || scanGeneration !== generation) return;
        let chinese = cache.get(job.key);
        if (!chinese) {
          let pending = pendingByKey.get(job.key);
          if (!pending) {
            pending = Promise.resolve(request({
              text: job.text,
              provider,
              purpose: 'page',
            }));
            pendingByKey.set(job.key, pending);
          }
          try {
            const response = await pending;
            chinese = response?.text;
            if (typeof chinese !== 'string' || !chinese.trim()) {
              throw new Error('页面翻译返回了空结果');
            }
            cache.set(job.key, chinese);
          } catch (error) {
            if (enabled && scanGeneration === generation && errorGeneration !== generation) {
              errorGeneration = generation;
              onError(error);
            }
            return;
          } finally {
            if (pendingByKey.get(job.key) === pending) pendingByKey.delete(job.key);
          }
        }
        if (!enabled || scanGeneration !== generation) return;
        for (const item of job.records) adapter.render(item, chinese, keepOriginal);
        completed += 1;
        onProgress({ completed, pending: Math.max(0, jobs.length - completed) });
      }

      async function worker() {
        while (cursor < jobs.length) {
          const job = jobs[cursor];
          cursor += 1;
          await runJob(job);
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(workerCount, jobs.length) }, () => worker()),
      );
    }

    function enable(next = {}) {
      generation += 1;
      enabled = true;
      provider = next.provider || provider;
      keepOriginal = next.keepOriginal !== false;
      errorGeneration = -1;
    }

    function disable() {
      generation += 1;
      enabled = false;
      pendingByKey.clear();
      restoreAll();
    }

    function setKeepOriginal(value) {
      keepOriginal = value !== false;
      for (const item of records) adapter.setKeepOriginal?.(item, keepOriginal);
    }

    function setProvider(value) {
      if (!value || value === provider) return;
      generation += 1;
      provider = value;
      pendingByKey.clear();
      restoreAll();
      errorGeneration = -1;
    }

    function snapshot() {
      return Object.freeze({
        enabled, keepOriginal, provider, recordCount: records.size, generation,
      });
    }

    return Object.freeze({ enable, disable, setKeepOriginal, setProvider, scan, snapshot });
  }

  function createBrowserAdapter(documentObject, panelId = 'mjpt-panel') {
    if (!documentObject || typeof documentObject.createTreeWalker !== 'function') {
      throw new TypeError('Document is required');
    }
    const ownedByNode = new WeakMap();
    const nodeFilter = documentObject.defaultView?.NodeFilter || globalScope.NodeFilter;

    function visible(element) {
      if (!element || element.hidden || element.getAttribute?.('aria-hidden') === 'true') return false;
      const style = documentObject.defaultView?.getComputedStyle?.(element);
      return !style || (style.display !== 'none' && style.visibility !== 'hidden');
    }

    function recordFor(node) {
      const existing = ownedByNode.get(node);
      if (existing) return existing;
      const originalText = node.nodeValue || '';
      const item = {
        node,
        originalText,
        text: originalText.trim(),
        translationNode: null,
      };
      ownedByNode.set(node, item);
      return item;
    }

    function collect(root) {
      const collected = [];
      if (!root) return collected;
      if (root.nodeType === 3) {
        if (!shouldSkipElement(root.parentElement, panelId)
          && visible(root.parentElement) && isTranslationCandidate(root.nodeValue)) {
          collected.push(recordFor(root));
        }
        return collected;
      }
      const showText = nodeFilter?.SHOW_TEXT || 4;
      const walker = documentObject.createTreeWalker(root, showText);
      let node = walker.nextNode();
      while (node) {
        if (!shouldSkipElement(node.parentElement, panelId)
          && visible(node.parentElement) && isTranslationCandidate(node.nodeValue)) {
          collected.push(recordFor(node));
        }
        node = walker.nextNode();
      }
      return collected;
    }

    function applyMode(item, keepOriginal) {
      if (!item.translationNode) return;
      item.translationNode.className = keepOriginal
        ? 'mjpt-page-translation'
        : 'mjpt-page-translation mjpt-page-translation--only';
      if (keepOriginal) {
        if (item.node.nodeValue === '') item.node.nodeValue = item.originalText;
      } else if (item.node.nodeValue === item.originalText) {
        item.node.nodeValue = '';
      }
    }

    function render(item, chinese, keepOriginal) {
      if (!item.node?.isConnected) return;
      if (!item.translationNode?.isConnected) {
        const span = documentObject.createElement('span');
        span.dataset.mjptPageTranslation = 'true';
        span.setAttribute('aria-hidden', 'true');
        span.textContent = chinese;
        span.style.pointerEvents = 'none';
        item.node.parentNode?.insertBefore(span, item.node.nextSibling);
        item.translationNode = span;
      } else {
        item.translationNode.textContent = chinese;
      }
      applyMode(item, keepOriginal);
    }

    function setKeepOriginal(item, value) {
      applyMode(item, value);
    }

    function restore(item) {
      const restored = restoreOwnedRecord(item);
      if (restored) ownedByNode.delete(item.node);
      return restored;
    }

    return Object.freeze({ collect, render, setKeepOriginal, restore });
  }

  const api = Object.freeze({
    isTranslationCandidate,
    shouldSkipElement,
    restoreOwnedRecord,
    createController,
    createBrowserAdapter,
  });
  globalScope.MJPageTranslator = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : self));
