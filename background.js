importScripts(
  'shared/config.js',
  'shared/prompt-core.js',
  'shared/translator-core.js',
  'shared/translation-service.js',
);

const SETTINGS_KEY = 'settings';
const REQUEST_TIMEOUT_MS = 30_000;

async function readSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return MJConfig.normalizeConfig(stored[SETTINGS_KEY]);
}

async function runTranslation(message, settings) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await MJTranslationService.run(message, settings, fetch, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function translateMessage(message) {
  const settings = await readSettings();
  const result = await runTranslation(message, settings);
  return { ok: true, text: result.text, provider: result.provider };
}

async function openMidjourney() {
  const tabs = await chrome.tabs.query({
    url: ['https://midjourney.com/*', 'https://www.midjourney.com/*'],
  });
  const target = tabs.sort((left, right) => (right.lastAccessed || 0) - (left.lastAccessed || 0))[0];
  if (target?.id != null) {
    await chrome.tabs.update(target.id, { active: true });
    if (target.windowId != null) await chrome.windows.update(target.windowId, { focused: true });
    return { ok: true, tabId: target.id, created: false };
  }
  const created = await chrome.tabs.create({ url: 'https://www.midjourney.com/imagine', active: true });
  return { ok: true, tabId: created.id, created: true };
}

async function getUiSettings() {
  const settings = await readSettings();
  return {
    ok: true,
    provider: settings.provider,
    translationInstruction: settings.translationInstruction,
    params: settings.params,
  };
}

async function saveParams(params) {
  const settings = await readSettings();
  const normalized = MJConfig.normalizeConfig({ ...settings, params });
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalized });
  return { ok: true, params: normalized.params };
}

async function saveUiSettings(provider, translationInstruction, params) {
  const settings = await readSettings();
  const normalized = MJConfig.normalizeConfig({
    ...settings, provider, translationInstruction, params,
  });
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalized });
  return { ok: true, provider: normalized.provider, params: normalized.params };
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  if (!stored[SETTINGS_KEY]) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: MJConfig.normalizeConfig() });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || ![
    'translate',
    'test-provider',
    'open-midjourney',
    'get-ui-settings',
    'save-params',
    'save-ui-settings',
    'open-options',
  ].includes(message.type)) {
    return false;
  }

  let operation;
  if (message.type === 'open-midjourney') operation = openMidjourney();
  else if (message.type === 'get-ui-settings') operation = getUiSettings();
  else if (message.type === 'save-params') operation = saveParams(message.params);
  else if (message.type === 'save-ui-settings') {
    operation = saveUiSettings(message.provider, message.translationInstruction, message.params);
  }
  else if (message.type === 'open-options') {
    operation = chrome.runtime.openOptionsPage().then(() => ({ ok: true }));
  } else operation = translateMessage(message);

  operation
    .then(sendResponse)
    .catch((error) => {
      const safeError = MJTranslatorCore.normalizeThrownError(error);
      sendResponse({ ok: false, code: safeError.code, message: safeError.message });
    });
  return true;
});
