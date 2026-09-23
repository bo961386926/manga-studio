// Authenticated gateway client. The browser sends only modelId + operation +
// business params + Idempotency-Key; never targetUrl or credentials.
import { apiFetch } from './storageService';
import type {
  ChatInvokeV1,
  ChatResultV1,
  ImageInvokeV1,
  VideoInvokeV1,
  AssetResultV1,
  JobAcceptedV1,
  GatewayResultV1,
  GatewayApiError,
  ProviderDTO,
  ModelDTO,
  ModelOperation,
} from '../types/modelGateway';

// Stable idempotency key per user action: deterministic for retries of the
// same logical action, unique across actions.
export const makeIdempotencyKey = (action: string): string => {
  const nonce =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${action}-${nonce}`;
};

const toApiError = async (res: Response): Promise<GatewayApiError> => {
  let body: any = {};
  try {
    body = await res.json();
  } catch {
    // ignore
  }
  const err = new Error(body?.error?.message || `HTTP ${res.status}`) as GatewayApiError;
  err.code = body?.error?.code;
  err.status = res.status;
  err.requestId = body?.error?.requestId;
  err.retryable = body?.error?.retryable;
  return err;
};

interface InvokeOptions {
  signal?: AbortSignal;
}

export const invokeChat = async (
  modelId: string,
  params: Omit<ChatInvokeV1, 'schemaVersion'>,
  idempotencyKey: string,
  opts: InvokeOptions = {}
): Promise<ChatResultV1> => {
  return apiFetch(`/model-invocations/invocations`, {
    method: 'POST',
    signal: opts.signal,
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ modelId, operation: 'chat', ...params }),
  });
};

export const invokeImage = async (
  modelId: string,
  params: Omit<ImageInvokeV1, 'schemaVersion'>,
  idempotencyKey: string,
  opts: InvokeOptions = {}
): Promise<AssetResultV1> => {
  return apiFetch(`/model-invocations/invocations`, {
    method: 'POST',
    signal: opts.signal,
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ modelId, operation: 'image', ...params }),
  });
};

export const invokeVideo = async (
  modelId: string,
  params: Omit<VideoInvokeV1, 'schemaVersion'>,
  idempotencyKey: string,
  opts: InvokeOptions = {}
): Promise<JobAcceptedV1> => {
  return apiFetch(`/model-invocations/invocations`, {
    method: 'POST',
    signal: opts.signal,
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ modelId, operation: 'video', ...params }),
  });
};

export const getJob = async (jobId: string): Promise<any> => {
  return apiFetch(`/model-invocations/jobs/${jobId}`);
};

export const cancelJob = async (jobId: string): Promise<any> => {
  return apiFetch(`/model-invocations/jobs/${jobId}/cancel`, { method: 'POST' });
};

export const testModel = async (
  modelId: string,
  operation: ModelOperation,
  confirmCharge: boolean
): Promise<GatewayResultV1> => {
  if (!confirmCharge) {
    const err = new Error('charge confirmation required') as GatewayApiError;
    err.code = 'CHARGE_CONFIRMATION_REQUIRED';
    err.status = 409;
    throw err;
  }
  return apiFetch(`/model-invocations/test`, {
    method: 'POST',
    body: JSON.stringify({ modelId, operation, confirmCharge: true }),
  });
};

// ---------- Provider / Model CRUD ----------

export const listProviders = async (): Promise<ProviderDTO[]> => {
  const res = await apiFetch(`/model-invocations/providers`);
  return res.providers;
};

export const createProvider = async (input: {
  name: string;
  baseUrl: string;
  authType: 'none' | 'bearer' | 'api-key-header';
  authHeaderName?: string;
  scope?: 'private' | 'shared';
}): Promise<{ id: string }> => {
  return apiFetch(`/model-invocations/providers`, { method: 'POST', body: JSON.stringify(input) });
};

export const setProviderCredential = async (providerId: string, secret: string): Promise<void> => {
  await apiFetch(`/model-invocations/providers/${providerId}/credential`, {
    method: 'POST',
    body: JSON.stringify({ secret }),
  });
};

export const deleteProvider = async (providerId: string): Promise<void> => {
  await apiFetch(`/model-invocations/providers/${providerId}`, { method: 'DELETE' });
};

export const listModels = async (): Promise<ModelDTO[]> => {
  const res = await apiFetch(`/model-invocations/models`);
  return res.models;
};

export const createModel = async (input: {
  providerId: string;
  name: string;
  apiModel: string;
  capability: 'chat' | 'image' | 'video';
  adapterKind: string;
  protocolPreset: string;
  endpointPath: string;
  accessLevel?: 'verified' | 'vip' | 'admin';
}): Promise<{ id: string }> => {
  return apiFetch(`/model-invocations/models`, { method: 'POST', body: JSON.stringify(input) });
};

export const deleteModel = async (modelId: string): Promise<void> => {
  await apiFetch(`/model-invocations/models/${modelId}`, { method: 'DELETE' });
};
