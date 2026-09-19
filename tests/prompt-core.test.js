const test = require('node:test');
const assert = require('node:assert/strict');

const {
  splitPromptAndParams,
  composePrompt,
  splitUtf8,
  splitPromptParagraphs,
  buildBilingualResult,
  ASPECT_RATIO_OPTIONS,
} = require('../shared/prompt-core.js');

const defaults = {
  aspectRatio: '16:9',
  stylize: 450,
  chaos: 8,
  quality: '',
  hd: false,
};

test('preserves a complete parameter tail including --no words', () => {
  assert.deepEqual(splitPromptAndParams('一只猫 --no red eyes text --ar 4:3'), {
    text: '一只猫',
    params: '--no red eyes text --ar 4:3',
  });
});

test('handles empty and whitespace-only input', () => {
  assert.deepEqual(splitPromptAndParams('   '), { text: '', params: '' });
});

test('handwritten parameters win and controls fill only missing values', () => {
  const result = composePrompt('a cat', '--ar 4:3 --chaos 2', {
    ...defaults,
    hd: true,
  });
  assert.equal(result, 'a cat --ar 4:3 --chaos 2 --stylize 450 --hd');
});

test('long aliases prevent duplicate short controls', () => {
  const result = composePrompt('cloud city', '--aspect 3:2 --s 99 --c 4 --q 2 --hd', {
    ...defaults,
    quality: '4',
    hd: true,
  });
  assert.equal(result, 'cloud city --aspect 3:2 --s 99 --c 4 --q 2 --hd');
});

test('preserves spacing inside handwritten parameter values', () => {
  const result = composePrompt('a portrait', '--no red  eyes   text', {
    aspectRatio: '', stylize: '', chaos: '', quality: '', hd: false,
  });
  assert.equal(result, 'a portrait --no red  eyes   text');
});

test('quality supports known values and auto emits nothing', () => {
  assert.equal(
    composePrompt('a bird', '', { ...defaults, quality: '' }),
    'a bird --ar 16:9 --stylize 450 --chaos 8',
  );
  for (const quality of ['1', '2', '4']) {
    assert.match(composePrompt('a bird', '', { ...defaults, quality }), new RegExp(`--quality ${quality}$`));
  }
});

test('HD is emitted only when enabled', () => {
  assert.doesNotMatch(composePrompt('a bird', '', defaults), /--hd/);
  assert.match(composePrompt('a bird', '', { ...defaults, hd: true }), /--hd$/);
});

test('chunks never exceed 500 bytes or split characters', () => {
  const original = '飞天壁画，'.repeat(150);
  const chunks = splitUtf8(original, 500);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((part) => Buffer.byteLength(part, 'utf8') <= 500));
  assert.equal(chunks.join(''), original);
});

test('chunks prefer punctuation and preserve ASCII spaces exactly', () => {
  const original = 'first clause, second clause; third clause';
  const chunks = splitUtf8(original, 20);
  assert.deepEqual(chunks, ['first clause, ', 'second clause; ', 'third clause']);
  assert.equal(chunks.join(''), original);
});

test('rejects invalid byte limit', () => {
  assert.throws(() => splitUtf8('text', 0), /positive/);
});

test('splits prompts at blank lines while keeping each paragraph intact', () => {
  assert.deepEqual(
    splitPromptParagraphs('第一句。\n第二句。\n\n 另一个完整段落。 '),
    ['第一句。\n第二句。', '另一个完整段落。'],
  );
});

test('builds bilingual preview but keeps the MJ result English-only', () => {
  assert.deepEqual(
    buildBilingualResult(
      ['云海中的宫殿。', '金色晨光。'],
      ['A palace amid a sea of clouds.', 'Golden morning light.'],
    ),
    {
      preview: '云海中的宫殿。\nA palace amid a sea of clouds.\n\n金色晨光。\nGolden morning light.',
      english: 'A palace amid a sea of clouds.\n\nGolden morning light.',
    },
  );
});

test('offers the requested aspect ratios from portrait through landscape', () => {
  assert.deepEqual(ASPECT_RATIO_OPTIONS, [
    '1:2', '6:11', '9:16', '2:3', '3:4', '4:5', '5:6', '1:1',
    '6:5', '5:4', '4:3', '3:2', '16:9', '11:6', '2:1',
  ]);
});
