(function initPromptCore(globalScope) {
  'use strict';

  const ASPECT_RATIO_OPTIONS = Object.freeze([
    '1:2', '6:11', '9:16', '2:3', '3:4', '4:5', '5:6', '1:1',
    '6:5', '5:4', '4:3', '3:2', '16:9', '11:6', '2:1',
  ]);

  function splitPromptAndParams(input) {
    const value = typeof input === 'string' ? input.trim() : '';
    if (!value) return { text: '', params: '' };

    const match = /(?:^|\s)--[a-z][\w-]*(?=\s|$)/i.exec(value);
    if (!match) return { text: value, params: '' };
    const tokenOffset = match[0].indexOf('--');
    const parameterStart = match.index + tokenOffset;
    return {
      text: value.slice(0, parameterStart).trim(),
      params: value.slice(parameterStart).trim(),
    };
  }

  function hasParameter(parameters, aliases) {
    const names = aliases.join('|');
    return new RegExp(`(?:^|\\s)--(?:${names})(?=\\s|$)`, 'i').test(parameters);
  }

  function composePrompt(translation, preservedParams, controls) {
    const translated = typeof translation === 'string' ? translation.trim() : '';
    const preserved = typeof preservedParams === 'string' ? preservedParams.trim() : '';
    const values = controls && typeof controls === 'object' ? controls : {};
    const additions = [];

    if (values.aspectRatio && !hasParameter(preserved, ['ar', 'aspect'])) {
      additions.push(`--ar ${String(values.aspectRatio).trim()}`);
    }
    if (values.stylize !== '' && values.stylize != null && !hasParameter(preserved, ['stylize', 's'])) {
      additions.push(`--stylize ${Number(values.stylize)}`);
    }
    if (values.chaos !== '' && values.chaos != null && !hasParameter(preserved, ['chaos', 'c'])) {
      additions.push(`--chaos ${Number(values.chaos)}`);
    }
    const quality = values.quality == null ? '' : String(values.quality);
    if (['1', '2', '4'].includes(quality) && !hasParameter(preserved, ['quality', 'q'])) {
      additions.push(`--quality ${quality}`);
    }
    if (values.hd === true && !hasParameter(preserved, ['hd'])) {
      additions.push('--hd');
    }

    return [translated, preserved, ...additions].filter(Boolean).join(' ').trim();
  }

  function splitUtf8(input, maxBytes) {
    if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
      throw new RangeError('maxBytes must be a positive integer');
    }
    const text = typeof input === 'string' ? input : '';
    if (!text) return [];

    const characters = Array.from(text);
    const encoder = new TextEncoder();
    const chunks = [];
    const preferredBreak = /[\n。！？；，,;\s]/u;
    let start = 0;

    while (start < characters.length) {
      let byteCount = 0;
      let index = start;
      let lastBreak = -1;

      while (index < characters.length) {
        const characterBytes = encoder.encode(characters[index]).length;
        if (characterBytes > maxBytes) {
          throw new RangeError('maxBytes is smaller than a single Unicode character');
        }
        if (byteCount + characterBytes > maxBytes) break;
        byteCount += characterBytes;
        index += 1;
        if (preferredBreak.test(characters[index - 1])) lastBreak = index;
      }

      if (index === characters.length) {
        chunks.push(characters.slice(start).join(''));
        break;
      }

      const end = lastBreak > start ? lastBreak : index;
      chunks.push(characters.slice(start, end).join(''));
      start = end;
    }

    return chunks;
  }

  function splitPromptParagraphs(input) {
    const text = typeof input === 'string' ? input.trim() : '';
    if (!text) return [];
    return text
      .split(/\r?\n[\t ]*\r?\n+/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
  }

  function buildBilingualResult(paragraphs, translations) {
    if (!Array.isArray(paragraphs) || !Array.isArray(translations) || paragraphs.length !== translations.length) {
      throw new RangeError('Each source paragraph requires one translation');
    }
    const pairs = paragraphs.map((paragraph, index) => ({
      source: String(paragraph).trim(),
      translation: String(translations[index]).trim(),
    }));
    return {
      preview: pairs.map(({ source, translation }) => `${source}\n${translation}`).join('\n\n'),
      english: pairs.map(({ translation }) => translation).join('\n\n'),
    };
  }

  const api = Object.freeze({
    ASPECT_RATIO_OPTIONS,
    splitPromptAndParams,
    composePrompt,
    splitUtf8,
    splitPromptParagraphs,
    buildBilingualResult,
  });
  globalScope.MJPromptCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : self));
