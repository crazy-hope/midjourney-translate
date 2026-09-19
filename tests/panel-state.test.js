const test = require('node:test');
const assert = require('node:assert/strict');

let markPreviewStale;
let setPreviewResult;
let isPreviewFresh;
let syncInstructionAvailability;
try {
  ({
    markPreviewStale,
    setPreviewResult,
    isPreviewFresh,
    syncInstructionAvailability,
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
