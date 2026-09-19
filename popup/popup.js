(function initPopup() {
  'use strict';

  const PROVIDER_LABELS = { free: '免费翻译', qwen: '千问', deepseek: 'DeepSeek' };
  const provider = document.querySelector('#provider');
  const openButton = document.querySelector('#open-mj');
  const settingsButton = document.querySelector('#open-settings');
  const status = document.querySelector('#status');

  chrome.storage.local.get('settings')
    .then((stored) => {
      const settings = MJConfig.normalizeConfig(stored.settings);
      provider.textContent = PROVIDER_LABELS[settings.provider];
    })
    .catch(() => {
      provider.textContent = '无法读取';
    });

  openButton.addEventListener('click', async () => {
    const original = openButton.firstElementChild.textContent;
    openButton.disabled = true;
    openButton.firstElementChild.textContent = '正在打开…';
    status.textContent = '';
    try {
      const response = await chrome.runtime.sendMessage({ type: 'open-midjourney' });
      if (!response?.ok) throw new Error(response?.message || '无法打开 Midjourney');
      window.close();
    } catch (error) {
      status.textContent = error?.message || '无法打开 Midjourney';
      openButton.disabled = false;
      openButton.firstElementChild.textContent = original;
    }
  });

  settingsButton.addEventListener('click', () => chrome.runtime.openOptionsPage());
}());
