const VIDEO_MODERATION_HINT =
  '内容安全拦截：该提示词可能包含不安全或违规内容。请编辑视频/关键帧提示词，避免暴力、血腥、敏感描述后重试。';

const VEO_MODERATION_HINT =
  '内容安全拦截：该提示词可能包含不安全或违规内容。请编辑该镜头的视频/关键帧提示词，避免暴力、血腥、敏感描述后重试。';

const MODERATION_PEOPLE_IN_UPLOADS_SORA =
  '视频生成被平台内容审核拦截：原因指向「用户上传的素材」（如首帧、参考图、角色图）。平台会单独审核上传画面，与文字描述无直接关系。可尝试：去掉或更换上传图、避免画面中清晰可辨识的人物，或改为纯文生视频后重试。';

const MODERATION_PEOPLE_IN_UPLOADS_VEO =
  '视频生成被平台内容审核拦截：原因指向「用户上传的素材」（如首帧、参考图）。平台会单独审核上传画面，与镜头文字描述无直接关系。可尝试：去掉或更换上传图、避免画面中清晰可辨识的人物，或改为纯文生视频后重试。';

const MODERATION_GENERIC_SORA =
  '视频生成被平台内容审核拦截。常见原因包括：文字提示含敏感表述；或上传的首帧/参考图中含人物、违规画面等。请分别检查提示词与上传素材后重试。';

const MODERATION_GENERIC_VEO =
  '视频生成被平台内容审核拦截。常见原因包括：镜头描述含敏感表述；或上传的首帧/参考图中含人物、违规画面等。请分别检查文字与上传素材后重试。';

function bodySuggestsPeopleInUserUploads(text: string): boolean {
  const t = (text || '').toLowerCase();
  return (
    t.includes('people-in-user-uploads') ||
    t.includes('people in user uploads') ||
    (t.includes('user-upload') && t.includes('people') && t.includes('moderation'))
  );
}

export function formatModerationBlockedForUser(
  err: { message?: string; code?: string; type?: string } | undefined,
  mode: 'sora' | 'veo' = 'sora'
): string {
  const msg = (err?.message || '').toLowerCase();
  const fromMsg = bodySuggestsPeopleInUserUploads(msg);
  if (fromMsg) {
    return mode === 'veo' ? MODERATION_PEOPLE_IN_UPLOADS_VEO : MODERATION_PEOPLE_IN_UPLOADS_SORA;
  }
  return mode === 'veo' ? MODERATION_GENERIC_VEO : MODERATION_GENERIC_SORA;
}

export type ParsedApiError = { message?: string; type?: string; code?: string; param?: string };

export function parseOpenAIStyleErrorBody(text: string): { error?: ParsedApiError } | null {
  try {
    return JSON.parse(text) as { error?: ParsedApiError };
  } catch {
    return null;
  }
}

function looksLikeContentModeration(apiErr: ParsedApiError | undefined, rawText: string): boolean {
  const msg = (apiErr?.message || rawText || '').toLowerCase();
  const code = (apiErr?.code || '').toLowerCase();
  const type = (apiErr?.type || '').toLowerCase();
  if (code.includes('moderation') || type.includes('moderation') || msg.includes('moderation')) return true;
  if (code.includes('sensitive') || msg.includes('sensitive') || msg.includes('privacy') || msg.includes('sensitivecontent')) return true;
  if (msg.includes('content_policy') || msg.includes('content policy')) return true;
  if (msg.includes('safety') && (msg.includes('filter') || msg.includes('system'))) return true;
  if (msg.includes('policy') && msg.includes('violation')) return true;
  if (/不安全|违规|内容审核|敏感内容|风控|敏感人脸|真人信息|真人/.test(apiErr?.message || rawText || '')) return true;
  return false;
}

function stripRequestIdTail(s: string): string {
  return s.replace(/\s*Request id:\s*[a-f0-9]+.*$/i, '').trim();
}

function extractModelNameFromMessage(msg: string): string | null {
  const m =
    msg.match(/requested model\s+([^\s.]+)/i) ||
    msg.match(/model[`:：\s]+([a-z0-9_.-]+)/i) ||
    msg.match(/`model`\s*[^:]*:\s*([a-z0-9_.-]+)/i);
  return m ? m[1] : null;
}

export function formatVideoRequestErrorForUser(
  status: number,
  bodyText: string,
  mode: 'sora' | 'veo'
): string {
  const trimmedBody = (bodyText || '').trim();
  const parsed = parseOpenAIStyleErrorBody(trimmedBody);
  const apiErr = parsed?.error;
  const rawMsg = stripRequestIdTail((apiErr?.message || '').trim());
  const code = (apiErr?.code || '').toLowerCase();
  const type = (apiErr?.type || '').toLowerCase();
  const msgLower = rawMsg.toLowerCase();
  const moderationHint = mode === 'veo' ? VEO_MODERATION_HINT : VIDEO_MODERATION_HINT;
  const combinedForUploadCheck = `${trimmedBody}\n${rawMsg}`;

  if (status === 400 && (msgLower.includes('sensitivecontent') || msgLower.includes('privacyinformation') || code.includes('sensitivecontent') || code.includes('privacy'))) {
    return '敏感图像风控提示：上游火山引擎判定此镜头的【首帧起始终/参考图】疑似包含真实人物（即真人面容或肖像，被系统合规策略拦截）。为避免重复扣费，请不要尝试重新提交此图。建议解决方案：1. 清除当前起始终，使用文字描述重新生成一张不含肖像特写的参考图。2. 改用不含肖像特写或更偏写意、动漫化的起始终后再尝试视频生成。';
  }

  if (status === 400 && looksLikeContentModeration(apiErr, trimmedBody)) {
    if (bodySuggestsPeopleInUserUploads(combinedForUploadCheck)) {
      return mode === 'veo' ? MODERATION_PEOPLE_IN_UPLOADS_VEO : MODERATION_PEOPLE_IN_UPLOADS_SORA;
    }
    return moderationHint;
  }

  if (status === 500) {
    return '当前请求较多或服务暂时异常，请稍后重试。';
  }

  if (status === 401) {
    return 'API Key 无效或未通过校验，请在设置中检查密钥是否正确。';
  }

  if (status === 403) {
    return '没有权限调用该能力，请检查账号是否开通对应模型或接口。';
  }

  if (status === 429) {
    return '请求过于频繁或额度不足，请稍后再试。';
  }

  if (
    status === 400 &&
    (code === 'invalidparameter' ||
      type === 'badrequest' ||
      msgLower.includes('does not support this api') ||
      (msgLower.includes('not support') && msgLower.includes('api')) ||
      msgLower.includes('invalidparameter') ||
      (msgLower.includes('parameter') && msgLower.includes('model') && msgLower.includes('valid')))
  ) {
    const modelName = extractModelNameFromMessage(rawMsg);
    if (/seedream/i.test(rawMsg)) {
      return '当前使用的是豆包 Seedream（图片模型），不能用于生成视频。请在模型配置中改用 Sora-2、Veo，或平台提供的豆包 Seedance 等视频模型。';
    }
    if (modelName) {
      return `模型「${modelName}」不支持当前视频接口。请在「模型配置」或 AI工作台 里更换为支持图生视频/文生视频的模型。`;
    }
    return '当前选择的模型与视频接口不匹配。请检查模型配置中的「API 模型名」是否为视频模型（勿将图片模型填在视频栏）。';
  }

  if (status === 400 && (msgLower.includes('model') && msgLower.includes('not found'))) {
    return '找不到所填写的模型名称，请核对上游平台文档中的视频模型 ID 是否填写正确。';
  }

  if (status === 400 && (msgLower.includes('prompt') || msgLower.includes('parameter')) && msgLower.includes('required')) {
    return '缺少必填参数（如提示词或参考图），请检查镜头是否已生成起始帧并填写视频描述。';
  }

  if (rawMsg && rawMsg.length > 0) {
    if (rawMsg.startsWith('{')) {
      return '视频服务返回了异常数据，请稍后重试或联系平台。';
    }
    const hasChinese = /[\u4e00-\u9fff]/.test(rawMsg);
    if (!hasChinese && rawMsg.length > 80) {
      return '视频服务拒绝了本次请求，常见原因：模型名称错误、该模型不支持当前视频接口、或参数不符合平台要求。请在模型配置中核对「API 模型名」是否为视频模型。';
    }
    const short =
      rawMsg.length > 120
        ? rawMsg.slice(0, 117).replace(/\s+\S*$/, '') + '…'
        : rawMsg;
    return `视频生成未成功：${short}`;
  }

  if (!parsed && trimmedBody.length > 0 && !trimmedBody.startsWith('{')) {
    const plain = stripRequestIdTail(trimmedBody.replace(/\s+/g, ' '));
    const clip = plain.length > 120 ? plain.slice(0, 117) + '…' : plain;
    return `视频服务暂时无法完成请求（HTTP ${status}）。${clip ? `说明：${clip}` : '请稍后重试。'}`;
  }

  return `视频生成失败（HTTP ${status}），请检查网络、API Key 与模型配置后重试。`;
}

export function throwFromVideoHttpError(status: number, bodyText: string, mode: 'sora' | 'veo' = 'sora'): never {
  throw new Error(formatVideoRequestErrorForUser(status, bodyText, mode));
}

export async function throwFromVideoResponse(res: Response, mode: 'sora' | 'veo' = 'sora'): Promise<never> {
  const text = await res.text();
  throwFromVideoHttpError(res.status, text, mode);
}
