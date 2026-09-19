(function initOptions() {
  'use strict';

  const SETTINGS_KEY = 'settings';
  const elements = {
    provider: document.querySelector('#provider'),
    freeNote: document.querySelector('#free-note'),
    modelFields: document.querySelector('#model-fields'),
    endpoint: document.querySelector('#endpoint'),
    apiKey: document.querySelector('#api-key'),
    model: document.querySelector('#model'),
    toggleKey: document.querySelector('#toggle-key'),
    save: document.querySelector('#save'),
    test: document.querySelector('#test'),
    status: document.querySelector('#status'),
  };

  let settings = MJConfig.normalizeConfig();
  let activeProvider = settings.provider;

  function setStatus(message, kind = '') {
    elements.status.textContent = message;
    elements.status.dataset.kind = kind;
  }

  function captureCurrentModel() {
    if (!['qwen', 'deepseek'].includes(activeProvider)) return;
    settings.providers[activeProvider] = {
      endpoint: elements.endpoint.value.trim(),
      apiKey: elements.apiKey.value,
      model: elements.model.value.trim(),
    };
  }

  function renderProvider(provider) {
    const isModel = provider !== 'free';
    elements.freeNote.hidden = isModel;
    elements.modelFields.hidden = !isModel;
    if (isModel) {
      const config = settings.providers[provider] || MJConfig.providerPreset(provider);
      elements.endpoint.value = config.endpoint;
      elements.apiKey.value = config.apiKey;
      elements.model.value = config.model;
    }
    activeProvider = provider;
  }

  function collectSettings() {
    captureCurrentModel();
    settings.provider = elements.provider.value;
    return MJConfig.normalizeConfig(settings);
  }

  function validateSelected(config) {
    if (config.provider === 'free') return;
    const selected = config.providers[config.provider];
    if (!selected.endpoint || !selected.apiKey || !selected.model) {
      throw new Error('请填写 API 地址、API Key 和模型名称');
    }
    MJConfig.endpointOrigin(selected.endpoint);
  }

  async function ensurePermission(config) {
    if (config.provider === 'free') return;
    const endpoint = config.providers[config.provider].endpoint;
    const granted = await MJConfig.requestEndpointPermission(chrome.permissions, endpoint);
    if (!granted) throw new Error('未授权访问该 API 地址');
  }

  async function saveSettings() {
    const config = collectSettings();
    validateSelected(config);
    await ensurePermission(config);
    await chrome.storage.local.set({ [SETTINGS_KEY]: config });
    settings = config;
    setStatus('设置已保存', 'success');
  }

  async function testProvider() {
    const config = collectSettings();
    validateSelected(config);
    await ensurePermission(config);
    const response = await chrome.runtime.sendMessage({
      type: 'test-provider',
      text: '一座在云海中的宫殿',
      config,
    });
    if (!response?.ok) throw new Error(response?.message || '测试连接失败');
    setStatus(`连接成功：${response.text}`, 'success');
  }

  async function withBusy(button, operation, busyText) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = busyText;
    setStatus('');
    try {
      await operation();
    } catch (error) {
      setStatus(error?.message || '操作失败，请重试', 'error');
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  elements.provider.addEventListener('change', () => {
    captureCurrentModel();
    renderProvider(elements.provider.value);
    setStatus('');
  });

  elements.toggleKey.addEventListener('click', () => {
    const revealing = elements.apiKey.type === 'password';
    elements.apiKey.type = revealing ? 'text' : 'password';
    elements.toggleKey.textContent = revealing ? '隐藏' : '显示';
    elements.toggleKey.setAttribute('aria-pressed', String(revealing));
  });

  elements.save.addEventListener('click', () => withBusy(elements.save, saveSettings, '保存中…'));
  elements.test.addEventListener('click', () => withBusy(elements.test, testProvider, '测试中…'));

  chrome.storage.local.get(SETTINGS_KEY)
    .then((stored) => {
      settings = MJConfig.normalizeConfig(stored[SETTINGS_KEY]);
      elements.provider.value = settings.provider;
      renderProvider(settings.provider);
    })
    .catch(() => setStatus('无法读取本地设置', 'error'));
}());
