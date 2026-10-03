/**
 * 服务端网关模型的唯一解析口（多服务商/多模型改造的核心）。
 *
 * 设计要点：
 * - 解析/选项构建是纯函数（列表作参数注入），方便测试与复用；
 * - 异步层只做三件事：拉取（60s 缓存，失败返回空列表）、按能力过滤、
 *   每能力"默认模型"的读写（服务端 per-user 配置，多端一致）；
 * - 浏览器只接触 ModelDTO 元数据，密钥永远在服务端。
 */
import { listModels } from './modelGatewayClient';
import { getConfig, setConfig } from './storageService';
import type { ModelDTO } from '../types/modelGateway';

export type GatewayCapability = 'chat' | 'image' | 'video';
export type GatewayModelDefaults = Partial<Record<GatewayCapability, string>>;

/** 网关模型列表变化（网关面板增删、迁移导入）时广播的窗口事件名。 */
export const GATEWAY_MODELS_CHANGED_EVENT = 'gateway-models-changed';

export const broadcastGatewayModelsChanged = (): void => {
  invalidateGatewayModelCache();
  try {
    window.dispatchEvent(new Event(GATEWAY_MODELS_CHANGED_EVENT));
  } catch {
    // 非浏览器环境（测试/SSR）忽略
  }
};

export interface GatewayModelOption {
  id: string;
  label: string;
  apiModel: string;
  providerName: string;
  providerScope: 'private' | 'shared';
  accessLevel: string;
}

// ---------- 纯函数（列表注入） ----------

export const usableGatewayModels = (
  models: ModelDTO[],
  capability: GatewayCapability
): ModelDTO[] =>
  (models || []).filter(
    (m) => m.capability === capability && m.enabled && !(m as any).deleted_at
  );

export const resolveGatewayModelFrom = (
  models: ModelDTO[],
  capability: GatewayCapability,
  idOrName?: string
): ModelDTO | null => {
  const ofCap = usableGatewayModels(models, capability);
  if (ofCap.length === 0) return null;
  if (idOrName) {
    // id 精确匹配优先（新选择器的值就是网关模型 id），name/apiModel 兼容旧存量值
    const exact = ofCap.find(
      (m) => m.id === idOrName || m.name === idOrName || m.apiModel === idOrName
    );
    if (exact) return exact;
  }
  // 该能力只有 1 个模型：自动采用（单模型部署的常见形态）
  return ofCap.length === 1 ? ofCap[0] : null;
};

export const preferredGatewayModelFrom = (
  models: ModelDTO[],
  capability: GatewayCapability,
  defaults?: GatewayModelDefaults
): ModelDTO | null => {
  const ofCap = usableGatewayModels(models, capability);
  if (ofCap.length === 0) return null;
  const def = defaults?.[capability];
  if (def) {
    const hit = ofCap.find((m) => m.id === def);
    if (hit) return hit;
  }
  return ofCap[0];
};

export const shouldAdoptGatewayModel = (
  value: string | undefined | null,
  options: Array<{ id: string }>
): string | null => {
  if (!options || options.length === 0) return null;
  if (value && options.some((o) => o.id === value)) return null;
  return options[0].id;
};

export const buildGatewayModelOptions = (
  models: ModelDTO[],
  capability: GatewayCapability
): GatewayModelOption[] =>
  usableGatewayModels(models, capability).map((m) => ({
    id: m.id,
    label: `${m.name}（${m.providerName}${m.providerScope === 'private' ? ' · 私有' : ''}）`,
    apiModel: m.apiModel,
    providerName: m.providerName,
    providerScope: m.providerScope,
    accessLevel: m.accessLevel,
  }));

// ---------- 异步层（拉取缓存 + 默认值持久化） ----------

let gatewayModelCache: { at: number; models: ModelDTO[] } | null = null;
const GATEWAY_MODEL_TTL_MS = 60_000;

export const loadGatewayModels = async (force = false): Promise<ModelDTO[]> => {
  if (!force && gatewayModelCache && Date.now() - gatewayModelCache.at < GATEWAY_MODEL_TTL_MS) {
    return gatewayModelCache.models;
  }
  try {
    const models = await listModels();
    gatewayModelCache = {
      at: Date.now(),
      models: (models || []).filter((m: any) => m.enabled && !m.deleted_at),
    };
    return gatewayModelCache.models;
  } catch (e: any) {
    console.warn('[Gateway] 网关模型列表获取失败（未登录或网关不可用）:', e?.message);
    return [];
  }
};

export const invalidateGatewayModelCache = (): void => {
  gatewayModelCache = null;
};

const DEFAULTS_KEY = 'gateway_model_defaults_v1';

export const getGatewayModelDefaults = async (): Promise<GatewayModelDefaults> => {
  try {
    const raw = await getConfig(DEFAULTS_KEY);
    if (!raw) return {};
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return (parsed && typeof parsed === 'object' ? parsed : {}) as GatewayModelDefaults;
  } catch {
    return {};
  }
};

export const setGatewayModelDefault = async (
  capability: GatewayCapability,
  modelId: string | null
): Promise<void> => {
  try {
    const current = await getGatewayModelDefaults();
    if (modelId) current[capability] = modelId;
    else delete current[capability];
    await setConfig(DEFAULTS_KEY, JSON.stringify(current));
  } catch (e: any) {
    console.warn('[Gateway] 默认模型保存失败:', e?.message);
  }
};

export const getPreferredGatewayModel = async (
  capability: GatewayCapability
): Promise<ModelDTO | null> => {
  const [models, defaults] = await Promise.all([
    loadGatewayModels(),
    getGatewayModelDefaults(),
  ]);
  return preferredGatewayModelFrom(models, capability, defaults);
};

/** 异步组合：拉服务端列表（带缓存）后按 id/name/apiModel 解析。 */
export const resolveGatewayModel = async (
  capability: GatewayCapability,
  idOrName?: string
): Promise<ModelDTO | null> =>
  resolveGatewayModelFrom(await loadGatewayModels(), capability, idOrName);
