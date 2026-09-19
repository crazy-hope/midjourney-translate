(function initTranslationService(globalScope) {
  'use strict';

  const config = globalScope.MJConfig
    || (typeof require === 'function' ? require('./config.js') : null);
  const translator = globalScope.MJTranslatorCore
    || (typeof require === 'function' ? require('./translator-core.js') : null);

  function resolveSettings(storedSettings, message = {}) {
    const source = message.config || storedSettings;
    return config.normalizeConfig({
      ...source,
      provider: message.provider || source?.provider,
    });
  }

  async function run(message, storedSettings, fetchImpl = fetch, options = {}) {
    const settings = resolveSettings(storedSettings, message);
    const provider = settings.provider;
    const purpose = message.purpose === 'page' ? 'page' : 'prompt';
    const text = provider === 'free'
      ? await translator.translateFree(message.text, fetchImpl, {
        signal: options.signal,
        direction: purpose,
      })
      : await translator.translateOpenAI(
        message.text,
        settings.providers[provider],
        fetchImpl,
        {
          signal: options.signal,
          purpose,
          instruction: purpose === 'prompt'
            ? message.instruction ?? settings.translationInstruction
            : '',
        },
      );
    return { text, provider };
  }

  const api = Object.freeze({ resolveSettings, run });
  globalScope.MJTranslationService = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : self));
