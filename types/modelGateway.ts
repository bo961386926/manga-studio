// Shared gateway DTOs (v1). Browser never sends targetUrl or credentials;
// it sends modelId + business params + Idempotency-Key.
// Design source: self-hosted-cloud-models-design.md §9.

export type MediaRef = {
  kind: 'media';
  id: string;
  contentType: string;
  sizeBytes: number;
};

export interface ChatInvokeV1 {
  schemaVersion: 1;
  prompt: string;
  systemPrompt?: string;
  responseFormat?: 'text' | 'json';
}

export interface ChatResultV1 {
  schemaVersion: 1;
  kind: 'chat';
  content: string;
  responseFormat: 'text' | 'json';
}

export interface ImageInvokeV1 {
  schemaVersion: 1;
  prompt: string;
  aspectRatio: '16:9' | '9:16' | '1:1';
  referenceAssetIds?: string[];
}

export interface VideoInvokeV1 {
  schemaVersion: 1;
  prompt: string;
  aspectRatio: '16:9' | '9:16' | '1:1';
  duration: number;
  startAssetId?: string;
  endAssetId?: string;
}

export type AssetResultV1 = {
  schemaVersion: 1;
  kind: 'asset';
  assetId: string;
  contentType: string;
  sizeBytes: number;
};

export type JobAcceptedV1 = {
  schemaVersion: 1;
  kind: 'job';
  jobId: string;
  status: string;
};

export type GatewayErrorBody = {
  schemaVersion: 1;
  error: {
    code: string;
    message: string;
    requestId?: string;
    retryable?: boolean;
  };
};

export type GatewayResultV1 = ChatResultV1 | AssetResultV1 | JobAcceptedV1;

// ---------- admin/CRUD DTOs ----------

export interface ProviderDTO {
  id: string;
  scope: 'private' | 'shared';
  name: string;
  baseUrl: string;
  authType: 'none' | 'bearer' | 'api-key-header';
  authHeaderName?: string | null;
  credentialConfigured: boolean;
  enabled: boolean;
}

export interface ModelDTO {
  id: string;
  name: string;
  apiModel: string;
  capability: 'chat' | 'image' | 'video';
  adapterKind: string;
  protocolPreset?: string | null;
  endpointPath: string;
  accessLevel: 'verified' | 'vip' | 'admin';
  enabled: boolean;
  providerScope: 'private' | 'shared';
  providerName: string;
}

export type ModelOperation = 'chat' | 'image' | 'video' | 'test';

/**
 * 服务商预设（服务端下发）：把 base URL / 协议预设 / 端点路径这些内部细节
 * 固定下来，用户界面上只需「选服务商 → 填 API Key → 勾模型」。
 */
export interface ProviderPresetDTO {
  key: string;
  name: string;
  baseUrl: string;
  authType: 'none' | 'bearer' | 'api-key-header';
  hint: string;
  capabilities: Partial<
    Record<'chat' | 'image' | 'video', { protocolPreset: string; endpointPath: string; baseUrlOverride?: string }>
  >;
  suggestedModels: Array<{ apiModel: string; name: string; capability: 'chat' | 'image' | 'video' }>;
}

export interface GatewayApiError extends Error {
  code?: string;
  status?: number;
  requestId?: string;
  retryable?: boolean;
}
