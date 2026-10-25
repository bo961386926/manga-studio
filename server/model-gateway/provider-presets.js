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
// 每个能力还要声明支持哪些**工作流**（text / text2image / image2image /
// text2video / image2video）——本产品主流程不是聊天，而是
// 「文生图 → 图生图（角色一致性）→ 图生视频」。据此算出 coverage：
//   full      一家即可跑完整流程
//   partial   有画面能力但不完整（缺图生图或视频）
//   chat-only 只能做文字阶段，画面/视频必须另接一家
// 预设按 coverage 排序，避免把纯对话厂商摆在推荐位
// （用户反馈：DeepSeek 不支持文生图，不该当首选）。
//
// 视频能力的 protocolPreset 与 server/model-gateway/presets.js 的厂商异步预设同源，
// 那里是生产验证过的线上报文形状。
const RAW_PRESETS = [
  {
    key: 'ark',
    name: '火山方舟（豆包）',
    priority: 1,
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    authType: 'bearer',
    hint: '一家覆盖全流程：豆包对话 + Seedream 图像（支持参考图）+ Seedance 视频（首尾帧）',
    keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    docsUrl: 'https://docs.volcengine.com/docs/ark/api-key',
    capabilities: {
      chat: { protocolPreset: 'openai-chat', endpointPath: '/chat/completions', workflows: ['text'] },
      image: {
        protocolPreset: 'openai-image',
        endpointPath: '/images/generations',
        workflows: ['text2image', 'image2image'],
      },
      video: {
        protocolPreset: 'ark-video-async',
        endpointPath: '/contents/generations/tasks',
        workflows: ['text2video', 'image2video'],
      },
    },
    // 方舟的模型名与账号接入点相关（可填 ep-… 或模型 ID），交给「拉取模型」或手填
    suggestedModels: [],
  },
  {
    key: 'dashscope',
    name: '阿里云百炼（通义千问）',
    priority: 2,
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    authType: 'bearer',
    hint: '通义千问对话 + 通义万相图像 + 万相视频（图生图需厂商专用端点，暂未内置）',
    keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
    docsUrl: 'https://www.alibabacloud.com/help/zh/model-studio/get-api-key',
    capabilities: {
      chat: { protocolPreset: 'openai-chat', endpointPath: '/chat/completions', workflows: ['text'] },
      image: { protocolPreset: 'openai-image', endpointPath: '/images/generations', workflows: ['text2image'] },
      video: {
        protocolPreset: 'dashscope-video-async',
        endpointPath: '/v1/services/aigc/video-generation/video-synthesis',
        baseUrlOverride: 'https://dashscope.aliyuncs.com',
        workflows: ['text2video', 'image2video'],
      },
    },
    suggestedModels: [
      { apiModel: 'qwen-max', name: '通义千问 Max', capability: 'chat' },
      { apiModel: 'qwen-plus', name: '通义千问 Plus', capability: 'chat' },
    ],
  },
  {
    key: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    priority: 3,
    baseUrl: 'https://api.siliconflow.cn/v1',
    authType: 'bearer',
    hint: '聚合开源模型：Qwen/DeepSeek 对话、FLUX/Kolors 图像（Kontext 系支持参考图改图）',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    docsUrl: 'https://docs.siliconflow.cn/',
    capabilities: {
      chat: { protocolPreset: 'openai-chat', endpointPath: '/chat/completions', workflows: ['text'] },
      image: {
        protocolPreset: 'openai-image',
        endpointPath: '/images/generations',
        workflows: ['text2image', 'image2image'],
      },
    },
    suggestedModels: [],
  },
  {
    key: 'minimax',
    name: 'MiniMax（海螺）',
    priority: 4,
    baseUrl: 'https://api.minimaxi.com/v1',
    authType: 'bearer',
    hint: '对话 + image-01 图像 + 海螺视频（图生视频，走 v2 根路径）',
    keyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    docsUrl: 'https://platform.minimaxi.com/document/guides',
    capabilities: {
      chat: { protocolPreset: 'openai-chat', endpointPath: '/chat/completions', workflows: ['text'] },
      image: { protocolPreset: 'openai-image', endpointPath: '/image_generation', workflows: ['text2image'] },
      video: {
        protocolPreset: 'minimax-video-async',
        endpointPath: '/video_generation',
        baseUrlOverride: 'https://api.minimaxi.com/v2',
        workflows: ['text2video', 'image2video'],
      },
    },
    suggestedModels: [
      { apiModel: 'MiniMax-Text-01', name: 'MiniMax Text-01', capability: 'chat' },
      { apiModel: 'image-01', name: 'MiniMax 图像 image-01', capability: 'image' },
      { apiModel: 'MiniMax-H3', name: '海螺 3.0（H3）', capability: 'video' },
    ],
  },
  {
    key: 'zhipu',
    name: '智谱 AI（GLM）',
    priority: 5,
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    authType: 'bearer',
    hint: 'GLM 对话 + CogView 图像（视频能力弱，画面与视频建议配方舟/百炼）',
    keyUrl: 'https://bigmodel.cn/usercenter/apikeys',
    docsUrl: 'https://docs.bigmodel.cn/cn/guide/start/quick-start',
    capabilities: {
      chat: { protocolPreset: 'openai-chat', endpointPath: '/chat/completions', workflows: ['text'] },
      image: { protocolPreset: 'openai-image', endpointPath: '/images/generations', workflows: ['text2image'] },
    },
    suggestedModels: [{ apiModel: 'glm-4-plus', name: 'GLM-4 Plus', capability: 'chat' }],
  },
  {
    key: 'qianfan',
    name: '百度千帆（文心）',
    priority: 6,
    baseUrl: 'https://qianfan.baidubce.com/v2',
    authType: 'bearer',
    hint: '文心对话 + 文生图（v2 OpenAI 兼容），模型列表建议拉取',
    keyUrl: 'https://console.bce.baidu.com/iam/#/iam/apikey/list',
    docsUrl: 'https://cloud.baidu.com/doc/WENXINWORKSHOP/index.html',
    capabilities: {
      chat: { protocolPreset: 'openai-chat', endpointPath: '/chat/completions', workflows: ['text'] },
      image: { protocolPreset: 'openai-image', endpointPath: '/images/generations', workflows: ['text2image'] },
    },
    suggestedModels: [],
  },
  {
    key: 'deepseek',
    name: 'DeepSeek（深度求索）',
    priority: 7,
    baseUrl: 'https://api.deepseek.com/v1',
    authType: 'bearer',
    hint: '仅对话：适合剧本改编与分镜文字；画面与视频需再接一家（建议火山方舟或阿里云百炼）',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    docsUrl: 'https://api-docs.deepseek.com/',
    capabilities: {
      chat: { protocolPreset: 'openai-chat', endpointPath: '/chat/completions', workflows: ['text'] },
    },
    suggestedModels: [
      { apiModel: 'deepseek-chat', name: 'DeepSeek Chat', capability: 'chat' },
      { apiModel: 'deepseek-reasoner', name: 'DeepSeek Reasoner', capability: 'chat' },
    ],
  },
  {
    key: 'moonshot',
    name: '月之暗面（Kimi）',
    priority: 8,
    baseUrl: 'https://api.moonshot.cn/v1',
    authType: 'bearer',
    hint: '仅对话（长上下文，适合长剧本）；画面与视频需再接一家',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    docsUrl: 'https://platform.moonshot.cn/docs/',
    capabilities: {
      chat: { protocolPreset: 'openai-chat', endpointPath: '/chat/completions', workflows: ['text'] },
    },
    suggestedModels: [{ apiModel: 'moonshot-v1-32k', name: 'Moonshot v1 32k', capability: 'chat' }],
  },
  {
    key: 'hunyuan',
    name: '腾讯混元',
    priority: 9,
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    authType: 'bearer',
    hint: '仅对话（OpenAI 兼容）；画面与视频需再接一家',
    keyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key',
    docsUrl: 'https://cloud.tencent.com/document/product/1729',
    capabilities: {
      chat: { protocolPreset: 'openai-chat', endpointPath: '/chat/completions', workflows: ['text'] },
    },
    suggestedModels: [],
  },
];

const COVERAGE_RANK = { full: 0, partial: 1, 'chat-only': 2 };

/** 按本产品主流程需要的工作流判定覆盖度（唯一判定规则，避免各处手写不一致）。 */
export const computeCoverage = (capabilities) => {
  const has = (wf) => Object.values(capabilities).some((spec) => (spec.workflows || []).includes(wf));
  const caps = Object.keys(capabilities);
  if (has('text') && has('text2image') && has('image2image') && has('image2video')) return 'full';
  if (caps.length === 1 && caps[0] === 'chat') return 'chat-only';
  return 'partial';
};

// 覆盖度高的排前面：优先推荐能一家跑完整流程的服务商
export const PROVIDER_PRESETS = RAW_PRESETS.map((preset) => ({
  ...preset,
  coverage: computeCoverage(preset.capabilities),
})).sort(
  (a, b) => COVERAGE_RANK[a.coverage] - COVERAGE_RANK[b.coverage] || (a.priority ?? 99) - (b.priority ?? 99)
);

const clonePreset = (p) => ({
  key: p.key,
  name: p.name,
  baseUrl: p.baseUrl,
  authType: p.authType,
  hint: p.hint || '',
  keyUrl: p.keyUrl,
  docsUrl: p.docsUrl,
  coverage: p.coverage,
  capabilities: Object.fromEntries(
    Object.entries(p.capabilities).map(([cap, spec]) => [cap, { ...spec, workflows: [...(spec.workflows || [])] }])
  ),
  suggestedModels: (p.suggestedModels || []).map((m) => ({ ...m })),
});

/** 下发到浏览器的预设清单（仅协议元数据，不含任何凭据字段）。 */
export const listProviderPresets = () => PROVIDER_PRESETS.map(clonePreset);

export const findProviderPreset = (key) =>
  PROVIDER_PRESETS.find((p) => p.key === key) || null;
