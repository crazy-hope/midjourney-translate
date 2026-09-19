const test = require('node:test');
const assert = require('node:assert/strict');

let serialize;
let parse;
let exportFilename;
try {
  ({ serialize, parse, exportFilename } = require('../content/prompt-file.js'));
} catch {
  serialize = undefined;
}

const fixture = {
  id: 'id-1',
  title: '云宫 --- ```',
  chinese: '第一行\n\n第二行',
  english: 'Cloud palace\n```json\nnot metadata',
  date: '2026-09-19T10:00:00.000Z',
};

for (const format of ['md', 'txt']) {
  test(`${format} round trips Unicode, blank lines, fences, and separators`, () => {
    assert.equal(typeof serialize, 'function');
    assert.deepEqual(parse(serialize([fixture], format), format).records, [fixture]);
  });
}

test('round trips multiple records in both formats', () => {
  const records = [fixture, { ...fixture, id: 'id-2', title: '第二条' }];
  for (const format of ['md', 'txt']) {
    assert.deepEqual(parse(serialize(records, format), format), { records, skipped: 0 });
  }
});

test('rejects a file without a valid format marker before returning records', () => {
  assert.throws(() => parse('ordinary notes', 'txt'), /无法识别/);
  assert.throws(() => parse('# ordinary notes', 'md'), /无法识别/);
});

test('counts invalid TXT payloads as skipped while retaining valid records', () => {
  const valid = JSON.stringify(fixture);
  const text = `MJPT_PROMPT_LIBRARY_V1\nMJPT_RECORD 4\nnope\nMJPT_RECORD ${valid.length}\n${valid}\n`;
  const result = parse(text, 'txt');
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.records, [fixture]);
});

test('counts invalid Markdown payloads as skipped while retaining valid records', () => {
  const valid = JSON.stringify(fixture);
  const text = `<!-- MJPT_PROMPT_LIBRARY_V1 -->\n\n\`\`\`mjpt-record\nnope\n\`\`\`\n\n\`\`\`mjpt-record\n${valid}\n\`\`\``;
  const result = parse(text, 'md');
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.records, [fixture]);
});

test('rejects unsupported formats and creates deterministic filenames', () => {
  assert.throws(() => serialize([], 'csv'), /格式/);
  assert.throws(() => parse('', 'csv'), /格式/);
  assert.equal(
    exportFilename('md', new Date('2026-09-19T10:00:00Z')),
    'mj-prompts-2026-09-19.md',
  );
  assert.equal(
    exportFilename('txt', new Date('2026-09-19T10:00:00Z')),
    'mj-prompts-2026-09-19.txt',
  );
});
