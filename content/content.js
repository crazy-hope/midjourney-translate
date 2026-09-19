(function initContentScript() {
  'use strict';

  const PANEL_ID = 'mjpt-panel';
  const PROVIDER_LABELS = { free: '免费翻译', qwen: '千问', deepseek: 'DeepSeek' };
  const FALLBACK_PARAMS = { aspectRatio: '16:9', stylize: 450, chaos: 8, quality: '', hd: false };
  const promptLibrary = MJPromptLibrary.createPromptLibrary(chrome.storage.local);
  const pageTranslationCache = MJPageTranslationCache.createPageTranslationCache(chrome.storage.local);
  const pageCacheReady = pageTranslationCache.load();
  let currentPanel = null;
  let currentComposer = null;
  let currentHost = null;
  let scanTimer = null;
  let saveTimer = null;
  let pageRootTimer = null;
  const pageRoots = new Set();

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
    cache: pageTranslationCache,
    request: async ({ text, provider }) => {
      const response = await chrome.runtime.sendMessage({
        type: 'translate', text, provider, purpose: 'page',
      });
      if (!response?.ok) {
        const error = new Error(response?.message || '页面翻译失败');
        error.code = response?.code;
        throw error;
      }
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
        <div class="mjpt-heading-actions">
          <button class="mjpt-compact" data-mjpt="import" type="button">导入</button>
          <button class="mjpt-compact" data-mjpt="export" type="button">导出</button>
          <input data-mjpt="import-file" type="file" accept=".md,.txt,text/markdown,text/plain" hidden>
          <label class="mjpt-provider-wrap">
            <span class="mjpt-sr-only">翻译类型</span>
            <select class="mjpt-provider" data-mjpt="provider" aria-label="翻译类型">
              <option value="deepseek">DeepSeek</option>
              <option value="qwen">千问</option>
              <option value="free">免费翻译</option>
            </select>
          </label>
        </div>
      </div>
      <div class="mjpt-editor-grid">
        <div class="mjpt-editor">
          <div class="mjpt-editor-heading">
            <label for="mjpt-prompt-input">中文输入</label>
            <div class="mjpt-library-actions">
              <div class="mjpt-library-picker">
                <input data-mjpt="library-search" type="search" placeholder="检索已保存提示词" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="mjpt-library-results">
                <div id="mjpt-library-results" class="mjpt-library-results" data-mjpt="library-results" role="listbox" hidden></div>
              </div>
              <button class="mjpt-compact" data-mjpt="prompt-add" type="button">新增</button>
              <button class="mjpt-compact" data-mjpt="prompt-update" type="button">更新</button>
            </div>
          </div>
          <textarea id="mjpt-prompt-input" class="mjpt-prompt" data-mjpt="prompt" rows="7" placeholder="输入中文画面描述，可附带 --参数"></textarea>
        </div>
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
        <button class="mjpt-secondary" data-mjpt="save-config" type="button">保存配置</button>
        <button class="mjpt-clear" data-mjpt="clear" type="button">清空</button>
        <button class="mjpt-settings" data-mjpt="settings" type="button">设置</button>
      </div>
      <p class="mjpt-status" data-mjpt="status" role="status" aria-live="polite"></p>
      <div class="mjpt-modal" data-mjpt="title-dialog" hidden>
        <div class="mjpt-dialog" role="dialog" aria-modal="true" aria-labelledby="mjpt-title-dialog-label">
          <strong id="mjpt-title-dialog-label">新增提示词</strong>
          <input data-mjpt="prompt-title" type="text" maxlength="120" placeholder="输入提示词标题">
          <div class="mjpt-dialog-actions">
            <button class="mjpt-secondary" data-mjpt="title-cancel" type="button">取消</button>
            <button class="mjpt-translate" data-mjpt="title-confirm" type="button">确认新增</button>
          </div>
        </div>
      </div>
      <div class="mjpt-modal" data-mjpt="export-dialog" hidden>
        <div class="mjpt-dialog" role="dialog" aria-modal="true" aria-labelledby="mjpt-export-dialog-label">
          <strong id="mjpt-export-dialog-label">选择导出格式</strong>
          <div class="mjpt-dialog-actions">
            <button class="mjpt-secondary" data-mjpt="export-md" type="button">Markdown</button>
            <button class="mjpt-secondary" data-mjpt="export-txt" type="button">TXT</button>
            <button class="mjpt-clear" data-mjpt="export-cancel" type="button">取消</button>
          </div>
        </div>
      </div>
    `;
    return panel;
  }

  async function loadUiSettings(panel) {
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
    const sourcePrompt = input.value;
    const { text, params } = MJPromptCore.splitPromptAndParams(sourcePrompt);
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
        const sourceChanged = input.value !== sourcePrompt;
        MJPanelState.setPreviewResult(preview, result.preview, english, sourceChanged);
        if (sourceChanged) {
          setStatus(panel, '翻译期间中文内容已修改，结果已保留，请重新翻译后再填入', 'error');
          return;
        }
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
    const librarySearch = panel.querySelector('[data-mjpt="library-search"]');
    const libraryResults = panel.querySelector('[data-mjpt="library-results"]');
    const titleDialog = panel.querySelector('[data-mjpt="title-dialog"]');
    const titleInput = panel.querySelector('[data-mjpt="prompt-title"]');
    const exportDialog = panel.querySelector('[data-mjpt="export-dialog"]');
    const importFile = panel.querySelector('[data-mjpt="import-file"]');
    const translatePage = panel.querySelector('[data-mjpt="translate-page"]');
    const keepOriginal = panel.querySelector('[data-mjpt="keep-original"]');
    const keepOriginalWrap = panel.querySelector('[data-mjpt="keep-original-wrap"]');
    let selectedPromptId = '';
    let promptRecords = [];

    function hideLibraryResults() {
      libraryResults.hidden = true;
      librarySearch.setAttribute('aria-expanded', 'false');
    }

    function previewForRecord(record) {
      const source = MJPromptCore.splitPromptAndParams(record.chinese).text;
      const sourceParagraphs = MJPromptCore.splitPromptParagraphs(source);
      const translatedParagraphs = MJPromptCore.splitPromptParagraphs(record.english);
      if (sourceParagraphs.length && sourceParagraphs.length === translatedParagraphs.length) {
        return MJPromptCore.buildBilingualResult(sourceParagraphs, translatedParagraphs).preview;
      }
      return [source, record.english].filter(Boolean).join('\n\n');
    }

    function selectPrompt(record) {
      if (!record) return;
      selectedPromptId = record.id;
      input.value = record.chinese;
      librarySearch.value = MJPanelState.formatPromptOption(record);
      if (record.english) {
        MJPanelState.setPreviewResult(preview, previewForRecord(record), record.english, false);
      } else {
        preview.value = '';
        delete preview.dataset.english;
        delete preview.dataset.stale;
      }
      hideLibraryResults();
      setStatus(panel, `已载入：${record.title}`, 'success');
    }

    function renderLibraryResults(query = '') {
      libraryResults.replaceChildren();
      const matches = MJPanelState.filterPromptRecords(promptRecords, query);
      for (const record of matches) {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'mjpt-library-option';
        option.dataset.promptId = record.id;
        option.setAttribute('role', 'option');
        option.textContent = MJPanelState.formatPromptOption(record);
        option.addEventListener('click', () => selectPrompt(record));
        libraryResults.append(option);
      }
      if (!matches.length) {
        const empty = document.createElement('span');
        empty.className = 'mjpt-library-empty';
        empty.textContent = '没有匹配的提示词';
        libraryResults.append(empty);
      }
      libraryResults.hidden = false;
      librarySearch.setAttribute('aria-expanded', 'true');
    }

    async function refreshLibrary(query = '') {
      promptRecords = await promptLibrary.list();
      renderLibraryResults(query);
      return promptRecords;
    }

    async function downloadLibrary(format) {
      const records = await promptLibrary.list();
      const content = MJPromptFile.serialize(records, format);
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = MJPromptFile.exportFilename(format, new Date());
        anchor.hidden = true;
        panel.append(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      exportDialog.hidden = true;
      setStatus(panel, `已导出 ${records.length} 条提示词`, 'success');
    }

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
    librarySearch.addEventListener('focus', () => renderLibraryResults(librarySearch.value));
    librarySearch.addEventListener('input', () => renderLibraryResults(librarySearch.value));
    panel.querySelector('[data-mjpt="prompt-add"]').addEventListener('click', () => {
      titleInput.value = '';
      titleDialog.hidden = false;
      titleInput.focus();
    });
    panel.querySelector('[data-mjpt="title-cancel"]').addEventListener('click', () => {
      titleDialog.hidden = true;
      input.focus();
    });
    panel.querySelector('[data-mjpt="title-confirm"]').addEventListener('click', async () => {
      try {
        const english = MJPanelState.isPreviewFresh(preview) ? preview.dataset.english : '';
        const record = await promptLibrary.add({
          title: titleInput.value,
          chinese: input.value,
          english,
        });
        titleDialog.hidden = true;
        promptRecords = await promptLibrary.list();
        selectPrompt(record);
        setStatus(panel, `已新增：${record.title}`, 'success');
      } catch (error) {
        setStatus(panel, error?.message || '新增提示词失败', 'error');
      }
    });
    panel.querySelector('[data-mjpt="prompt-update"]').addEventListener('click', async () => {
      if (!MJPanelState.canUpdateSelectedPrompt(selectedPromptId, preview)) {
        setStatus(panel, selectedPromptId ? '请先重新翻译后再更新' : '请先选择要更新的提示词', 'error');
        return;
      }
      try {
        const record = await promptLibrary.update(selectedPromptId, {
          chinese: input.value,
          english: preview.dataset.english,
        });
        promptRecords = await promptLibrary.list();
        selectPrompt(record);
        setStatus(panel, `已更新：${record.title}`, 'success');
      } catch (error) {
        setStatus(panel, error?.message || '更新提示词失败', 'error');
      }
    });
    panel.querySelector('[data-mjpt="import"]').addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', async () => {
      const file = importFile.files?.[0];
      if (!file) return;
      try {
        const extension = file.name.toLocaleLowerCase().split('.').pop();
        if (!['md', 'txt'].includes(extension)) throw new TypeError('仅支持 Markdown 或 TXT 文件');
        const parsed = MJPromptFile.parse(await file.text(), extension);
        const merged = await promptLibrary.merge(parsed.records);
        promptRecords = await promptLibrary.list();
        const selected = promptRecords.find((record) => record.id === selectedPromptId);
        if (selected) selectPrompt(selected);
        setStatus(
          panel,
          `导入完成：新增 ${merged.added}，覆盖 ${merged.overwritten}，跳过 ${parsed.skipped + merged.skipped}`,
          'success',
        );
      } catch (error) {
        setStatus(panel, error?.message || '导入失败，原提示词未修改', 'error');
      } finally {
        importFile.value = '';
      }
    });
    panel.querySelector('[data-mjpt="export"]').addEventListener('click', () => {
      exportDialog.hidden = false;
    });
    panel.querySelector('[data-mjpt="export-cancel"]').addEventListener('click', () => {
      exportDialog.hidden = true;
    });
    panel.querySelector('[data-mjpt="export-md"]').addEventListener('click', () => {
      downloadLibrary('md').catch((error) => setStatus(panel, error?.message || '导出失败', 'error'));
    });
    panel.querySelector('[data-mjpt="export-txt"]').addEventListener('click', () => {
      downloadLibrary('txt').catch((error) => setStatus(panel, error?.message || '导出失败', 'error'));
    });
    panel.querySelector('[data-mjpt="save-config"]').addEventListener('click', async () => {
      clearTimeout(saveTimer);
      try {
        await MJDraftStore.savePanelConfig(
          chrome.runtime,
          provider.value,
          instruction.value,
          paramsFromPanel(panel),
        );
        setStatus(panel, '配置已保存到本地', 'success');
      } catch {
        setStatus(panel, '配置保存失败，请重试', 'error');
      }
      input.focus();
    });
    panel.querySelector('[data-mjpt="clear"]').addEventListener('click', () => {
      MJDraftStore.clearPanelContent(input, preview);
      selectedPromptId = '';
      librarySearch.value = '';
      hideLibraryResults();
      setStatus(panel, '已清空当前输入', 'success');
      input.focus();
    });
    panel.querySelector('[data-mjpt="settings"]').addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'open-options' });
    });
    provider.addEventListener('change', async () => {
      MJPanelState.syncInstructionAvailability(
        provider,
        instruction,
        panel.querySelector('[data-mjpt="instruction-note"]'),
      );
      if (pageTranslator.snapshot().enabled) {
        await pageCacheReady;
        pageTranslator.setProvider(provider.value);
        pageTranslator.register(document.body);
      }
    });
    translatePage.addEventListener('change', async () => {
      if (translatePage.checked) {
        await pageCacheReady;
        keepOriginal.checked = true;
        keepOriginalWrap.hidden = false;
        pageTranslator.enable({ provider: provider.value, keepOriginal: true });
        pageTranslator.register(document.body);
      } else {
        clearTimeout(pageRootTimer);
        pageRoots.clear();
        keepOriginal.checked = true;
        keepOriginalWrap.hidden = true;
        pageTranslator.disable();
        pageTranslator.flushCache().catch(() => {});
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
    });
    input.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        translate(panel, 'translate-fill', panel.querySelector('[data-mjpt="translate-fill"]'));
      }
    });
    refreshLibrary().then(hideLibraryResults).catch(() => {
      setStatus(panel, '提示词库读取失败，但不影响本次使用', 'error');
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

  function schedulePageRoots() {
    clearTimeout(pageRootTimer);
    pageRootTimer = setTimeout(() => {
      const roots = MJPanelState.coalesceRoots([...pageRoots]);
      pageRoots.clear();
      for (const root of roots) pageTranslator.register(root);
    }, 100);
  }

  const observer = new MutationObserver((mutations) => {
    let sawExternalNode = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (isExtensionNode(node)) continue;
        sawExternalNode = true;
        if (pageTranslator.snapshot().enabled) pageRoots.add(node);
      }
    }
    if (sawExternalNode) scheduleScan();
    if (pageRoots.size) schedulePageRoots();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('pointerdown', (event) => handleInteractionTarget(event.target), true);
  document.addEventListener('focusin', (event) => handleInteractionTarget(event.target), true);
  window.addEventListener('resize', positionCurrentPanel);
  window.addEventListener('scroll', positionCurrentPanel, true);
  window.addEventListener('pagehide', () => pageTranslator.flushCache().catch(() => {}));
  scan();
}());
