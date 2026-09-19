const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULTS,
  normalizeConfig,
  providerPreset,
  endpointOrigin,
  requestEndpointPermission,
} = require('../shared/config.js');

test('defaults select DeepSeek translation and omit quality/HD', () => {
  assert.equal(DEFAULTS.provider, 'deepseek');
  assert.equal(DEFAULTS.params.aspectRatio, '16:9');
  assert.equal(DEFAULTS.params.stylize, 450);
  assert.equal(DEFAULTS.params.chaos, 8);
  assert.equal(DEFAULTS.params.quality, '');
  assert.equal(DEFAULTS.params.hd, false);
});

test('normalization accepts only known provider and parameter values', () => {
  const value = normalizeConfig({
    provider: 'bad',
    params: { quality: '3', chaos: 999, stylize: -4, aspectRatio: 'wide' },
  });

  assert.equal(value.provider, 'deepseek');
  assert.equal(value.params.quality, '');
  assert.equal(value.params.chaos, 100);
  assert.equal(value.params.stylize, 0);
  assert.equal(value.params.aspectRatio, '16:9');
});

test('normalization retains provider credentials as strings', () => {
  const value = normalizeConfig({
    provider: 'qwen',
    providers: {
      qwen: {
        endpoint: ' https://example.com/v1/chat/completions ',
        apiKey: ' key-value ',
        model: ' custom-model ',
      },
    },
  });

  assert.equal(value.providers.qwen.endpoint, 'https://example.com/v1/chat/completions');
  assert.equal(value.providers.qwen.apiKey, ' key-value ');
  assert.equal(value.providers.qwen.model, 'custom-model');
});

test('preset and origin are deterministic', () => {
  const deepseek = providerPreset('deepseek');
  assert.match(deepseek.endpoint, /chat\/completions$/);
  assert.equal(deepseek.model, 'deepseek-flash');
  assert.equal(
    endpointOrigin('https://api.example.com/v1/chat/completions'),
    'https://api.example.com/*',
  );
});

test('origin helper rejects credentials and non-http protocols', () => {
  assert.throws(() => endpointOrigin('javascript:alert(1)'));
  assert.throws(() => endpointOrigin('https://user:pass@example.com/v1'));
});

test('origin helper keeps custom port but drops path', () => {
  assert.equal(
    endpointOrigin('http://localhost:8080/v1/chat/completions'),
    'http://localhost:8080/*',
  );
});

test('permission request stays in the original user gesture without a preliminary await', async () => {
  const calls = [];
  const permissions = {
    contains() { calls.push('contains'); return Promise.resolve(false); },
    request(payload) { calls.push({ request: payload }); return Promise.resolve(true); },
  };

  const granted = await requestEndpointPermission(
    permissions,
    'https://api.example.com/v1/chat/completions',
  );

  assert.equal(granted, true);
  assert.deepEqual(calls, [{ request: { origins: ['https://api.example.com/*'] } }]);
});
