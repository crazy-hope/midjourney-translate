(function initContentScript() {
  'use strict';

  const PANEL_ID = 'mjpt-panel';
  const PROVIDER_LABELS = { free: '免费翻译', qwen: '千问', deepseek: 'DeepSeek' };
  const FALLBACK_PARAMS = { aspectRatio: '16:9', stylize: 450, chaos: 8, quality: '', hd: false };
  const draftStore = MJDraftStore.createDraftStore(chrome.storage.local);
  let currentPanel = null;
  let currentComposer = null;
  let currentHost = null;
  let scanTimer = null;
  let saveTimer = null;
  let draftSaveTimer = null;

  function positionCurrentPanel() {
    if (!currentPanel || !currentHost || currentPanel.hidden) return;
    const placement = MJDom.panelViewportPlacement(currentHost);
    if (!placement) return;
    currentPanel.style.left = `${placement.left}px`;
    currentPanel.style.top = `${placement.top}px`;
    currentPanel.style.width = `${placement.width}px`;
  }

  function setPanelVisible(visible) {
    if (!currentPanel) return;
    currentPanel.hidden = !visible;
    if (visible) positionCurrentPanel();
  }

  function handleInteractionTarget(target) {
    if (!currentPanel || !currentComposer) return;
    if (MJDom.isWithinInteractionScope(currentComposer, currentPanel, target)) {
      if (target === currentComposer || currentComposer.contains(target)) setPanelVisible(true);
      return;
    }
    setPanelVisible(false);
  }

  function setStatus(panel, message, kind = '') {
    if (!panel) return;
    const status = panel.querySelector('[data-mjpt="status"]');
    status.textContent = message;
    status.dataset.kind = kind;
  }

  const pageTranslator = MJPageTranslator.createController({
    adapter: MJPageTranslator.createBrowserAdapter(document, PANEL_ID),
    request: async ({ text, provider }) => {
      const response = await chrome.runtime.sendMessage({
        type: 'translate', text, provider, purpose: 'page',
      });
      if (!response?.ok) throw new Error(response?.message || '页面翻译失败');
      return { text: response.text, provider: response.provider };
    },
    onProgress: ({ completed, pending }) => {
      setStatus(currentPanel, `页面翻译：已完成 ${completed}，待处理 ${pending}`);
    },
    onError: (error) => {
      setStatus(currentPanel, error?.message || '页面翻译失败', 'error');
    },
  });

  function numberInRange(value, fallback, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.round(number)));
  }

  function paramsFromPanel(panel) {
    const aspectRatio = panel.querySelector('[data-mjpt="aspect"]')?.value.trim() || '16:9';
    return {
      aspectRatio: /^[1-9]\d*:[1-9]\d*$/.test(aspectRatio) ? aspectRatio : '16:9',
      stylize: numberInRange(panel.querySelector('[data-mjpt="stylize"]')?.value, 450, 0, 1000),
      chaos: numberInRange(panel.querySelector('[data-mjpt="chaos"]')?.value, 8, 0, 100),
      quality: panel.querySelector('[data-mjpt="quality"]')?.value || '',
      hd: panel.querySelector('[data-mjpt="hd"]')?.checked === true,
    };
  }

  function applyParams(panel, params = FALLBACK_PARAMS) {
    panel.querySelector('[data-mjpt="aspect"]').value = params.aspectRatio || FALLBACK_PARAMS.aspectRatio;
    panel.querySelector('[data-mjpt="stylize"]').value = params.stylize ?? FALLBACK_PARAMS.stylize;
    panel.querySelector('[data-mjpt="chaos"]').value = params.chaos ?? FALLBACK_PARAMS.chaos;
    panel.querySelector('[data-mjpt="quality"]').value = ['1', '2', '4'].includes(String(params.quality))
      ? String(params.quality)
      : '';
    panel.querySelector('[data-mjpt="hd"]').checked = params.hd === true;
  }

  function scheduleParamSave(panel) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'save-params', params: paramsFromPanel(panel) });
        if (!response?.ok) throw new Error(response?.message);
      } catch {
        setStatus(panel, '参数未能保存，但本次仍可使用', 'error');
      }
    }, 250);
  }

  function createPanel() {
    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.hidden = true;
    panel.setAttribute('aria-label', 'MJ 中文提示词翻译');
    panel.innerHTML = `
      <div class="mjpt-heading">
        <div>
          <span class="mjpt-kicker">MJ TRANSLATOR</span>
          <strong>中文提示词</strong>
        </div>
        <label class="mjpt-provider-wrap">
          <span class="mjpt-sr-only">翻译类型</span>
          <select class="mjpt-provider" data-mjpt="provider" aria-label="翻译类型">
            <option value="deepseek">DeepSeek</option>
            <option value="qwen">千问</option>
            <option value="free">免费翻译</option>
          </select>
        </label>
      </div>
      <div class="mjpt-editor-grid">
        <label class="mjpt-editor">
          <span>中文输入</span>
          <textarea class="mjpt-prompt" data-mjpt="prompt" rows="7" placeholder="输入中文画面描述，可附带 --参数"></textarea>
        </label>
        <label class="mjpt-editor">
          <span>中英文对照</span>
          <textarea class="mjpt-preview" data-mjpt="preview" rows="7" placeholder="翻译完成后将在这里显示中英文对照" readonly></textarea>
        </label>
      </div>
      <label class="mjpt-instruction-row">
        <span>翻译要求（仅千问 / DeepSeek 有效）</span>
        <input data-mjpt="instruction" type="text" maxlength="500">
      </label>
      <p class="mjpt-instruction-note" data-mjpt="instruction-note" hidden>免费翻译无法遵循自定义要求</p>
      <div class="mjpt-controls">
        <label><span>画幅 --ar</span><input data-mjpt="aspect" value="16:9" inputmode="text" list="mjpt-aspect-ratios"></label>
        <datalist id="mjpt-aspect-ratios">
          ${MJPromptCore.ASPECT_RATIO_OPTIONS.map((ratio) => `<option value="${ratio}"></option>`).join('')}
        </datalist>
        <label><span>风格化</span><input data-mjpt="stylize" type="number" min="0" max="1000" value="450"></label>
        <label><span>混乱度</span><input data-mjpt="chaos" type="number" min="0" max="100" value="8"></label>
        <label><span>质量</span>
          <select data-mjpt="quality">
            <option value="">自动</option><option value="1">1</option><option value="2">2</option><option value="4">4</option>
          </select>
        </label>
        <label class="mjpt-check"><input data-mjpt="hd" type="checkbox"><span>HD高清</span></label>
      </div>
      <div class="mjpt-page-options">
        <label class="mjpt-switch-row">
          <input data-mjpt="translate-page" type="checkbox" role="switch">
          <span>翻译页面</span>
        </label>
        <label class="mjpt-switch-row" data-mjpt="keep-original-wrap" hidden>
          <input data-mjpt="keep-original" type="checkbox" role="switch" checked>
          <span>保留原文</span>
        </label>
      </div>
      <div class="mjpt-actions">
        <button class="mjpt-translate" data-mjpt="translate-fill" type="button">翻译并填入</button>
        <button class="mjpt-secondary" data-mjpt="translate-only" type="button">翻译</button>
        <button class="mjpt-secondary" data-mjpt="fill" type="button">填入</button>
        <button class="mjpt-secondary" data-mjpt="save-draft" type="button">保存</button>
        <button class="mjpt-clear" data-mjpt="clear" type="button">清空</button>
        <button class="mjpt-settings" data-mjpt="settings" type="button">设置</button>
      </div>
      <p class="mjpt-status" data-mjpt="status" role="status" aria-live="polite"></p>
    `;
    return panel;
  }

  async function loadUiSettings(panel) {
    try {
      panel.querySelector('[data-mjpt="prompt"]').value = await draftStore.load();
    } catch {
      setStatus(panel, '中文草稿读取失败，但不影响本次使用', 'error');
    }
    try {
      const response = await chrome.runtime.sendMessage({ type: 'get-ui-settings' });
      if (!response?.ok) throw new Error(response?.message);
      applyParams(panel, response.params);
      const provider = panel.querySelector('[data-mjpt="provider"]');
      const instruction = panel.querySelector('[data-mjpt="instruction"]');
      provider.value = response.provider || 'deepseek';
      instruction.value = response.translationInstruction || '';
      MJPanelState.syncInstructionAvailability(
        provider,
        instruction,
        panel.querySelector('[data-mjpt="instruction-note"]'),
      );
    } catch {
      applyParams(panel, FALLBACK_PARAMS);
      const provider = panel.querySelector('[data-mjpt="provider"]');
      const instruction = panel.querySelector('[data-mjpt="instruction"]');
      provider.value = 'deepseek';
      instruction.value = '';
      MJPanelState.syncInstructionAvailability(
        provider,
        instruction,
        panel.querySelector('[data-mjpt="instruction-note"]'),
      );
      setStatus(panel, '请刷新页面或检查扩展状态', 'error');
    }
  }

  async function translate(panel, mode = 'translate-fill', button = null) {
    const input = panel.querySelector('[data-mjpt="prompt"]');
    const preview = panel.querySelector('[data-mjpt="preview"]');
    const { text, params } = MJPromptCore.splitPromptAndParams(input.value);
    let english = preview.dataset.english || '';
    if (mode !== 'fill' && !text) {
      setStatus(panel, '请先输入需要翻译的中文提示词', 'error');
      input.focus();
      return;
    }
    if (mode === 'fill' && !english) {
      setStatus(panel, '请先点击翻译，生成英文结果后再填入', 'error');
      input.focus();
      return;
    }
    if (mode === 'fill' && !MJPanelState.isPreviewFresh(preview)) {
      setStatus(panel, '中文内容已修改，请重新翻译后再填入', 'error');
      input.focus();
      return;
    }

    const buttonLabel = button?.textContent || '';
    let actualProvider = panel.querySelector('[data-mjpt="provider"]').value;
    if (button && mode !== 'fill') {
      button.disabled = true;
      button.textContent = '翻译中…';
    }
    try {
      if (mode !== 'fill') {
        preview.value = '';
        delete preview.dataset.english;
        delete preview.dataset.stale;
        const paragraphs = MJPromptCore.splitPromptParagraphs(text);
        const translations = [];
        for (let index = 0; index < paragraphs.length; index += 1) {
          setStatus(panel, `正在使用 ${PROVIDER_LABELS[actualProvider]} 翻译第 ${index + 1}/${paragraphs.length} 段…`);
          const response = await chrome.runtime.sendMessage({
            type: 'translate',
            text: paragraphs[index],
            provider: panel.querySelector('[data-mjpt="provider"]').value,
            instruction: panel.querySelector('[data-mjpt="instruction"]').value,
            purpose: 'prompt',
          });
          if (!response?.ok) throw new Error(response?.message || '翻译失败');
          actualProvider = response.provider || actualProvider;
          translations.push(response.text);
          preview.value = MJPromptCore.buildBilingualResult(
            paragraphs.slice(0, translations.length),
            translations,
          ).preview;
        }
        const result = MJPromptCore.buildBilingualResult(paragraphs, translations);
        english = result.english;
        MJPanelState.setPreviewResult(preview, result.preview, english);
        if (mode === 'translate-only') {
          setStatus(panel, `${PROVIDER_LABELS[actualProvider]} 翻译完成，可检查结果后点击填入`, 'success');
          return;
        }
      }
      const finalPrompt = MJPromptCore.composePrompt(english, params, paramsFromPanel(panel));
      const destination = MJDom.findComposer(document);
      if (!destination) throw new Error('未找到 Midjourney 提示词输入框，请刷新页面');
      MJDom.setComposerValue(destination, finalPrompt);
      setStatus(panel, `${PROVIDER_LABELS[actualProvider]} 翻译并已填入 Midjourney，请确认后手动提交`, 'success');
    } catch (error) {
      setStatus(panel, error?.message || '翻译失败，请重试', 'error');
    } finally {
      if (button && mode !== 'fill') {
        button.disabled = false;
        button.textContent = buttonLabel;
      }
    }
  }

  function bindPanel(panel) {
    const input = panel.querySelector('[data-mjpt="prompt"]');
    const preview = panel.querySelector('[data-mjpt="preview"]');
    const provider = panel.querySelector('[data-mjpt="provider"]');
    const instruction = panel.querySelector('[data-mjpt="instruction"]');
    const translatePage = panel.querySelector('[data-mjpt="translate-page"]');
    const keepOriginal = panel.querySelector('[data-mjpt="keep-original"]');
    const keepOriginalWrap = panel.querySelector('[data-mjpt="keep-original-wrap"]');
    const pageState = pageTranslator.snapshot();
    translatePage.checked = pageState.enabled;
    keepOriginal.checked = pageState.keepOriginal;
    keepOriginalWrap.hidden = !pageState.enabled;
    panel.querySelector('[data-mjpt="translate-fill"]').addEventListener('click', (event) => {
      translate(panel, 'translate-fill', event.currentTarget);
    });
    panel.querySelector('[data-mjpt="translate-only"]').addEventListener('click', (event) => {
      translate(panel, 'translate-only', event.currentTarget);
    });
    panel.querySelector('[data-mjpt="fill"]').addEventListener('click', (event) => {
      translate(panel, 'fill', event.currentTarget);
    });
    panel.querySelector('[data-mjpt="save-draft"]').addEventListener('click', async () => {
      clearTimeout(draftSaveTimer);
      clearTimeout(saveTimer);
      try {
        await MJDraftStore.savePanelState(
          draftStore,
          chrome.runtime,
          input.value,
          provider.value,
          instruction.value,
          paramsFromPanel(panel),
        );
        setStatus(panel, '提示词和参数已保存到本地', 'success');
      } catch {
        setStatus(panel, '提示词或参数保存失败，请重试', 'error');
      }
      input.focus();
    });
    panel.querySelector('[data-mjpt="clear"]').addEventListener('click', () => {
      clearTimeout(draftSaveTimer);
      MJDraftStore.clearPanelContent(input, preview);
      setStatus(panel, '已临时清空，刷新后可恢复已保存内容', 'success');
      input.focus();
    });
    panel.querySelector('[data-mjpt="settings"]').addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'open-options' });
    });
    provider.addEventListener('change', () => {
      MJPanelState.syncInstructionAvailability(
        provider,
        instruction,
        panel.querySelector('[data-mjpt="instruction-note"]'),
      );
      if (pageTranslator.snapshot().enabled) {
        pageTranslator.setProvider(provider.value);
        pageTranslator.scan(document.body);
      }
    });
    translatePage.addEventListener('change', () => {
      if (translatePage.checked) {
        keepOriginal.checked = true;
        keepOriginalWrap.hidden = false;
        pageTranslator.enable({ provider: provider.value, keepOriginal: true });
        pageTranslator.scan(document.body);
      } else {
        keepOriginal.checked = true;
        keepOriginalWrap.hidden = true;
        pageTranslator.disable();
        setStatus(panel, '已关闭页面翻译并恢复原文', 'success');
      }
    });
    keepOriginal.addEventListener('change', () => {
      pageTranslator.setKeepOriginal(keepOriginal.checked);
    });
    for (const control of panel.querySelectorAll('.mjpt-controls input, .mjpt-controls select')) {
      control.addEventListener('change', () => scheduleParamSave(panel));
    }
    input.addEventListener('input', () => {
      MJPanelState.markPreviewStale(preview);
      if (preview.dataset.stale === 'true') {
        setStatus(panel, '中文内容已修改，右侧为上次翻译');
      }
      clearTimeout(draftSaveTimer);
      draftSaveTimer = setTimeout(async () => {
        try {
          await draftStore.save(input.value);
        } catch {
          setStatus(panel, '中文草稿未能保存，但本次仍可使用', 'error');
        }
      }, 250);
    });
    input.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        translate(panel, 'translate-fill', panel.querySelector('[data-mjpt="translate-fill"]'));
      }
    });
  }

  function mountPanel(composer) {
    currentPanel?.remove();
    const panel = createPanel();
    const host = MJDom.findPanelHost(composer);
    if (!host) return;
    host.append(panel);
    currentPanel = panel;
    currentComposer = composer;
    currentHost = host;
    bindPanel(panel);
    loadUiSettings(panel);
  }

  function scan() {
    const composer = MJDom.findComposer(document);
    if (!composer) {
      if (currentComposer && !currentComposer.isConnected) {
        currentPanel?.remove();
        currentPanel = null;
        currentComposer = null;
        currentHost = null;
      }
      return;
    }
    if (currentPanel?.isConnected && currentComposer === composer && currentComposer.isConnected) {
      positionCurrentPanel();
      return;
    }
    mountPanel(composer);
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 120);
  }

  function isExtensionNode(node) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    return Boolean(element?.closest?.(`#${PANEL_ID}, [data-mjpt-page-translation="true"]`));
  }

  const observer = new MutationObserver((mutations) => {
    scheduleScan();
    if (!pageTranslator.snapshot().enabled) return;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!isExtensionNode(node)) pageTranslator.scan(node);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('pointerdown', (event) => handleInteractionTarget(event.target), true);
  document.addEventListener('focusin', (event) => handleInteractionTarget(event.target), true);
  window.addEventListener('resize', positionCurrentPanel);
  window.addEventListener('scroll', positionCurrentPanel, true);
  scan();
}());
