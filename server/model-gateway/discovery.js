// 「用 Key 拉取模型」：OpenAI 兼容的 GET {base}/models。
//
// 上游调用经 fetchUpstream（SSRF 绑定 + 超时 + 重定向限制），凭据由服务端解密后
// 注入，浏览器永远看不到 Key。返回归一化后的 [{apiModel, ownedBy}]，兼容
// {data:[...]} / {models:[...]} / 纯数组三种返回形态。
const safeJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const discoverModels = async ({
  baseUrl,
  authType = 'bearer',
  authHeaderName,
  secret,
  fetchUpstream,
  timeoutMs = 15000,
}) => {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const headers = { Accept: 'application/json' };
  // 凭据走服务端注入通道（客户端 headers 袋子禁止 authorization）
  const upstreamAuth = secret
    ? authType === 'bearer'
      ? { type: 'bearer', secret }
      : authType === 'api-key-header' && authHeaderName
      ? { type: 'header', headerName: authHeaderName, secret }
      : undefined
    : undefined;

  const res = await fetchUpstream({
    url: `${base}/models`,
    method: 'GET',
    headers,
    upstreamAuth,
    timeoutMs,
  });

  if (res.status < 200 || res.status >= 300) {
    const text = res.body ? res.body.toString('utf8').slice(0, 200) : '';
    const err = new Error(`上游返回 ${res.status}${text ? `: ${text}` : ''}`);
    err.status = res.status;
    throw err;
  }

  const parsed = safeJson(res.body ? res.body.toString('utf8') : '');
  const raw = Array.isArray(parsed) ? parsed : parsed?.data || parsed?.models || [];
  return (Array.isArray(raw) ? raw : [])
    .map((m) => ({
      apiModel: typeof m === 'string' ? m : String(m?.id || m?.model || ''),
      ownedBy: m && typeof m === 'object' ? m.owned_by || m.ownedBy || null : null,
    }))
    .filter((m) => m.apiModel);
};
