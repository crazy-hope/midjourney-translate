const test = require('node:test');
const assert = require('node:assert/strict');

let markPreviewStale;
let setPreviewResult;
let isPreviewFresh;
let syncInstructionAvailability;
let formatPromptOption;
let filterPromptRecords;
let canUpdateSelectedPrompt;
let coalesceRoots;
try {
  ({
    markPreviewStale,
    setPreviewResult,
    isPreviewFresh,
    syncInstructionAvailability,
    formatPromptOption,
    filterPromptRecords,
    canUpdateSelectedPrompt,
    coalesceRoots,
  } = require('../content/panel-state.js'));
} catch {
  markPreviewStale = undefined;
}

test('editing keeps the prior preview visible but marks its English stale', () => {
  assert.equal(typeof markPreviewStale, 'function');
  const preview = { value: '云海\nCloud sea', dataset: { english: 'Cloud sea' } };
  markPreviewStale(preview);
  assert.equal(preview.value, '云海\nCloud sea');
  assert.equal(preview.dataset.stale, 'true');
  assert.equal(isPreviewFresh(preview), false);
});

test('a completed translation replaces preview and becomes fillable', () => {
  assert.equal(typeof setPreviewResult, 'function');
  const preview = { value: 'old', dataset: { english: 'old', stale: 'true' } };
  setPreviewResult(preview, '宫殿\nPalace', 'Palace');
  assert.equal(preview.value, '宫殿\nPalace');
  assert.equal(preview.dataset.english, 'Palace');
  assert.equal(isPreviewFresh(preview), true);
});

test('an in-flight result stays visible but stale when the source changed', () => {
  const preview = { value: '', dataset: {} };
  setPreviewResult(preview, '宫殿\nPalace', 'Palace', true);
  assert.equal(preview.value, '宫殿\nPalace');
  assert.equal(preview.dataset.english, 'Palace');
  assert.equal(preview.dataset.stale, 'true');
  assert.equal(isPreviewFresh(preview), false);
});

test('free provider disables guidance while model providers enable it', () => {
  assert.equal(typeof syncInstructionAvailability, 'function');
  const select = { value: 'free' };
  const input = { disabled: false };
  const note = { hidden: true };
  syncInstructionAvailability(select, input, note);
  assert.equal(input.disabled, true);
  assert.equal(note.hidden, false);
  select.value = 'deepseek';
  syncInstructionAvailability(select, input, note);
  assert.equal(input.disabled, false);
  assert.equal(note.hidden, true);
});

test('duplicate prompt titles are disambiguated by date and remain searchable', () => {
  assert.equal(typeof filterPromptRecords, 'function');
  const records = [
    { id: 'a', title: '云宫', date: '2026-09-18T10:00:00.000Z' },
    { id: 'b', title: '云宫', date: '2026-09-19T10:00:00.000Z' },
    { id: 'c', title: '森林', date: '2026-09-19T10:00:00.000Z' },
  ];
  assert.deepEqual(filterPromptRecords(records, '云宫').map(formatPromptOption), [
    '云宫 · 2026-09-18', '云宫 · 2026-09-19',
  ]);
});

test('selected stale or missing preview cannot update a stored prompt', () => {
  assert.equal(typeof canUpdateSelectedPrompt, 'function');
  assert.equal(canUpdateSelectedPrompt('id-1', { dataset: { english: 'Old', stale: 'true' } }), false);
  assert.equal(canUpdateSelectedPrompt('', { dataset: { english: 'Current' } }), false);
  assert.equal(canUpdateSelectedPrompt('id-1', { dataset: { english: 'Current' } }), true);
});

test('nested mutation roots are coalesced to their highest ancestor', () => {
  assert.equal(typeof coalesceRoots, 'function');
  const child = {};
  const sibling = {};
  const parent = { contains: (node) => node === child };
  assert.deepEqual(coalesceRoots([child, parent, sibling, child]), [parent, sibling]);
});
