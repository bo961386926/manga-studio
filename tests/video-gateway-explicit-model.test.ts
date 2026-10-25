/**
 * 网关视频任务的显式模型解析（多服务商改造）：
 * - generateVideoGatewayJob 不再看客户端目录的"激活模型"adapter_kind（那条
 *   路径对种子模型永远不成立，等于死路），改为经统一解析器解析显式 modelId
 *   （选择器新值 = 网关模型 id），单模型场景仍自动采用；
 * - 没有可用网关视频模型时给出可执行中文报错。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const videoModel = {
  id: 'gw-v',
  name: '网关视频',
  apiModel: 'seedance-1',
  capability: 'video',
  adapterKind: 'gateway',
  endpointPath: '/videos',
  accessLevel: 'verified',
  enabled: true,
  providerScope: 'shared',
  providerName: '测试服务商',
};

const stubFetch = (models: unknown[]) =>
  vi.fn(async (url: string) => {
    if (String(url).includes('/model-invocations/models')) {
      return { ok: true, status: 200, json: async () => ({ models }) };
    }
    if (String(url).includes('/model-invocations/invocations')) {
      return { ok: true, status: 200, json: async () => ({ schemaVersion: 1, kind: 'job', jobId: 'job-1' }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });

describe('generateVideoGatewayJob（显式模型解析）', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    const { invalidateGatewayModelCache } = await import('../services/gatewayModels');
    invalidateGatewayModelCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('显式 modelId → 按统一解析器路由并提交该模型', async () => {
    const fetchMock = stubFetch([videoModel]);
    vi.stubGlobal('fetch', fetchMock);
    const { generateVideoGatewayJob } = await import('../services/modelService');
    const accepted = await generateVideoGatewayJob({
      prompt: '一段视频',
      aspectRatio: '16:9',
      duration: 8,
      modelId: 'gw-v',
    } as any);
    expect((accepted as any).jobId).toBe('job-1');
    const invCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/invocations'));
    expect(JSON.parse((invCall as any)[1].body).modelId).toBe('gw-v');
  });

  it('没有可用网关视频模型 → 明确中文报错', async () => {
    vi.stubGlobal('fetch', stubFetch([]));
    const { generateVideoGatewayJob } = await import('../services/modelService');
    await expect(generateVideoGatewayJob({ prompt: '一段视频' } as any)).rejects.toThrow(/网关视频模型/);
  });
});
