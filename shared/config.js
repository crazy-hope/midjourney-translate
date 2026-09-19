(function initConfig(globalScope) {
  'use strict';

  const PROVIDERS = Object.freeze(['free', 'qwen', 'deepseek']);
  const QUALITY_VALUES = Object.freeze(['', '1', '2', '4']);
  const PRESETS = Object.freeze({
    qwen: Object.freeze({
      endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      apiKey: '',
      model: 'qwen-plus',
    }),
    deepseek: Object.freeze({
      endpoint: 'https://api.deepseek.com/chat/completions',
      apiKey: '',
      model: 'deepseek-flash',
    }),
  });

  const DEFAULTS = Object.freeze({
    provider: 'deepseek',
    providers: PRESETS,
    params: Object.freeze({
      aspectRatio: '16:9',
      stylize: 450,
      chaos: 8,
      quality: '',
      hd: false,
    }),
  });

  function clampNumber(value, fallback, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.round(number)));
  }

  function normalizeProviderConfig(value, preset) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      endpoint: typeof source.endpoint === 'string' && source.endpoint.trim()
        ? source.endpoint.trim()
        : preset.endpoint,
      apiKey: typeof source.apiKey === 'string' ? source.apiKey : '',
      model: typeof source.model === 'string' && source.model.trim()
        ? source.model.trim()
        : preset.model,
    };
  }

  function normalizeConfig(value) {
    const source = value && typeof value === 'object' ? value : {};
    const provider = PROVIDERS.includes(source.provider) ? source.provider : DEFAULTS.provider;
    const sourceParams = source.params && typeof source.params === 'object' ? source.params : {};
    const aspectRatio = typeof sourceParams.aspectRatio === 'string'
      && /^[1-9]\d*:[1-9]\d*$/.test(sourceParams.aspectRatio.trim())
      ? sourceParams.aspectRatio.trim()
      : DEFAULTS.params.aspectRatio;
    const qualityCandidate = sourceParams.quality == null ? '' : String(sourceParams.quality);

    return {
      provider,
      providers: {
        qwen: normalizeProviderConfig(source.providers?.qwen, PRESETS.qwen),
        deepseek: normalizeProviderConfig(source.providers?.deepseek, PRESETS.deepseek),
      },
      params: {
        aspectRatio,
        stylize: clampNumber(sourceParams.stylize, DEFAULTS.params.stylize, 0, 1000),
        chaos: clampNumber(sourceParams.chaos, DEFAULTS.params.chaos, 0, 100),
        quality: QUALITY_VALUES.includes(qualityCandidate) ? qualityCandidate : '',
        hd: sourceParams.hd === true,
      },
    };
  }

  function providerPreset(provider) {
    const preset = PRESETS[provider];
    if (!preset) throw new TypeError(`Unknown model provider: ${provider}`);
    return { ...preset };
  }

  function endpointOrigin(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new TypeError('请输入有效的 API 地址');
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new TypeError('API 地址必须使用 HTTP 或 HTTPS');
    }
    if (url.username || url.password) {
      throw new TypeError('API 地址不能包含用户名或密码');
    }
    return `${url.origin}/*`;
  }

  function requestEndpointPermission(permissionsApi, endpoint) {
    if (!permissionsApi || typeof permissionsApi.request !== 'function') {
      throw new TypeError('Chrome permissions API is unavailable');
    }
    return permissionsApi.request({ origins: [endpointOrigin(endpoint)] });
  }

  const api = Object.freeze({
    DEFAULTS,
    QUALITY_VALUES,
    normalizeConfig,
    providerPreset,
    endpointOrigin,
    requestEndpointPermission,
  });

  globalScope.MJConfig = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : self));
