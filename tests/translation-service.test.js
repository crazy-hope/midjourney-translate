const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeConfig } = require('../shared/config.js');

let run;
try {
  ({ run } = require('../shared/translation-service.js'));
} catch {
  run = undefined;
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

test('unsaved provider selection routes the next request and reports the actual provider', async () => {
  assert.equal(typeof run, 'function');
  const calls = [];
  const settings = normalizeConfig({
    provider: 'free',
    providers: {
      deepseek: {
        endpoint: 'https://api.deepseek.test/chat/completions',
        apiKey: 'key',
        model: 'deepseek-chat',
      },
    },
  });
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return jsonResponse(200, { choices: [{ message: { content: 'cinematic palace' } }] });
  };

  const result = await run({
    text: '宫殿', provider: 'deepseek', purpose: 'prompt', instruction: '',
  }, settings, fetchImpl);

  assert.equal(result.provider, 'deepseek');
  assert.deepEqual(calls, ['https://api.deepseek.test/chat/completions']);
  assert.equal(settings.provider, 'free');
});

test('free selection uses MyMemory instead of the configured model endpoint', async () => {
  assert.equal(typeof run, 'function');
  const calls = [];
  const settings = normalizeConfig({ provider: 'deepseek' });
  const result = await run({ text: '宫殿', provider: 'free', purpose: 'prompt' }, settings, async (url) => {
    calls.push(String(url));
    return jsonResponse(200, { responseData: { translatedText: 'palace' } });
  });
  assert.equal(result.provider, 'free');
  assert.match(calls[0], /^https:\/\/api\.mymemory\.translated\.net\//);
});
