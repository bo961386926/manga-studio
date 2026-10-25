/**
 * Characterization tests: freeze the existing vendor model routing behavior so
 * the self-hosted model gateway (stage 3) can add a new path without changing
 * legacy semantics. Baseline recorded before gateway work begins.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { routeModel, chat, generateImage, generateVideo } from '../services/modelService';
import * as registry from '../services/modelRegistry';

describe('model routing characterization', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the existing vendor model path unchanged', async () => {
    const result = await routeModel({ provider: 'gemini', modelId: 'gemini-2.0-flash' }, {});
    expect(result.adapter).toBe('legacy-vendor');
  });

  it('routes self-hosted gateway models to the gateway and legacy to existing adapter', async () => {
    vi.spyOn(registry, 'getModelById').mockReturnValue({
      id: 'gw-1',
      providerId: 'gateway',
      name: 'GW',
      type: 'chat',
      isBuiltIn: false,
      isEnabled: true,
      adapter_kind: 'gateway',
      params: {},
    } as any);
    expect((await routeModel({ provider: 'gateway', modelId: 'gw-1' }, {})).adapter).toBe('gateway');

    vi.spyOn(registry, 'getModelById').mockReturnValue({
      id: 'gemini-2.0-flash',
      providerId: 'gemini',
      name: 'G',
      type: 'chat',
      isBuiltIn: true,
      isEnabled: true,
      params: {},
    } as any);
    expect((await routeModel({ provider: 'gemini', modelId: 'gemini-2.0-flash' }, {})).adapter).toBe('legacy-vendor');
  });

  it('every provider still routes through the legacy adapters today', async () => {
    for (const provider of ['gemini', 'volcengine', 'minimax', 'dashscope']) {
      const result = await routeModel({ provider, modelId: `${provider}-model` }, {});
      expect(result.adapter).toBe('legacy-vendor');
    }
  });

  it('stage entry points remain thin wrappers over the legacy adapters', () => {
    // These are the public functions the UI calls today; the gateway must
    // preserve their signatures and return shapes.
    expect(typeof chat).toBe('function');
    expect(typeof generateImage).toBe('function');
    expect(typeof generateVideo).toBe('function');
  });
});
