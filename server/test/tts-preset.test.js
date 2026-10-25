import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTtsRequest, parseTtsResponse } from '../model-gateway/presets.js';

test('tts preset: openai-compatible /audio/speech binary', () => {
  const built = buildTtsRequest({ apiModel: 'tts-1', text: '漫剧工场', voice: 'alloy', speed: 1.1 });
  assert.equal(built.jsonBody.model, 'tts-1');
  assert.equal(built.jsonBody.input, '漫剧工场');
  assert.equal(built.jsonBody.voice, 'alloy');
  assert.equal(built.jsonBody.response_format, 'mp3');
  const audio = parseTtsResponse(Buffer.from('ID3fake-mp3'), 'audio/mpeg');
  assert.ok(Buffer.isBuffer(audio.buffer));
  assert.equal(audio.contentType, 'audio/mpeg');
  assert.throws(() => parseTtsResponse(Buffer.from(''), 'audio/mpeg'));
});
