/**
 * Gateway client characterization: the browser must send only modelId +
 * business params + Idempotency-Key; never targetUrl or credentials.
 */
import { describe, it, expect, vi } from 'vitest';
import { invokeChat } from '../services/modelGatewayClient';

function fakeFetch() {
  const calls: any[] = [];
  const fn = vi.fn(async (url: string, init: any) => {
    calls.push({ url, body: init?.body, headers: init?.headers });
    return {
      ok: true,
      status: 200,
      json: async () => ({ schemaVersion: 1, kind: 'chat', content: 'ok', responseFormat: 'text' }),
    };
  });
  return { fn, calls };
}

describe('gateway client', () => {
  it('sends modelId and idempotency key but never targetUrl or credential', async () => {
    const { fn, calls } = fakeFetch();
    // Make apiFetch use our fake: it calls global fetch under /api prefix.
    vi.stubGlobal('fetch', fn);
    try {
      await invokeChat('m1', { prompt: 'hi' }, 'k-1');
    } finally {
      vi.unstubAllGlobals();
    }
    expect(calls.length).toBe(1);
    const body = calls[0].body as string;
    expect(body).toContain('"modelId":"m1"');
    expect(body).toContain('"prompt":"hi"');
    expect(body).not.toContain('targetUrl');
    expect(body).not.toContain('apiKey');
    expect(body).not.toContain('Authorization');
    expect(calls[0].headers['Idempotency-Key']).toBe('k-1');
  });
});
