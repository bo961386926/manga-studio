/**
 * 网关模型解析器（改造后的唯一解析口）。
 *
 * 背景：旧解析只按 name/apiModel 匹配 + 单模型自动采用，选择器又只列客户端
 * 旧目录，导致多服务商/多模型永远选不中。改造后：
 * - 选择器值 = 网关模型 id，解析器 id 精确匹配优先（新增）
 * - name / apiModel 匹配保留（兼容旧存量值）
 * - 该能力只有 1 个模型时自动采用（保留，单模型部署最省心）
 * - 0 个，或多个且都不匹配 → null（由调用方走明确报错路径）
 * - 禁用/已删除模型永不解析
 * - 每能力"默认模型"优先于"第一个"——全局切换真正生效的机制
 * - 选择器选项构建 + 值失效自动采用为纯函数（UI 层薄壳）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  usableGatewayModels,
  resolveGatewayModelFrom,
  preferredGatewayModelFrom,
  shouldAdoptGatewayModel,
  buildGatewayModelOptions,
  loadGatewayModels,
  invalidateGatewayModelCache,
  getPreferredGatewayModel,
} from '../services/gatewayModels';
import type { ModelDTO } from '../types/modelGateway';

const m = (over: Partial<ModelDTO> & { id: string }): ModelDTO => ({
  name: `模型${over.id}`,
  apiModel: `api-${over.id}`,
  capability: 'chat',
  adapterKind: 'gateway',
  endpointPath: '/chat/completions',
  accessLevel: 'verified',
  enabled: true,
  providerScope: 'shared',
  providerName: '测试服务商',
  ...over,
});

describe('usableGatewayModels', () => {
  it('只保留该能力下启用的模型', () => {
    const models = [
      m({ id: 'c1', capability: 'chat' }),
      m({ id: 'c2', capability: 'chat', enabled: false }),
      m({ id: 'i1', capability: 'image' }),
    ];
    const usable = usableGatewayModels(models, 'chat');
    expect(usable.map((x) => x.id)).toEqual(['c1']);
  });
});

describe('resolveGatewayModelFrom', () => {
  it('按 id 精确匹配（新选择器值的解析路径）', () => {
    const models = [
      m({ id: 'gw-a', name: '千问 Max', apiModel: 'qwen-max' }),
      m({ id: 'gw-b', name: '豆包 Pro', apiModel: 'doubao-pro' }),
    ];
    expect(resolveGatewayModelFrom(models, 'chat', 'gw-b')?.id).toBe('gw-b');
  });

  it('按显示名匹配（兼容旧存量值）', () => {
    const models = [
      m({ id: 'gw-a', name: '千问 Max' }),
      m({ id: 'gw-b', name: '豆包 Pro' }),
    ];
    expect(resolveGatewayModelFrom(models, 'chat', '豆包 Pro')?.id).toBe('gw-b');
  });

  it('按 apiModel 匹配', () => {
    const models = [
      m({ id: 'gw-a', apiModel: 'qwen-max' }),
      m({ id: 'gw-b', apiModel: 'doubao-pro' }),
    ];
    expect(resolveGatewayModelFrom(models, 'chat', 'doubao-pro')?.id).toBe('gw-b');
  });

  it('能力只有 1 个模型时自动采用（无视传入名）', () => {
    const models = [m({ id: 'gw-only', name: '唯一模型', capability: 'video' })];
    expect(resolveGatewayModelFrom(models, 'video', '随便什么旧值')?.id).toBe('gw-only');
  });

  it('同能力多个模型且传入名不匹配 → null（不瞎猜）', () => {
    const models = [
      m({ id: 'gw-a' }),
      m({ id: 'gw-b' }),
    ];
    expect(resolveGatewayModelFrom(models, 'chat', 'doubao-pro-32k')).toBeNull();
  });

  it('禁用模型不参与解析：剩余唯一启用模型仍被自动采用', () => {
    const models = [
      m({ id: 'gw-a', enabled: false }),
      m({ id: 'gw-b' }),
    ];
    expect(resolveGatewayModelFrom(models, 'chat', '不存在的名字')?.id).toBe('gw-b');
  });

  it('该能力 0 个模型 → null', () => {
    expect(resolveGatewayModelFrom([m({ id: 'c1', capability: 'image' })], 'video', 'gw-x')).toBeNull();
  });

  it('不传名字且该能力恰有 1 个 → 自动采用；多个 → null', () => {
    expect(resolveGatewayModelFrom([m({ id: 's1' })], 'chat', undefined)?.id).toBe('s1');
    expect(resolveGatewayModelFrom([m({ id: 'a' }), m({ id: 'b' })], 'chat', undefined)).toBeNull();
  });
});

describe('preferredGatewayModelFrom（全局默认优先）', () => {
  const models = [m({ id: 'gw-a' }), m({ id: 'gw-b' })];

  it('默认模型有效 → 用默认', () => {
    expect(preferredGatewayModelFrom(models, 'chat', { chat: 'gw-b' })?.id).toBe('gw-b');
  });

  it('默认模型已失效（不在可用列表）→ 回退第一个', () => {
    expect(preferredGatewayModelFrom(models, 'chat', { chat: 'gw-deleted' })?.id).toBe('gw-a');
  });

  it('未设默认 → 第一个', () => {
    expect(preferredGatewayModelFrom(models, 'chat', {})?.id).toBe('gw-a');
    expect(preferredGatewayModelFrom(models, 'chat', undefined)?.id).toBe('gw-a');
  });

  it('无可用模型 → null', () => {
    expect(preferredGatewayModelFrom([], 'chat', { chat: 'gw-a' })).toBeNull();
  });
});

describe('shouldAdoptGatewayModel（选择器值失效自动采用）', () => {
  it('无选项 → 不采用（保持空，让空状态引导显示）', () => {
    expect(shouldAdoptGatewayModel('gw-x', [])).toBeNull();
  });

  it('当前值在选项中 → 不采用', () => {
    expect(shouldAdoptGatewayModel('gw-a', [{ id: 'gw-a' }, { id: 'gw-b' }])).toBeNull();
  });

  it('当前值为空或不在选项中 → 采用第一个', () => {
    const options = [{ id: 'gw-a' }, { id: 'gw-b' }];
    expect(shouldAdoptGatewayModel('', options)).toBe('gw-a');
    expect(shouldAdoptGatewayModel('doubao-pro-32k', options)).toBe('gw-a');
  });
});

describe('buildGatewayModelOptions（选择器数据源）', () => {
  it('只含该能力可用模型，标签带服务商与私有/共享标注', () => {
    const models = [
      m({ id: 'c1', name: '千问 Max', providerName: '阿里云百炼', providerScope: 'shared' }),
      m({ id: 'c2', name: '私有模型', providerName: '我的 Key', providerScope: 'private', enabled: false }),
      m({ id: 'i1', capability: 'image' as const }),
    ];
    const options = buildGatewayModelOptions(models, 'chat');
    expect(options).toHaveLength(1);
    expect(options[0].id).toBe('c1');
    expect(options[0].label).toContain('千问 Max');
    expect(options[0].label).toContain('阿里云百炼');
  });
});

describe('loadGatewayModels（服务端列表缓存）', () => {
  beforeEach(() => {
    invalidateGatewayModelCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const stubModelsFetch = (payload: unknown, fail = false) => {
    const fetchMock = vi.fn(async () => ({
      ok: !fail,
      status: fail ? 500 : 200,
      json: async () => payload,
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('从服务端拉取并过滤禁用模型', async () => {
    const fetchMock = stubModelsFetch({
      models: [m({ id: 'c1' }), m({ id: 'c2', enabled: false })],
    });
    const models = await loadGatewayModels(true);
    expect(models.map((x) => x.id)).toEqual(['c1']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('60 秒内复用缓存（不重复请求）', async () => {
    const fetchMock = stubModelsFetch({ models: [m({ id: 'c1' })] });
    await loadGatewayModels(true);
    await loadGatewayModels();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('服务端不可用 → 空列表（不抛错，让调用方走明确报错）', async () => {
    stubModelsFetch({}, true);
    const models = await loadGatewayModels(true);
    expect(models).toEqual([]);
  });
});

describe('getPreferredGatewayModel（默认值 + 列表组合）', () => {
  beforeEach(() => {
    invalidateGatewayModelCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('未设默认时取第一个可用模型', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/model-invocations/models')) {
        return { ok: true, status: 200, json: async () => ({ models: [m({ id: 'c9' }), m({ id: 'c8' })] }) };
      }
      // 默认值尚未存储：GET /config/... 返回 404 语义
      return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const preferred = await getPreferredGatewayModel('chat');
    expect(preferred?.id).toBe('c9');
  });
});

describe('resolveGatewayModel（异步组合：拉列表 + 解析）', () => {
  beforeEach(() => {
    invalidateGatewayModelCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    invalidateGatewayModelCache();
  });

  it('按 id 从服务端列表解析', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/model-invocations/models')) {
        return { ok: true, status: 200, json: async () => ({ models: [m({ id: 'gw-x', capability: 'chat' })] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { resolveGatewayModel } = await import('../services/gatewayModels');
    const resolved = await resolveGatewayModel('chat', 'gw-x');
    expect(resolved?.id).toBe('gw-x');
  });
});
