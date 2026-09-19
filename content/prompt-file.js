(function initPromptFile(globalScope) {
  'use strict';

  const MARKER = 'MJPT_PROMPT_LIBRARY_V1';
  const FORMATS = new Set(['md', 'txt']);

  function assertFormat(format) {
    if (!FORMATS.has(format)) throw new TypeError('仅支持 Markdown 或 TXT 格式');
  }

  function parsePayload(payload, result) {
    try {
      const value = JSON.parse(payload);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
      result.records.push(value);
    } catch {
      result.skipped += 1;
    }
  }

  function serializeMarkdown(records) {
    const blocks = records.map((record) => {
      const title = typeof record?.title === 'string' ? record.title : '';
      const date = typeof record?.date === 'string' ? record.date : '';
      return `# ${title}\n\n日期：${date}\n\n\`\`\`mjpt-record\n${JSON.stringify(record)}\n\`\`\``;
    });
    return `<!-- ${MARKER} -->\n\n${blocks.join('\n\n')}${blocks.length ? '\n' : ''}`;
  }

  function serializeText(records) {
    const blocks = records.map((record) => {
      const payload = JSON.stringify(record);
      return `MJPT_RECORD ${payload.length}\n${payload}`;
    });
    return `${MARKER}\n${blocks.join('\n')}${blocks.length ? '\n' : ''}`;
  }

  function serialize(records, format) {
    assertFormat(format);
    const values = Array.isArray(records) ? records : [];
    return format === 'md' ? serializeMarkdown(values) : serializeText(values);
  }

  function parseMarkdown(text) {
    if (!String(text).includes(`<!-- ${MARKER} -->`)) {
      throw new TypeError('无法识别提示词 Markdown 文件');
    }
    const result = { records: [], skipped: 0 };
    const pattern = /```mjpt-record\r?\n([^\r\n]*)\r?\n```/g;
    let match = pattern.exec(text);
    while (match) {
      parsePayload(match[1], result);
      match = pattern.exec(text);
    }
    return result;
  }

  function consumeNewline(text, position) {
    if (text.startsWith('\r\n', position)) return position + 2;
    if (text[position] === '\n') return position + 1;
    return position;
  }

  function parseText(text) {
    const source = String(text);
    if (!source.startsWith(MARKER)) throw new TypeError('无法识别提示词 TXT 文件');
    let position = consumeNewline(source, MARKER.length);
    if (position === MARKER.length && source.length !== MARKER.length) {
      throw new TypeError('无法识别提示词 TXT 文件');
    }
    const result = { records: [], skipped: 0 };
    while (position < source.length) {
      position = consumeNewline(source, position);
      if (position >= source.length) break;
      const header = /^MJPT_RECORD (\d+)\r?\n/.exec(source.slice(position));
      if (!header) throw new TypeError('提示词 TXT 文件结构损坏');
      position += header[0].length;
      const length = Number(header[1]);
      if (!Number.isSafeInteger(length) || length < 0 || position + length > source.length) {
        throw new TypeError('提示词 TXT 文件结构损坏');
      }
      parsePayload(source.slice(position, position + length), result);
      position += length;
      if (position < source.length && !['\r', '\n'].includes(source[position])) {
        throw new TypeError('提示词 TXT 文件结构损坏');
      }
    }
    return result;
  }

  function parse(text, format) {
    assertFormat(format);
    return format === 'md' ? parseMarkdown(String(text)) : parseText(text);
  }

  function exportFilename(format, date = new Date()) {
    assertFormat(format);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new TypeError('导出日期无效');
    return `mj-prompts-${date.toISOString().slice(0, 10)}.${format}`;
  }

  const api = Object.freeze({ MARKER, serialize, parse, exportFilename });
  globalScope.MJPromptFile = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : self));
