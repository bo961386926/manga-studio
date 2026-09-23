// Remote migration: collect legacy localStorage into an export payload for the
// Electron bridge, and import an encrypted envelope via the authenticated
// same-origin API. No local Express gateway is added.
import { apiFetch } from './storageService';

export interface LegacyExportPayload {
  registry?: unknown;
  apiKey?: string;
  modelConfig?: unknown;
}

const LEGACY_KEYS = ['manga_studio_model_registry', 'antsk_api_key', 'manga_studio_model_config'] as const;
const PREFIX = 'manga_studio_config:';

const readLocal = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key) ?? window.localStorage.getItem(`${PREFIX}${key}`);
  } catch {
    return null;
  }
};

const parse = (raw: string | null): any => {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

export const collectLegacyExportPayload = (): LegacyExportPayload => {
  const payload: LegacyExportPayload = {};
  const registry = parse(readLocal(LEGACY_KEYS[0]));
  const apiKey = parse(readLocal(LEGACY_KEYS[1]));
  const modelConfig = parse(readLocal(LEGACY_KEYS[2]));
  if (registry && typeof registry === 'object') payload.registry = registry;
  if (apiKey) payload.apiKey = String(apiKey);
  if (modelConfig) payload.modelConfig = modelConfig;
  return payload;
};

export const hasLegacyExport = (): boolean => {
  const p = collectLegacyExportPayload();
  return Boolean(p.registry || p.apiKey || p.modelConfig);
};

export interface BridgeExportResult {
  ok: boolean;
  path?: string;
  reason?: string;
}

// Ask the Electron main process to seal and save the envelope (v1, Argon2id).
export const exportLegacyViaBridge = async (password: string): Promise<BridgeExportResult> => {
  const bridge = (window as any).mangaStudioBridge;
  if (!bridge?.exportLegacy) throw new Error('Electron 导出桥接不可用');
  const payload = collectLegacyExportPayload();
  if (!hasLegacyExport()) throw new Error('未发现可导出的本地配置');
  return bridge.exportLegacy(payload, password) as Promise<BridgeExportResult>;
};

// Import an envelope created by the old Electron release (authenticated admin).
export const importRemoteEnvelope = async (
  envelope: unknown,
  password: string,
  deploymentId: string
): Promise<any> => {
  return apiFetch('/migration/import', {
    method: 'POST',
    body: JSON.stringify({ envelope, password, deploymentId }),
  });
};
