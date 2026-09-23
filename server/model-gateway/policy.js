// Model gateway policy: owner/scope/access/VIP/operation/size/quota checks.
// Design source: self-hosted-cloud-models-design.md §5.2, §9.
import { canUseCapability } from '../auth/entitlements.js';

export class PolicyError extends Error {
  constructor(code, message, status = 403) {
    super(message);
    this.name = 'PolicyError';
    this.code = code;
    this.status = status;
  }
}

export const MAX_PROMPT_BYTES = 256 * 1024;
export const MAX_SYSTEM_PROMPT_BYTES = 64 * 1024;
export const MAX_REFERENCE_IMAGES = 16;
export const MAX_FRAME_REFS = 2;
export const MAX_REFERENCE_BYTES = 50 * 1024 * 1024;
export const ALLOWED_ASPECT_RATIOS = ['16:9', '9:16', '1:1'];

// Resolve the effective access level for a model and check the caller.
// Private models: owner only, and VIP is required to create/call them.
// Shared models: access_level ('verified' | 'vip' | 'admin') governs.
export const assertModelAccess = async ({ model, provider, userId, isAdmin }) => {
  if (!model || model.deleted_at || !model.enabled) {
    throw new PolicyError('MODEL_UNAVAILABLE', 'model unavailable', 404);
  }
  if (!provider || provider.deleted_at || !provider.enabled) {
    throw new PolicyError('PROVIDER_UNAVAILABLE', 'provider unavailable', 404);
  }
  if (provider.scope === 'private') {
    if (provider.owner_user_id !== userId) {
      throw new PolicyError('FORBIDDEN', 'not your model', 404);
    }
    const ok = await canUseCapability({ userId, accessLevel: 'vip' });
    if (!ok) throw new PolicyError('VIP_REQUIRED', 'vip entitlement required', 403);
  } else if (provider.scope === 'shared') {
    if (model.access_level === 'admin' && !isAdmin) {
      throw new PolicyError('ADMIN_ONLY', 'admin access required', 403);
    }
    if (model.access_level === 'vip') {
      const ok = await canUseCapability({ userId, accessLevel: 'vip' });
      if (!ok) throw new PolicyError('VIP_REQUIRED', 'vip entitlement required', 403);
    }
  } else {
    throw new PolicyError('FORBIDDEN', 'invalid provider scope', 403);
  }
  return { model, provider };
};

export const byteLength = (s) => Buffer.byteLength(s || '', 'utf8');

export const assertPrompt = (prompt, label = 'prompt') => {
  if (typeof prompt !== 'string' || prompt.length === 0) {
    throw new PolicyError('INVALID_PARAMS', `${label} is required`, 422);
  }
  if (byteLength(prompt) > MAX_PROMPT_BYTES) {
    throw new PolicyError('PAYLOAD_TOO_LARGE', `${label} exceeds 256 KiB`, 413);
  }
};

export const assertAspectRatio = (aspectRatio) => {
  if (!ALLOWED_ASPECT_RATIOS.includes(aspectRatio)) {
    throw new PolicyError('INVALID_PARAMS', 'invalid aspectRatio', 422);
  }
};

// Validate a video duration against the model's configured allowed durations.
export const assertDuration = (duration, allowedDurations = []) => {
  const durations = allowedDurations.length ? allowedDurations : [8];
  if (!durations.includes(duration)) {
    throw new PolicyError('INVALID_PARAMS', 'duration not allowed for this model', 422);
  }
};

export const assertReferenceCount = (ids, max, label) => {
  const list = Array.isArray(ids) ? ids : [];
  if (list.length > max) {
    throw new PolicyError('INVALID_PARAMS', `${label} exceeds limit (${max})`, 422);
  }
  for (const id of list) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
      throw new PolicyError('INVALID_PARAMS', `${label} contains invalid asset id`, 422);
    }
  }
};

export const assertMediaSize = (sizeBytes) => {
  if (sizeBytes > MAX_REFERENCE_BYTES) {
    throw new PolicyError('PAYLOAD_TOO_LARGE', 'reference media exceeds 50 MiB', 413);
  }
};
