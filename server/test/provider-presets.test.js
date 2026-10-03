// 服务商预设表 + 「用 Key 拉取模型」的契约测试。
//
// 设计目标（用户反馈）：用户不该填 base URL / 协议预设 / 端点路径。
// 预设表把这些内部细节固定下来，用户只需要「选服务商 → 填 Key → 勾模型」。
// 表里任何一处笔误都会让整条链路 404，所以用测试把每一条预设钉住。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDER_PRESETS,
  listProviderPresets,
  findProviderPreset,
} from '../model-gateway/provider-presets.js';
import { discoverModels } from '../model-gateway/discovery.js';
import { PRESETS } from '../model-gateway/presets.js';

test('预设表完整性：key 唯一、https 地址、能力协议在白名单内', () => {
  const keys = new Set();
  for (const preset of PROVIDER_PRESETS) {
    assert.ok(preset.key && preset.name, 'preset must have key and name');
    assert.ok(!keys.has(preset.key), `duplicate preset key: ${preset.key}`);
    keys.add(preset.key);
    assert.match(preset.baseUrl, /^https:\/\//, `${preset.key} baseUrl must be https`);
    assert.ok(!preset.baseUrl.endsWith('/'), `${preset.key} baseUrl must not end with /`);
    assert.ok(['none', 'bearer', 'api-key-header'].includes(preset.authType), `${preset.key} authType`);
    assert.ok(preset.capabilities && Object.keys(preset.capabilities).length > 0, `${preset.key} needs capabilities`);
    for (const [capability, spec] of Object.entries(preset.capabilities)) {
      assert.ok(['chat', 'image', 'video'].includes(capability), `${preset.key} capability ${capability}`);
      assert.ok(PRESETS.includes(spec.protocolPreset), `${preset.key}/${capability} protocolPreset must be whitelisted`);
      assert.match(spec.endpointPath, /^\//, `${preset.key}/${capability} endpointPath must start with /`);
      if (spec.baseUrlOverride) {
        assert.match(spec.baseUrlOverride, /^https:\/\//, `${preset.key}/${capability} baseUrlOverride must be https`);
        assert.ok(!spec.baseUrlOverride.endsWith('/'), `${preset.key}/${capability} baseUrlOverride must not end with /`);
      }
    }
  }
  assert.ok(PROVIDER_PRESETS.length >= 6, '国内主流服务商至少 6 家');
});

test('每个能力都声明支持的工作流，且与该能力语义一致', () => {
  const allowed = {
    chat: ['text'],
    image: ['text2image', 'image2image'],
    video: ['text2video', 'image2video'],
  };
  for (const preset of PROVIDER_PRESETS) {
    for (const [capability, spec] of Object.entries(preset.capabilities)) {
      assert.ok(Array.isArray(spec.workflows) && spec.workflows.length > 0, `${preset.key}/${capability} 需要 workflows`);
      for (const wf of spec.workflows) {
        assert.ok(allowed[capability].includes(wf), `${preset.key}/${capability} 非法工作流 ${wf}`);
      }
    }
  }
});

test('流程覆盖度按「文生图 + 图生图 + 图生视频」判定，纯对话厂商标为 chat-only', () => {
  const coverage = Object.fromEntries(PROVIDER_PRESETS.map((p) => [p.key, p.coverage]));
  // 一家能跑完整流程：对话 + 文生图 + 图生图 + 图生视频
  assert.equal(coverage.ark, 'full', '火山方舟应能覆盖全流程（Seedream 图生图 + Seedance 图生视频）');
  // 纯对话厂商
  for (const key of ['deepseek', 'moonshot', 'hunyuan']) {
    assert.equal(coverage[key], 'chat-only', `${key} 只能做文字阶段`);
  }
  // 有画面能力但不完整（缺图生图或视频）
  for (const key of ['dashscope', 'minimax', 'siliconflow', 'zhipu', 'qianfan']) {
    assert.equal(coverage[key], 'partial', `${key} 为部分环节`);
  }
});

test('预设按流程覆盖度排序：全流程在前，纯对话在最后', () => {
  const rank = { full: 0, partial: 1, 'chat-only': 2 };
  const ranks = PROVIDER_PRESETS.map((p) => rank[p.coverage]);
  const sorted = [...ranks].sort((a, b) => a - b);
  assert.deepEqual(ranks, sorted, '预设需按覆盖度排序，避免把纯对话厂商排在推荐位');
  assert.equal(PROVIDER_PRESETS[0].coverage, 'full');
});

test('每家预设都提供「获取 API Key」直达页与官方文档（https 链接）', () => {
  for (const preset of PROVIDER_PRESETS) {
    assert.match(preset.keyUrl, /^https:\/\//, `${preset.key} 需要 keyUrl`);
    assert.match(preset.docsUrl, /^https:\/\//, `${preset.key} 需要 docsUrl`);
    assert.notEqual(preset.keyUrl, preset.docsUrl, `${preset.key} 直达页与文档不应是同一地址`);
  }
});

test('预设表不包含任何凭据字段或密钥值', () => {
  // 注意：keyUrl 里合法地含有 "apiKey" 字样（例如 ?apiKey=1），
  // 因此这里校验的是**字段名**与**密钥值形状**，而不是无脑子串。
  const collectKeys = (node, out = []) => {
    if (Array.isArray(node)) node.forEach((x) => collectKeys(x, out));
    else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        out.push(k.toLowerCase());
        collectKeys(v, out);
      }
    }
    return out;
  };
  for (const field of collectKeys(PROVIDER_PRESETS)) {
    assert.ok(
      !/secret|credential|password|token|apikey|api_key/.test(field),
      `预设表不得出现凭据字段: ${field}`
    );
  }
  assert.ok(!JSON.stringify(PROVIDER_PRESETS).includes('sk-'), '预设表不得出现密钥值');
});

test('listProviderPresets 返回可安全下发到浏览器的字段', () => {
  const list = listProviderPresets();
  assert.equal(list.length, PROVIDER_PRESETS.length);
  const first = list[0];
  assert.ok(first.key && first.name && first.baseUrl);
  assert.ok(first.keyUrl && first.docsUrl, '下发字段需包含取 Key 链接与文档链接');
  assert.ok(['full', 'partial', 'chat-only'].includes(first.coverage), '下发字段需含覆盖度');
  assert.deepEqual(Object.keys(first.capabilities).length > 0, true);
});

test('findProviderPreset 命中与未命中', () => {
  const key = PROVIDER_PRESETS[0].key;
  assert.equal(findProviderPreset(key).key, key);
  assert.equal(findProviderPreset('nope-not-exist'), null);
  assert.equal(findProviderPreset(undefined), null);
});

// ---------- 拉取模型 ----------

const fakeUpstream = (responder) => {
  const calls = [];
  const fn = async (params) => {
    calls.push(params);
    return responder(params);
  };
  return { fn, calls };
};

test('discoverModels 解析 OpenAI 风格 {data:[{id}]}', async () => {
  const { fn, calls } = fakeUpstream(() => ({
    status: 200,
    body: Buffer.from(JSON.stringify({ data: [{ id: 'deepseek-chat', owned_by: 'deepseek' }, { id: 'deepseek-reasoner' }] })),
  }));
  const models = await discoverModels({
    baseUrl: 'https://api.deepseek.com/v1',
    authType: 'bearer',
    secret: 'sk-test',
    fetchUpstream: fn,
  });
  assert.deepEqual(models.map((m) => m.apiModel), ['deepseek-chat', 'deepseek-reasoner']);
  assert.equal(calls[0].url, 'https://api.deepseek.com/v1/models');
  assert.equal(calls[0].method, 'GET');
  // 凭据走服务端注入通道：客户端 headers 袋子不带 authorization
  assert.deepEqual(calls[0].upstreamAuth, { type: 'bearer', secret: 'sk-test' });
  assert.equal(calls[0].headers.Authorization, undefined);
});

test('discoverModels 兼容 {models:[...]} 与纯数组两种返回', async () => {
  const alt = fakeUpstream(() => ({
    status: 200,
    body: Buffer.from(JSON.stringify({ models: [{ id: 'qwen-max' }] })),
  }));
  assert.deepEqual(
    (await discoverModels({ baseUrl: 'https://x.cn/v1', authType: 'bearer', secret: 'k', fetchUpstream: alt.fn })).map((m) => m.apiModel),
    ['qwen-max']
  );
  const arr = fakeUpstream(() => ({ status: 200, body: Buffer.from(JSON.stringify([{ id: 'glm-4-plus' }])) }));
  assert.deepEqual(
    (await discoverModels({ baseUrl: 'https://x.cn/v1', authType: 'bearer', secret: 'k', fetchUpstream: arr.fn })).map((m) => m.apiModel),
    ['glm-4-plus']
  );
});

test('discoverModels 上游非 2xx → 抛错并带上状态码', async () => {
  const { fn } = fakeUpstream(() => ({ status: 401, body: Buffer.from('{"error":{"message":"invalid api key"}}') }));
  await assert.rejects(
    () => discoverModels({ baseUrl: 'https://x.cn/v1', authType: 'bearer', secret: 'bad', fetchUpstream: fn }),
    /401/
  );
});

test('discoverModels 无凭据时不带 Authorization 头（仍是合法请求）', async () => {
  const { fn, calls } = fakeUpstream(() => ({ status: 200, body: Buffer.from('{"data":[]}') }));
  const models = await discoverModels({ baseUrl: 'https://x.cn/v1', authType: 'bearer', secret: '', fetchUpstream: fn });
  assert.deepEqual(models, []);
  assert.equal(calls[0].upstreamAuth, undefined);
  assert.equal(calls[0].headers.Authorization, undefined);
});

test('discoverModels 上游空体/坏 JSON → 空列表（不炸）', async () => {
  const empty = fakeUpstream(() => ({ status: 200, body: Buffer.from('') }));
  assert.deepEqual(await discoverModels({ baseUrl: 'https://x.cn/v1', authType: 'bearer', secret: 'k', fetchUpstream: empty.fn }), []);
  const bad = fakeUpstream(() => ({ status: 200, body: Buffer.from('not-json') }));
  assert.deepEqual(await discoverModels({ baseUrl: 'https://x.cn/v1', authType: 'bearer', secret: 'k', fetchUpstream: bad.fn }), []);
});

test('discoverModels 自定义 Header 鉴权走 authHeaderName', async () => {
  const { fn, calls } = fakeUpstream(() => ({ status: 200, body: Buffer.from('{"data":[]}') }));
  await discoverModels({
    baseUrl: 'https://x.cn/v1',
    authType: 'api-key-header',
    authHeaderName: 'X-Api-Key',
    secret: 'abc',
    fetchUpstream: fn,
  });
  assert.deepEqual(calls[0].upstreamAuth, { type: 'header', headerName: 'X-Api-Key', secret: 'abc' });
  assert.equal(calls[0].headers['X-Api-Key'], undefined);
  assert.equal(calls[0].headers.Authorization, undefined);
});
