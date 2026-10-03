/**
 * 「选服务商 → 填 Key → 勾模型」向导的纯逻辑与编排。
 *
 * 用户反馈：不该让用户填 base URL / 协议预设 / 端点路径。这些由服务商预设表
 * 提供，客户端只负责：
 * 1) 把预设翻译成创建服务商/模型的请求体（buildProviderPayload/buildModelPayload）
 * 2) 把「拉取到的模型列表 + 预设推荐模型」合成可勾选候选（buildModelCandidates）
 * 3) 按顺序落库：服务商 → 凭据 → 模型（runQuickSetup）
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildProviderPayload,
  buildModelPayload,
  buildModelCandidates,
  runQuickSetup,
} from '../services/gatewaySetup';

const preset = {
  key: 'dashscope',
  name: '阿里云百炼（通义千问）',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  authType: 'bearer',
  hint: '',
  capabilities: {
    chat: { protocolPreset: 'openai-chat', endpointPath: '/chat/completions' },
    video: {
      protocolPreset: 'dashscope-video-async',
      endpointPath: '/v1/services/aigc/video-generation/video-synthesis',
      baseUrlOverride: 'https://dashscope.aliyuncs.com',
    },
  },
  suggestedModels: [{ apiModel: 'qwen-max', name: '通义千问 Max', capability: 'chat' }],
} as any;

describe('buildProviderPayload', () => {
  it('把预设翻译成创建服务商请求体（用户不填地址）', () => {
    expect(buildProviderPayload(preset, 'shared')).toEqual({
      name: preset.name,
      baseUrl: preset.baseUrl,
      authType: 'bearer',
      scope: 'shared',
    });
  });

  it('默认 scope=private（非管理员用户的合法选择）', () => {
    expect(buildProviderPayload(preset).scope).toBe('private');
  });
});

describe('buildModelPayload', () => {
  it('按能力套用预设的协议与端点，adapterKind 固定 gateway', () => {
    const payload = buildModelPayload(preset, 'prov-1', { apiModel: 'qwen-max', name: '通义千问 Max', capability: 'chat' });
    expect(payload).toMatchObject({
      providerId: 'prov-1',
      name: '通义千问 Max',
      apiModel: 'qwen-max',
      capability: 'chat',
      adapterKind: 'gateway',
      protocolPreset: 'openai-chat',
      endpointPath: '/chat/completions',
    });
    expect(payload.baseUrlOverride).toBeUndefined();
  });

  it('能力规格带 baseUrlOverride 时透传（同服务商不同能力不同根路径）', () => {
    const payload = buildModelPayload(preset, 'prov-1', { apiModel: 'wan2.2-t2v', name: '通义万相视频', capability: 'video' });
    expect(payload.protocolPreset).toBe('dashscope-video-async');
    expect(payload.baseUrlOverride).toBe('https://dashscope.aliyuncs.com');
  });

  it('预设不支持该能力 → 抛错（不允许配出必坏的模型）', () => {
    expect(() => buildModelPayload(preset, 'prov-1', { apiModel: 'x', name: 'x', capability: 'image' })).toThrow(/不支持|能力/);
  });
});

describe('buildModelCandidates', () => {
  it('预设推荐模型预勾选并带能力；拉取到的模型默认为对话能力', () => {
    const candidates = buildModelCandidates({
      preset,
      discovered: [{ apiModel: 'qwen-max' }, { apiModel: 'qwen-plus' }],
    });
    const byId = Object.fromEntries(candidates.map((c) => [c.apiModel, c]));
    expect(byId['qwen-max'].preselect).toBe(true);
    expect(byId['qwen-max'].capability).toBe('chat');
    expect(byId['qwen-plus'].preselect).toBe(true); // 拉取成功且无更多信息时预勾选少量
    expect(byId['qwen-max'].name).toBe('通义千问 Max');
  });

  it('去重：推荐与拉取重合只出现一次', () => {
    const candidates = buildModelCandidates({
      preset,
      discovered: [{ apiModel: 'qwen-max' }],
    });
    expect(candidates.filter((c) => c.apiModel === 'qwen-max')).toHaveLength(1);
  });

  it('拉取失败（空列表）时回退到推荐模型', () => {
    const candidates = buildModelCandidates({ preset, discovered: [] });
    expect(candidates.map((c) => c.apiModel)).toEqual(['qwen-max']);
    expect(candidates[0].preselect).toBe(true);
  });

  it('拉取到的模型过多时截断，避免界面卡死', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ apiModel: `m-${i}` }));
    const candidates = buildModelCandidates({ preset, discovered: many, limit: 50 });
    expect(candidates).toHaveLength(50);
  });

  it('只保留预设支持的能力，避免配出必坏的模型', () => {
    const candidates = buildModelCandidates({
      preset,
      discovered: [{ apiModel: 'only-chat' }],
    });
    expect(candidates.every((c) => c.capability in preset.capabilities)).toBe(true);
  });
});

describe('runQuickSetup 编排', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('按 服务商 → 凭据 → 模型 顺序落库，且 Key 只出现在凭据请求里', async () => {
    const calls: Array<{ url: string; method: string; body: any }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      calls.push({ url: String(url), method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
      if (String(url).endsWith('/providers')) {
        return { ok: true, status: 200, json: async () => ({ id: 'prov-1' }) };
      }
      if (String(url).endsWith('/credential')) return { ok: true, status: 200, json: async () => ({ success: true }) };
      if (String(url).endsWith('/models')) return { ok: true, status: 200, json: async () => ({ id: 'model-1' }) };
      return { ok: false, status: 404, json: async () => ({}) };
    }));

    const result = await runQuickSetup({
      preset,
      secret: 'sk-beijing-123',
      scope: 'shared',
      models: [
        { apiModel: 'qwen-max', name: '通义千问 Max', capability: 'chat' },
        { apiModel: 'wan2.2-t2v', name: '通义万相视频', capability: 'video' },
      ],
    });

    expect(result.providerId).toBe('prov-1');
    expect(result.createdModels).toBe(2);
    expect(calls.map((c) => c.url.replace(/^.*\/api/, ''))).toEqual([
      '/model-invocations/providers',
      '/model-invocations/providers/prov-1/credential',
      '/model-invocations/models',
      '/model-invocations/models',
    ]);
    expect(calls[0].body.baseUrl).toBe(preset.baseUrl);
    expect(calls[1].body.secret).toBe('sk-beijing-123');
    const modelBody = calls[3].body;
    expect(modelBody.baseUrlOverride).toBe('https://dashscope.aliyuncs.com');
    // Key 绝不进模型请求
    expect(JSON.stringify(calls.slice(2))).not.toContain('sk-beijing-123');
  });

  it('凭据落库失败 → 抛出并带上服务商 id，便于前端提示「已建服务商，补 Key 即可」', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).endsWith('/providers')) return { ok: true, status: 200, json: async () => ({ id: 'prov-9' }) };
      return { ok: false, status: 400, json: async () => ({ error: { code: 'INVALID_PARAMS', message: 'secret is required' } }) };
    }));

    await expect(
      runQuickSetup({ preset, secret: '', scope: 'shared', models: [{ apiModel: 'qwen-max', name: 'q', capability: 'chat' }] })
    ).rejects.toMatchObject({ providerId: 'prov-9' });
  });
});

describe('两段式：connectProvider + addSelectedModels（拉取模型前必须先存好 Key）', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('connectProvider 先建服务商再存 Key，返回 providerId', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(String(url));
      if (String(url).endsWith('/providers')) return { ok: true, status: 200, json: async () => ({ id: 'prov-2' }) };
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    }));
    const { connectProvider } = await import('../services/gatewaySetup');
    const result = await connectProvider({ preset, secret: 'sk-2', scope: 'shared' });
    expect(result.providerId).toBe('prov-2');
    expect(urls.map((u) => u.replace(/^.*\/api/, ''))).toEqual([
      '/model-invocations/providers',
      '/model-invocations/providers/prov-2/credential',
    ]);
  });

  it('addSelectedModels 逐个创建并返回数量', async () => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ id: `m-${bodies.length}` }) };
    }));
    const { addSelectedModels } = await import('../services/gatewaySetup');
    const result = await addSelectedModels({
      preset,
      providerId: 'prov-3',
      models: [
        { apiModel: 'qwen-max', name: '通义千问 Max', capability: 'chat' },
        { apiModel: 'wan-video', name: '通义万相视频', capability: 'video' },
      ],
    });
    expect(result.createdModels).toBe(2);
    expect(bodies[0].capability).toBe('chat');
    expect(bodies[1].protocolPreset).toBe('dashscope-video-async');
  });
});

describe('describeMissingCapabilities（流程缺口提示）', () => {
  it('缺图像能力 → 明确告知定形象/关键帧会失败并给出建议服务商', async () => {
    const { describeMissingCapabilities } = await import('../services/gatewaySetup');
    const gaps = describeMissingCapabilities([{ capability: 'chat' }, { capability: 'video' }]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].capability).toBe('image');
    expect(gaps[0].stage).toContain('定形象');
    expect(gaps[0].suggestion).toContain('火山方舟');
  });

  it('三种能力齐备 → 无缺口', async () => {
    const { describeMissingCapabilities } = await import('../services/gatewaySetup');
    const gaps = describeMissingCapabilities([{ capability: 'chat' }, { capability: 'image' }, { capability: 'video' }]);
    expect(gaps).toEqual([]);
  });

  it('一个模型都没有 → 三个缺口都提示（而不是静默）', async () => {
    const { describeMissingCapabilities } = await import('../services/gatewaySetup');
    const gaps = describeMissingCapabilities([]);
    expect(gaps.map((g) => g.capability).sort()).toEqual(['chat', 'image', 'video']);
  });

  it('同一能力有多个模型也只报一次缺口', async () => {
    const { describeMissingCapabilities } = await import('../services/gatewaySetup');
    const gaps = describeMissingCapabilities([{ capability: 'chat' }, { capability: 'chat' }]);
    expect(gaps.map((g) => g.capability)).toEqual(['image', 'video']);
  });
});

describe('coverageLabel（服务商覆盖度文案）', () => {
  it('三档覆盖度都有人话标签', async () => {
    const { coverageLabel } = await import('../services/gatewaySetup');
    expect(coverageLabel('full')).toBe('全流程');
    expect(coverageLabel('partial')).toBe('部分环节');
    expect(coverageLabel('chat-only')).toBe('仅对话');
  });
});

describe('capabilityWorkflowLabels（环节徽章文案）', () => {
  it('把工作流翻成用户看得懂的中文，并去掉对话这种非画面环节', async () => {
    const { capabilityWorkflowLabels } = await import('../services/gatewaySetup');
    const labels = capabilityWorkflowLabels({
      chat: { protocolPreset: 'openai-chat', endpointPath: '/x', workflows: ['text'] },
      image: { protocolPreset: 'openai-image', endpointPath: '/y', workflows: ['text2image', 'image2image'] },
      video: { protocolPreset: 'ark-video-async', endpointPath: '/z', workflows: ['text2video', 'image2video'] },
    } as any);
    expect(labels).toEqual(['文生图', '图生图', '文生视频', '图生视频']);
  });
});
