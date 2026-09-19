(function initDomAdapter(globalScope) {
  'use strict';

  const SELECTOR = [
    'textarea',
    'input[type="text"]',
    '[contenteditable="true"]',
    '[role="textbox"]',
  ].join(',');

  function attribute(element, name) {
    return typeof element?.getAttribute === 'function' ? (element.getAttribute(name) || '') : '';
  }

  function isVisible(element) {
    if (!element || element.disabled) return false;
    if (typeof element.getBoundingClientRect !== 'function') return true;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function candidateScore(element) {
    if (!isVisible(element)) return -Infinity;
    if (typeof element.closest === 'function' && element.closest('#mjpt-panel')) return -Infinity;

    const type = attribute(element, 'type').toLowerCase();
    const description = [
      attribute(element, 'placeholder'),
      attribute(element, 'aria-label'),
      attribute(element, 'data-placeholder'),
      attribute(element, 'name'),
    ].join(' ').toLowerCase();

    if (type === 'search' || /\b(search|navigation|comment|message|email)\b/.test(description)) {
      return -Infinity;
    }

    let score = 0;
    if (element.tagName === 'TEXTAREA') score += 18;
    if (element.isContentEditable || attribute(element, 'contenteditable') === 'true') score += 14;
    if (attribute(element, 'role') === 'textbox') score += 8;
    if (/(imagine|prompt|describe|what will you|create)/.test(description)) score += 55;
    if (typeof element.closest === 'function' && element.closest('form')) score += 12;
    return score;
  }

  function findComposer(root = document) {
    if (!root || typeof root.querySelectorAll !== 'function') return null;
    const candidates = Array.from(root.querySelectorAll(SELECTOR));
    let best = null;
    let bestScore = 39;
    for (const candidate of candidates) {
      const score = candidateScore(candidate);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  }

  function eventFor(element, type, options = {}) {
    const view = element?.ownerDocument?.defaultView || globalScope;
    if (type === 'input' && typeof view.InputEvent === 'function') {
      return new view.InputEvent(type, { bubbles: true, composed: true, ...options });
    }
    const EventConstructor = view.Event || globalScope.Event;
    return new EventConstructor(type, { bubbles: true, composed: true });
  }

  function setNativeValue(element, value) {
    const view = element?.ownerDocument?.defaultView;
    const tagName = element?.tagName;
    const Constructor = tagName === 'TEXTAREA' ? view?.HTMLTextAreaElement : view?.HTMLInputElement;
    const descriptor = Constructor
      ? Object.getOwnPropertyDescriptor(Constructor.prototype, 'value')
      : null;
    if (descriptor?.set) descriptor.set.call(element, value);
    else element.value = value;
  }

  function setComposerValue(element, value) {
    if (!element) throw new TypeError('Composer element is required');
    const text = String(value ?? '');
    if (element.isContentEditable || attribute(element, 'contenteditable') === 'true') {
      element.textContent = text;
    } else {
      setNativeValue(element, text);
    }
    element.dispatchEvent(eventFor(element, 'input', {
      inputType: 'insertText',
      data: text,
    }));
    element.dispatchEvent(eventFor(element, 'change'));
    if (typeof element.focus === 'function') element.focus({ preventScroll: true });
  }

  function mountKey(panel, composer) {
    return panel?.isConnected && composer?.isConnected ? 'keep' : 'replace';
  }

  function isWithinInteractionScope(composer, panel, target) {
    if (!target) return false;
    const contains = (root) => root === target
      || (typeof root?.contains === 'function' && root.contains(target));
    return contains(composer) || contains(panel);
  }

  function findPanelHost(composer) {
    if (!composer) return null;
    const form = typeof composer.closest === 'function' ? composer.closest('form') : null;
    return form || composer.parentElement || null;
  }

  function panelViewportPlacement(host) {
    if (!host || typeof host.getBoundingClientRect !== 'function') return null;
    const rect = host.getBoundingClientRect();
    return { left: rect.left, top: rect.bottom + 8, width: rect.width };
  }

  const api = Object.freeze({
    candidateScore,
    findComposer,
    setComposerValue,
    mountKey,
    isWithinInteractionScope,
    findPanelHost,
    panelViewportPlacement,
  });
  globalScope.MJDom = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : self));
