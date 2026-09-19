const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findComposer,
  setComposerValue,
  mountKey,
  isWithinInteractionScope,
  findPanelHost,
  panelViewportPlacement,
} = require('../content/dom-adapter.js');

function fakeTextarea(events) {
  return {
    tagName: 'TEXTAREA',
    value: '',
    isContentEditable: false,
    dispatchEvent(event) { events.push(event.type); return true; },
  };
}

function fakeContentEditable(events) {
  return {
    tagName: 'DIV',
    textContent: '',
    isContentEditable: true,
    dispatchEvent(event) { events.push(event.type); return true; },
  };
}

function candidate({ placeholder = '', role = '', type = '', inPanel = false, inForm = true } = {}) {
  return {
    tagName: 'TEXTAREA',
    disabled: false,
    isContentEditable: false,
    getAttribute(name) {
      return { placeholder, 'aria-label': placeholder, role, type }[name] || '';
    },
    closest(selector) {
      if (selector === '#mjpt-panel') return inPanel ? {} : null;
      if (selector === 'form') return inForm ? {} : null;
      return null;
    },
    getBoundingClientRect() { return { width: 400, height: 60 }; },
  };
}

test('setComposerValue dispatches input and change for textarea', () => {
  const events = [];
  const element = fakeTextarea(events);
  setComposerValue(element, 'translated prompt');
  assert.equal(element.value, 'translated prompt');
  assert.deepEqual(events, ['input', 'change']);
});

test('contenteditable receives text without submitting', () => {
  const events = [];
  const element = fakeContentEditable(events);
  setComposerValue(element, 'translated prompt');
  assert.equal(element.textContent, 'translated prompt');
  assert.ok(!events.includes('keydown'));
  assert.deepEqual(events, ['input', 'change']);
});

test('findComposer favors an imagine prompt and rejects search or injected fields', () => {
  const search = candidate({ placeholder: 'Search creations', type: 'search' });
  const injected = candidate({ placeholder: 'Prompt', inPanel: true });
  const prompt = candidate({ placeholder: 'What will you imagine?' });
  const root = { querySelectorAll: () => [search, injected, prompt] };
  assert.equal(findComposer(root), prompt);
});

test('findComposer refuses unrelated generic textareas', () => {
  const root = { querySelectorAll: () => [candidate({ placeholder: 'Write a comment', inForm: false })] };
  assert.equal(findComposer(root), null);
});

test('mount identity follows composer replacement', () => {
  assert.equal(mountKey({ isConnected: true }, { isConnected: true }), 'keep');
  assert.equal(mountKey({ isConnected: false }, { isConnected: true }), 'replace');
  assert.equal(mountKey({ isConnected: true }, { isConnected: false }), 'replace');
});

test('MJ composer and translator controls share one interaction scope', () => {
  const composerChild = {};
  const panelControl = {};
  const composer = { contains: (target) => target === composerChild };
  const panel = { contains: (target) => target === panelControl };

  assert.equal(isWithinInteractionScope(composer, panel, composer), true);
  assert.equal(isWithinInteractionScope(composer, panel, composerChild), true);
  assert.equal(isWithinInteractionScope(composer, panel, panelControl), true);
});

test('page translation switches stay inside the translator interaction scope', () => {
  const translatePageSwitch = { name: 'translate-page' };
  const keepOriginalSwitch = { name: 'keep-original' };
  const composer = { contains: () => false };
  const panel = {
    contains: (target) => [translatePageSwitch, keepOriginalSwitch].includes(target),
  };

  assert.equal(isWithinInteractionScope(composer, panel, translatePageSwitch), true);
  assert.equal(isWithinInteractionScope(composer, panel, keepOriginalSwitch), true);
});

test('elements outside the MJ interaction scope allow the panel to hide', () => {
  const composer = { contains: () => false };
  const panel = { contains: () => false };

  assert.equal(isWithinInteractionScope(composer, panel, {}), false);
  assert.equal(isWithinInteractionScope(composer, panel, null), false);
});

test('mounts the extension inside the MJ form with a parent fallback', () => {
  const form = {};
  const parent = {};
  const composerInForm = { parentElement: parent, closest: () => form };
  const composerWithoutForm = { parentElement: parent, closest: () => null };

  assert.equal(findPanelHost(composerInForm), form);
  assert.equal(findPanelHost(composerWithoutForm), parent);
});

test('places an embedded panel below the host without changing host layout', () => {
  const host = {
    getBoundingClientRect: () => ({ left: 36, bottom: 124, width: 760 }),
  };

  assert.deepEqual(panelViewportPlacement(host), {
    left: 36,
    top: 132,
    width: 760,
  });
});
