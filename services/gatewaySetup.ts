/**
 * 「选服务商 → 填 API Key → 勾模型」向导逻辑层。
 *
 * 用户不该看到 base URL / 协议预设 / 端点路径——这些由服务端预设表提供，
 * 这里只做两件事：把预设翻译成网关请求体；按顺序落库（服务商 → 凭据 → 模型）。
 * 纯函数部分（payload 构造、候选合成）可单测，UI 只是薄壳。
 */
import {
  createProvider,
  setProviderCredential,
  createModel,
  type ProviderPresetDTO,
} from './modelGatewayClient';

export type ProviderCapability = 'chat' | 'image' | 'video';

export interface PresetModel {
  apiModel: string;
  name: string;
  capability: ProviderCapability;
}

export interface ModelCandidate extends PresetModel {
  preselect: boolean;
  source: 'preset' | 'discovered';
}

export const capabilityLabels: Record<ProviderCapability, string> = {
  chat: '对话',
  image: '图片',
  video: '视频',
};

export const buildProviderPayload = (
  preset: ProviderPresetDTO,
  scope: 'private' | 'shared' = 'private'
) => ({
  name: preset.name,
  baseUrl: preset.baseUrl,
  authType: preset.authType,
  scope,
});

export const buildModelPayload = (
  preset: ProviderPresetDTO,
  providerId: string,
  model: PresetModel
) => {
  const spec = preset.capabilities?.[model.capability];
  if (!spec) {
    throw new Error(`「${preset.name}」不支持${capabilityLabels[model.capability]}模型`);
  }
  return {
    providerId,
    name: model.name || model.apiModel,
    apiModel: model.apiModel,
    capability: model.capability,
    adapterKind: 'gateway',
    protocolPreset: spec.protocolPreset,
    endpointPath: spec.endpointPath,
    ...(spec.baseUrlOverride ? { baseUrlOverride: spec.baseUrlOverride } : {}),
  };
};

/**
 * 合成可勾选模型候选：
 * - 预设推荐模型优先（带名称与能力，默认勾选）
 * - 拉取到的模型默认按「对话」能力加入，最多预勾选若干个，其余让用户自己勾
 * - 只保留该服务商支持的能力，避免配出必然 404 的模型
 */
export const buildModelCandidates = ({
  preset,
  discovered = [],
  limit = 200,
  discoveredPreselectBudget = 3,
}: {
  preset: ProviderPresetDTO;
  discovered?: Array<{ apiModel: string } | string>;
  limit?: number;
  discoveredPreselectBudget?: number;
}): ModelCandidate[] => {
  const supported = Object.keys(preset.capabilities || {}) as ProviderCapability[];
  const out: ModelCandidate[] = [];
  const seen = new Set<string>();

  for (const m of preset.suggestedModels || []) {
    if (!supported.includes(m.capability) || seen.has(m.apiModel)) continue;
    if (out.length >= limit) break;
    seen.add(m.apiModel);
    out.push({ ...m, preselect: true, source: 'preset' });
  }

  let preselectedDiscovered = 0;
  const budgetLeft = () => Math.max(0, discoveredPreselectBudget - out.filter((o) => o.preselect).length);
  for (const d of discovered) {
    const apiModel = typeof d === 'string' ? d : d?.apiModel;
    if (!apiModel || seen.has(apiModel)) continue;
    if (out.length >= limit) break;
    seen.add(apiModel);
    const preselect = supported.includes('chat') && preselectedDiscovered < budgetLeft();
    if (preselect) preselectedDiscovered++;
    out.push({
      apiModel,
      name: apiModel,
      capability: supported.includes('chat') ? 'chat' : supported[0],
      preselect,
      source: 'discovered',
    });
  }

  return out;
};

/**
 * 第一步：建立服务商账号（创建服务商 + 保存 Key）。
 * 必须先完成这步才能「拉取模型」——拉取要用已保存在服务端的凭据。
 * 凭据失败时抛出带 providerId 的错误，前端据此提示「服务商已创建，补填 Key 即可」。
 */
export const connectProvider = async ({
  preset,
  secret,
  scope = 'private',
}: {
  preset: ProviderPresetDTO;
  secret: string;
  scope?: 'private' | 'shared';
}): Promise<{ providerId: string }> => {
  const provider = await createProvider(buildProviderPayload(preset, scope));
  const providerId = provider?.id;
  if (!providerId) throw new Error('创建服务商失败：服务端未返回 id');

  try {
    await setProviderCredential(providerId, secret);
  } catch (e: any) {
    const err = new Error(e?.message || '保存 API Key 失败');
    (err as any).providerId = providerId;
    throw err;
  }
  return { providerId };
};

/** 第二步：把用户勾选的模型逐个落到服务商下。 */
export const addSelectedModels = async ({
  preset,
  providerId,
  models,
}: {
  preset: ProviderPresetDTO;
  providerId: string;
  models: PresetModel[];
}): Promise<{ createdModels: number }> => {
  let createdModels = 0;
  for (const model of models) {
    await createModel(buildModelPayload(preset, providerId, model));
    createdModels++;
  }
  return { createdModels };
};

/** 一步到位（脚本/测试用）：服务商 + Key + 模型顺序落库。 */
export const runQuickSetup = async ({
  preset,
  secret,
  scope = 'private',
  models,
}: {
  preset: ProviderPresetDTO;
  secret: string;
  scope?: 'private' | 'shared';
  models: PresetModel[];
}): Promise<{ providerId: string; createdModels: number }> => {
  const { providerId } = await connectProvider({ preset, secret, scope });
  const { createdModels } = await addSelectedModels({ preset, providerId, models });
  return { providerId, createdModels };
};
