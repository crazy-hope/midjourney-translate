(function initPageTranslator(globalScope) {
  'use strict';

  const SKIPPED_TAGS = new Set([
    'INPUT', 'TEXTAREA', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'SVG', 'OPTION',
  ]);

  function normalizeSource(value) {
    const shared = globalScope.MJPageTranslationCache?.normalizeSource;
    return typeof shared === 'function'
      ? shared(value)
      : String(value || '').trim().replace(/\s+/g, ' ');
  }

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

  function isVisibleElement(element, getComputedStyle = null) {
    if (!element) return false;
    for (let current = element; current; current = current.parentElement) {
      if (current.hidden || current.getAttribute?.('aria-hidden') === 'true') return false;
      const style = getComputedStyle?.(current);
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    }
    return true;
  }

  function restoreOwnedRecord(record) {
    const { node, originalText, translationNode } = record || {};
    if (!node?.isConnected || ![originalText, ''].includes(node.nodeValue)) return false;
    node.nodeValue = originalText;
    translationNode?.remove?.();
    record.translationNode = null;
    return true;
  }

  function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
  }

  function createController(options = {}) {
    const {
      adapter,
      cache,
      request,
      concurrency = 2,
      maxPending = 200,
      batchSize = 100,
      yieldControl = () => new Promise((resolve) => {
        if (typeof globalScope.requestAnimationFrame === 'function') {
          globalScope.requestAnimationFrame(() => resolve());
        } else setTimeout(resolve, 0);
      }),
      onProgress = () => {},
      onError = () => {},
    } = options;
    if (!adapter || typeof adapter.discover !== 'function'
      || typeof adapter.observe !== 'function' || typeof adapter.unobserve !== 'function'
      || typeof adapter.render !== 'function' || typeof adapter.restore !== 'function'
      || !cache || typeof cache.get !== 'function' || typeof cache.put !== 'function'
      || typeof request !== 'function') {
      throw new TypeError('Page translation adapter, cache, and request function are required');
    }

    const workerCount = Math.max(1, Math.floor(Number(concurrency) || 2));
    const pendingLimit = Math.max(workerCount, Math.floor(Number(maxPending) || 200));
    const discoveryBatchSize = Math.max(1, Math.floor(Number(batchSize) || 100));
    let enabled = false;
    let keepOriginal = true;
    let provider = 'deepseek';
    let generation = 0;
    let haltedGeneration = -1;
    let errorGeneration = -1;
    let completed = 0;
    const records = new Set();
    const jobsByKey = new Map();
    const queuedJobs = [];
    const inflightJobs = new Set();
    const overflowRecords = new Set();

    function reportProgress() {
      onProgress({ completed, pending: jobsByKey.size });
    }

    function jobKey(providerName, text) {
      return `${providerName}\u0000${normalizeSource(text)}`;
    }

    function finishJob(job) {
      if (jobsByKey.get(job.key) === job) jobsByKey.delete(job.key);
      job.done.resolve();
      reportProgress();
    }

    function cancelWaitingJobs() {
      for (const job of queuedJobs.splice(0)) finishJob(job);
      for (const job of jobsByKey.values()) {
        if (!inflightJobs.has(job)) finishJob(job);
      }
      overflowRecords.clear();
    }

    function restoreAll() {
      for (const item of records) {
        adapter.unobserve(item);
        adapter.restore(item);
      }
      records.clear();
    }

    function reconsiderOverflow() {
      if (!enabled || haltedGeneration === generation) return;
      for (const item of [...overflowRecords]) {
        if (jobsByKey.size >= pendingLimit) break;
        overflowRecords.delete(item);
        enqueueVisible(item);
      }
    }

    async function runJob(job) {
      inflightJobs.add(job);
      try {
        const response = await request({
          text: job.text,
          provider: job.provider,
          purpose: 'page',
        });
        const chinese = response?.text;
        if (typeof chinese !== 'string' || !chinese.trim()) {
          throw new Error('页面翻译返回了空结果');
        }
        cache.put(job.provider, job.text, chinese);
        if (enabled && job.generation === generation && haltedGeneration !== generation) {
          for (const item of job.records) {
            adapter.render(item, chinese, keepOriginal);
            adapter.unobserve(item);
          }
          completed += 1;
        }
      } catch (error) {
        if (enabled && job.generation === generation) {
          haltedGeneration = generation;
          cancelWaitingJobs();
          if (errorGeneration !== generation) {
            errorGeneration = generation;
            onError(error);
          }
        }
      } finally {
        inflightJobs.delete(job);
        finishJob(job);
        if (enabled && haltedGeneration !== generation) {
          reconsiderOverflow();
          pump();
        }
      }
    }

    function pump() {
      if (!enabled || haltedGeneration === generation) return;
      while (inflightJobs.size < workerCount && queuedJobs.length) {
        const job = queuedJobs.shift();
        if (job.generation !== generation || jobsByKey.get(job.key) !== job) {
          finishJob(job);
        } else {
          runJob(job);
        }
      }
    }

    function enqueueVisible(item) {
      if (!enabled || haltedGeneration === generation || !records.has(item)) {
        return Promise.resolve();
      }
      const currentProvider = provider;
      const normalized = normalizeSource(item.text);
      const cached = cache.get(currentProvider, normalized);
      if (cached) {
        adapter.render(item, cached, keepOriginal);
        adapter.unobserve(item);
        completed += 1;
        reportProgress();
        return Promise.resolve();
      }
      const key = jobKey(currentProvider, normalized);
      const existing = jobsByKey.get(key);
      if (existing) {
        existing.records.add(item);
        return existing.done.promise;
      }
      if (jobsByKey.size >= pendingLimit) {
        overflowRecords.add(item);
        reportProgress();
        return Promise.resolve();
      }
      const job = {
        key,
        text: normalized,
        provider: currentProvider,
        generation,
        records: new Set([item]),
        done: deferred(),
      };
      jobsByKey.set(key, job);
      queuedJobs.push(job);
      reportProgress();
      pump();
      return job.done.promise;
    }

    async function register(root) {
      if (!enabled || !root) return;
      const registerGeneration = generation;
      await adapter.discover(root, {
        batchSize: discoveryBatchSize,
        yieldControl,
        onRecord(item) {
          if (!enabled || registerGeneration !== generation
            || !item || !isTranslationCandidate(item.text) || records.has(item)) return;
          records.add(item);
          adapter.observe(item, enqueueVisible);
        },
      });
    }

    function enable(next = {}) {
      if (enabled) {
        cancelWaitingJobs();
        restoreAll();
      }
      generation += 1;
      enabled = true;
      provider = next.provider || provider;
      keepOriginal = next.keepOriginal !== false;
      haltedGeneration = -1;
      errorGeneration = -1;
      completed = 0;
      reportProgress();
    }

    function disable() {
      generation += 1;
      enabled = false;
      cancelWaitingJobs();
      restoreAll();
      reportProgress();
    }

    function setKeepOriginal(value) {
      keepOriginal = value !== false;
      for (const item of records) adapter.setKeepOriginal?.(item, keepOriginal);
    }

    function setProvider(value) {
      if (!value || value === provider) return;
      generation += 1;
      cancelWaitingJobs();
      restoreAll();
      provider = value;
      haltedGeneration = -1;
      errorGeneration = -1;
      completed = 0;
      reportProgress();
    }

    function snapshot() {
      return Object.freeze({
        enabled,
        keepOriginal,
        provider,
        recordCount: records.size,
        pending: jobsByKey.size,
        active: inflightJobs.size,
        generation,
      });
    }

    function flushCache() {
      return typeof cache.flush === 'function' ? cache.flush() : Promise.resolve();
    }

    return Object.freeze({
      enable,
      disable,
      register,
      setKeepOriginal,
      setProvider,
      snapshot,
      flushCache,
    });
  }

  function createBrowserAdapter(documentObject, panelId = 'mjpt-panel') {
    if (!documentObject || typeof documentObject.createTreeWalker !== 'function') {
      throw new TypeError('Document is required');
    }
    const ownedByNode = new WeakMap();
    const observedByElement = new Map();
    const fallbackRecords = new Map();
    const view = documentObject.defaultView || globalScope;
    const nodeFilter = view.NodeFilter || globalScope.NodeFilter;
    const getStyle = view.getComputedStyle?.bind(view);

    function visible(element) {
      return isVisibleElement(element, getStyle);
    }

    function recordFor(node) {
      const existing = ownedByNode.get(node);
      if (existing) return existing;
      const originalText = node.nodeValue || '';
      const item = { node, originalText, text: originalText.trim(), translationNode: null };
      ownedByNode.set(node, item);
      return item;
    }

    function acceptNode(node, onRecord) {
      if (isTranslationCandidate(node.nodeValue)
        && !shouldSkipElement(node.parentElement, panelId) && visible(node.parentElement)) {
        onRecord(recordFor(node));
      }
    }

    async function discover(root, options = {}) {
      if (!root) return;
      const batchSize = Math.max(1, Number(options.batchSize) || 100);
      const yieldControl = options.yieldControl || (() => Promise.resolve());
      const onRecord = options.onRecord || (() => {});
      if (root.nodeType === 3) {
        acceptNode(root, onRecord);
        return;
      }
      const walker = documentObject.createTreeWalker(root, nodeFilter?.SHOW_TEXT || 4);
      let visited = 0;
      let node = walker.nextNode();
      while (node) {
        visited += 1;
        acceptNode(node, onRecord);
        if (visited % batchSize === 0) await yieldControl();
        node = walker.nextNode();
      }
    }

    let observer = null;
    if (typeof view.IntersectionObserver === 'function') {
      observer = new view.IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          for (const { item, callback } of observedByElement.get(entry.target) || []) callback(item);
        }
      }, { root: null, rootMargin: '300px 0px', threshold: 0 });
    }

    function isNearViewport(item) {
      const rect = item.node?.parentElement?.getBoundingClientRect?.();
      const height = Number(view.innerHeight) || 0;
      return Boolean(rect && rect.bottom >= -300 && rect.top <= height + 300);
    }

    function checkFallback() {
      for (const [item, callback] of fallbackRecords) {
        if (isNearViewport(item)) callback(item);
      }
    }

    if (!observer) {
      view.addEventListener?.('scroll', checkFallback, { passive: true });
      view.addEventListener?.('resize', checkFallback);
    }

    function observe(item, callback) {
      const element = item.node?.parentElement;
      if (!element) return;
      if (!observer) {
        fallbackRecords.set(item, callback);
        checkFallback();
        return;
      }
      let entries = observedByElement.get(element);
      if (!entries) {
        entries = new Set();
        observedByElement.set(element, entries);
        observer.observe(element);
      }
      entries.add({ item, callback });
    }

    function unobserve(item) {
      fallbackRecords.delete(item);
      const element = item.node?.parentElement;
      const entries = observedByElement.get(element);
      if (!entries) return;
      for (const entry of entries) {
        if (entry.item === item) entries.delete(entry);
      }
      if (!entries.size) {
        observedByElement.delete(element);
        observer?.unobserve(element);
      }
    }

    function applyMode(item, retainOriginal) {
      if (!item.translationNode) return;
      item.translationNode.className = retainOriginal
        ? 'mjpt-page-translation'
        : 'mjpt-page-translation mjpt-page-translation--only';
      if (retainOriginal) {
        if (item.node.nodeValue === '') item.node.nodeValue = item.originalText;
      } else if (item.node.nodeValue === item.originalText) {
        item.node.nodeValue = '';
      }
    }

    function render(item, chinese, retainOriginal) {
      if (!item.node?.isConnected) return;
      if (!item.translationNode?.isConnected) {
        const span = documentObject.createElement('span');
        span.dataset.mjptPageTranslation = 'true';
        span.setAttribute('aria-hidden', 'true');
        span.textContent = chinese;
        span.style.pointerEvents = 'none';
        item.node.parentNode?.insertBefore(span, item.node.nextSibling);
        item.translationNode = span;
      } else item.translationNode.textContent = chinese;
      applyMode(item, retainOriginal);
    }

    function setKeepOriginal(item, value) {
      applyMode(item, value);
    }

    function restore(item) {
      unobserve(item);
      const restored = restoreOwnedRecord(item);
      if (restored) ownedByNode.delete(item.node);
      return restored;
    }

    return Object.freeze({ discover, observe, unobserve, render, setKeepOriginal, restore });
  }

  const api = Object.freeze({
    isTranslationCandidate,
    shouldSkipElement,
    isVisibleElement,
    restoreOwnedRecord,
    createController,
    createBrowserAdapter,
  });
  globalScope.MJPageTranslator = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : self));
