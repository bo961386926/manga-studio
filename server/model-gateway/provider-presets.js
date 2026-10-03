// 服务商预设表：把 base URL、协议预设、端点路径这些**内部实现细节**固定下来，
// 用户在界面上只需要「选服务商 → 填 API Key → 勾模型」。
//
// 为什么放在服务端：这些字段直接决定上游请求怎么拼，属于协议知识，不该让用户
// 手填（用户反馈：让用户填地址太复杂，且一填错就 404）。
//
// 同一条预设内不同能力可能走不同根路径（例：DashScope 对话在 /compatible-mode/v1，
// 视频在 /v1/services/...；MiniMax 视频在 /v2），因此能力规格支持 baseUrlOverride，
// 落到 models.base_url_override 字段。
//
// 视频能力的 protocolPreset 与 server/model-gateway/presets.js 的厂商异步预设同源，
// 那里是生产验证过的线上报文形状。
export const PROVIDER_PRESETS = [
  {
    key: 'dashscope',
    name: '阿里云百炼（通义千问）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    authType: 'bearer',
    hint: '通义千问对话 / 通义万相图像 / 通义万相视频',
    capabilities: {
      chat: { protocolPreset: 'openai-chat', endpointPath: '/chat/completions' },
      image: { protocolPreset: 'openai-image', endpointPath: '/images/generations' },
      video: {
        protocolPreset: 'dashscope-video-async',
        endpointPath: '/v1/services/aigc/video-generation/video-synthesis',
        baseUrlOverride: 'https://dashscope.aliyuncs.com',
      },
    },
    suggestedModels: [
      { apiModel: 'qwen-max', name: '通义千问 Max', capability: 'chat' },
      { apiModel: 'qwen-plus', name: '通义千问 Plus', capability: 'chat' },
    ],
  },
  {
    key: 'ark',
    name: '火山方舟（豆包）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    authType: 'bearer',
    hint: '豆包对话 / 图像 / 视频；模型名可填接入点 ID（ep-…）或模型 ID',
    capabilities: {
      chat: { protocolPreset: 'openai-chat', endpointPath: '/chat/completions' },
      image: { protocolPreset: 'openai-image', endpointPath: '/images/generations' },
      video: { protocolPreset: 'ark-video-async', endpointPath: '/contents/generations/tasks' },
    },
    // 方舟的模型名与账号接入点相关，交给「拉取模型」或手填，不预置以避免选到不存在的模型
    suggestedModels: [],
  },
  {
    key: 'deepseek',
    name: 'DeepSeek（深度求索）',
    baseUrl: 'https://api.deepseek.com/v1',
    authType: 'bearer',
    hint: 'deepseek-chat / deepseek-reasoner',
    capabilities: {
      chat: { protocolPreset: 'openai-chat', endpointPath: '/chat/completions' },
    },
    suggestedModels: [
      { apiModel: 'deepseek-chat', name: 'DeepSeek Chat', capability: 'chat' },
      { apiModel: 'deepseek-reasoner', name: 'DeepSeek Reasoner', capability: 'chat' },
    ],
  },
  {
    key: 'zhipu',
    name: '智谱 AI（GLM）',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    authType: 'bearer',
    hint: 'GLM 对话 / CogView 图像',
    capabilities: {
      chat: { protocolPreset: 'openai-chat', endpointPath: '/chat/completions' },
      image: { protocolPreset: 'openai-image', endpointPath: '/images/generations' },
    },
    suggestedModels: [{ apiModel: 'glm-4-plus', name: 'GLM-4 Plus', capability: 'chat' }],
  },
  {
    key: 'moonshot',
    name: '月之暗面（Kimi）',
    baseUrl: 'https://api.moonshot.cn/v1',
    authType: 'bearer',
    hint: '长上下文对话',
    capabilities: {
      chat: { protocolPreset: 'openai-chat', endpointPath: '/chat/completions' },
    },
    suggestedModels: [{ apiModel: 'moonshot-v1-32k', name: 'Moonshot v1 32k', capability: 'chat' }],
  },
  {
    key: 'minimax',
    name: 'MiniMax（海螺）',
    baseUrl: 'https://api.minimaxi.com/v1',
    authType: 'bearer',
    hint: '对话 / 图像 / 视频（视频走 v2 根路径）',
    capabilities: {
      chat: { protocolPreset: 'openai-chat', endpointPath: '/chat/completions' },
      image: { protocolPreset: 'openai-image', endpointPath: '/image_generation' },
      video: {
        protocolPreset: 'minimax-video-async',
        endpointPath: '/video_generation',
        baseUrlOverride: 'https://api.minimaxi.com/v2',
      },
    },
    suggestedModels: [
      { apiModel: 'MiniMax-Text-01', name: 'MiniMax Text-01', capability: 'chat' },
      { apiModel: 'image-01', name: 'MiniMax 图像 image-01', capability: 'image' },
      { apiModel: 'MiniMax-H3', name: '海螺 3.0（H3）', capability: 'video' },
    ],
  },
  {
    key: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    authType: 'bearer',
    hint: '聚合开源模型（Qwen / DeepSeek / FLUX 等），模型列表建议拉取',
    capabilities: {
      chat: { protocolPreset: 'openai-chat', endpointPath: '/chat/completions' },
      image: { protocolPreset: 'openai-image', endpointPath: '/images/generations' },
    },
    suggestedModels: [],
  },
  {
    key: 'qianfan',
    name: '百度千帆（文心）',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    authType: 'bearer',
    hint: '文心对话（v2 OpenAI 兼容），模型列表建议拉取',
    capabilities: {
      chat: { protocolPreset: 'openai-chat', endpointPath: '/chat/completions' },
      image: { protocolPreset: 'openai-image', endpointPath: '/images/generations' },
    },
    suggestedModels: [],
  },
  {
    key: 'hunyuan',
    name: '腾讯混元',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    authType: 'bearer',
    hint: '混元对话（OpenAI 兼容）',
    capabilities: {
      chat: { protocolPreset: 'openai-chat', endpointPath: '/chat/completions' },
    },
    suggestedModels: [],
  },
];

const clonePreset = (p) => ({
  key: p.key,
  name: p.name,
  baseUrl: p.baseUrl,
  authType: p.authType,
  hint: p.hint || '',
  capabilities: Object.fromEntries(
    Object.entries(p.capabilities).map(([cap, spec]) => [cap, { ...spec }])
  ),
  suggestedModels: (p.suggestedModels || []).map((m) => ({ ...m })),
});

/** 下发到浏览器的预设清单（仅协议元数据，不含任何凭据字段）。 */
export const listProviderPresets = () => PROVIDER_PRESETS.map(clonePreset);

export const findProviderPreset = (key) =>
  PROVIDER_PRESETS.find((p) => p.key === key) || null;
