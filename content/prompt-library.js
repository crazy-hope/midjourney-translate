(function initPromptLibrary(globalScope) {
  'use strict';

  const DEFAULT_KEY = 'mjptPromptLibraryV1';

  function validDate(value) {
    return typeof value === 'string' && value.trim() && !Number.isNaN(Date.parse(value));
  }

  function normalizeFields(value, requireDate = true) {
    if (!value || typeof value !== 'object') return null;
    const id = typeof value.id === 'string' ? value.id.trim() : '';
    const title = typeof value.title === 'string' ? value.title.trim() : '';
    const chinese = typeof value.chinese === 'string' ? value.chinese : '';
    const english = typeof value.english === 'string' ? value.english : '';
    if (!id || !title || (!chinese.trim() && !english.trim())) return null;
    if (requireDate && !validDate(value.date)) return null;
    return { id, title, chinese, english };
  }

  function normalizeRecord(value) {
    const fields = normalizeFields(value, true);
    if (!fields) return null;
    return { ...fields, date: new Date(value.date).toISOString() };
  }

  function createPromptLibrary(storageArea, options = {}) {
    if (!storageArea || typeof storageArea.get !== 'function'
      || typeof storageArea.set !== 'function') {
      throw new TypeError('Chrome storage area is required');
    }
    const key = options.key || DEFAULT_KEY;
    const now = options.now || (() => new Date().toISOString());
    const createId = options.createId || (() => {
      if (typeof globalScope.crypto?.randomUUID === 'function') {
        return globalScope.crypto.randomUUID();
      }
      return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    });

    async function read() {
      const stored = await storageArea.get(key);
      const byId = new Map();
      for (const value of Array.isArray(stored?.[key]) ? stored[key] : []) {
        const record = normalizeRecord(value);
        if (record) byId.set(record.id, record);
      }
      return [...byId.values()];
    }

    async function write(records) {
      await storageArea.set({ [key]: records });
    }

    async function list() {
      return read();
    }

    async function add(value) {
      const id = String(createId() || '').trim();
      const fields = normalizeFields({ ...value, id }, false);
      if (!fields) throw new TypeError('请输入标题和提示词内容');
      const records = await read();
      if (records.some((record) => record.id === id)) throw new Error('提示词 ID 已存在');
      const record = { ...fields, date: new Date(now()).toISOString() };
      await write([...records, record]);
      return record;
    }

    async function update(id, value) {
      const normalizedId = String(id || '').trim();
      const records = await read();
      const index = records.findIndex((record) => record.id === normalizedId);
      if (index < 0) throw new Error('未找到要更新的提示词');
      const fields = normalizeFields({
        id: normalizedId,
        title: records[index].title,
        chinese: value?.chinese,
        english: value?.english,
      }, false);
      if (!fields) throw new TypeError('提示词内容不能为空');
      const record = { ...fields, date: new Date(now()).toISOString() };
      const next = records.slice();
      next[index] = record;
      await write(next);
      return record;
    }

    async function merge(values) {
      const imported = new Map();
      let skipped = 0;
      for (const value of Array.isArray(values) ? values : []) {
        const fields = normalizeFields(value, false);
        if (!fields) skipped += 1;
        else imported.set(fields.id, fields);
      }
      const records = await read();
      const byId = new Map(records.map((record) => [record.id, record]));
      let added = 0;
      let overwritten = 0;
      for (const fields of imported.values()) {
        if (byId.has(fields.id)) overwritten += 1;
        else added += 1;
        byId.set(fields.id, { ...fields, date: new Date(now()).toISOString() });
      }
      const next = [...byId.values()];
      await write(next);
      return { records: next, added, overwritten, skipped };
    }

    return Object.freeze({ list, add, update, merge });
  }

  const api = Object.freeze({ DEFAULT_KEY, normalizeRecord, createPromptLibrary });
  globalScope.MJPromptLibrary = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : self));
