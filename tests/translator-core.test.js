const test = require('node:test');
const assert = require('node:assert/strict');

const {
  translateFree,
  translateOpenAI,
  normalizeHttpError,
  normalizeThrownError,
} = require('../shared/translator-core.js');

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

test('free provider encodes Chinese input and joins chunk responses', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(new URL(url));
    return jsonResponse(200, { responseData: { translatedText: 'translated' } });
  };

  const result = await translateFree('中文'.repeat(300), fetchImpl);
  assert.ok(calls.length > 1);
  assert.equal(result.split(' ').length, calls.length);
  assert.ok(calls.every((url) => url.searchParams.get('langpair') === 'zh-CN|en'));
  assert.ok(calls.every((url) => Buffer.byteLength(url.searchParams.get('q'), 'utf8') <= 500));
});

test('OpenAI provider sends only the configured endpoint and bearer key', async () => {
  let observed;
  const fetchImpl = async (url, init) => {
    observed = { url, init };
    return jsonResponse(200, { choices: [{ message: { content: 'cinematic clouds' } }] });
  };

  const result = await translateOpenAI('云海', {
    endpoint: 'https://api.example.com/v1/chat/completions',
    apiKey: 'secret',
    model: 'model-a',
  }, fetchImpl);

  assert.equal(result, 'cinematic clouds');
  assert.equal(observed.url, 'https://api.example.com/v1/chat/completions');
  assert.equal(observed.init.method, 'POST');
  assert.equal(observed.init.headers.Authorization, 'Bearer secret');
  const body = JSON.parse(observed.init.body);
  assert.equal(body.model, 'model-a');
  assert.equal(body.messages.at(-1).content, '云海');
});

test('OpenAI response removes code fences and wrapping quotes', async () => {
  const fetchImpl = async () => jsonResponse(200, {
    choices: [{ message: { content: '```text\n"a luminous palace"\n```' } }],
  });
  const result = await translateOpenAI('宫殿', {
    endpoint: 'https://api.example.com/v1/chat/completions', apiKey: 'key', model: 'm',
  }, fetchImpl);
  assert.equal(result, 'a luminous palace');
});

for (const [status, code] of [[401, 'AUTH'], [403, 'AUTH'], [429, 'RATE_LIMIT'], [500, 'SERVER']]) {
  test(`HTTP ${status} maps to ${code}`, () => {
    assert.equal(normalizeHttpError(status, 'details').code, code);
  });
}

test('malformed free response is rejected', async () => {
  await assert.rejects(
    () => translateFree('中文', async () => jsonResponse(200, { responseData: {} })),
    (error) => error.code === 'BAD_RESPONSE',
  );
});

test('malformed OpenAI response is rejected', async () => {
  await assert.rejects(
    () => translateOpenAI('中文', {
      endpoint: 'https://api.example.com/v1/chat/completions', apiKey: 'key', model: 'm',
    }, async () => jsonResponse(200, { choices: [] })),
    (error) => error.code === 'BAD_RESPONSE',
  );
});

test('AbortError maps to a timeout error', () => {
  const error = new Error('aborted');
  error.name = 'AbortError';
  assert.equal(normalizeThrownError(error).code, 'TIMEOUT');
});

test('network errors map without exposing secrets', () => {
  const error = normalizeThrownError(new Error('fetch failed for Bearer secret'));
  assert.equal(error.code, 'NETWORK');
  assert.doesNotMatch(error.message, /secret/);
});
