import { apiFetch } from '../storageService';

const STORAGE_KEY = 'manga_studio_model_registry';
const API_KEY_STORAGE_KEY = 'antsk_api_key';

export const LEGACY_MIGRATION_KEYS = [
  'manga_studio_model_registry',
  'antsk_api_key',
  'manga_studio_model_config',
] as const;

const LOCAL_STORAGE_PREFIX = 'manga_studio_config:';

const readLocalStorage = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key) ?? window.localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${key}`);
  } catch {
    return null;
  }
};

const removeLocalKey = (key: string): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
    window.localStorage.removeItem(`${LOCAL_STORAGE_PREFIX}${key}`);
  } catch {
    // ignore storage errors
  }
};

const parseJson = (raw: string | null): any => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const maskSecret = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value);
  if (s.length <= 8) return '****';
  return `${s.slice(0, 4)}****${s.slice(-4)}`;
};

export interface LegacyMigrationSummary {
  present: boolean;
  registry?: any;
  apiKeyMasked?: string | null;
  modelConfigPresent: boolean;
  modelCount: number;
  providerCount: number;
}

export const scanLegacyConfig = (): LegacyMigrationSummary => {
  const registry = parseJson(readLocalStorage(LEGACY_MIGRATION_KEYS[0]));
  const apiKey = parseJson(readLocalStorage(LEGACY_MIGRATION_KEYS[1]));
  const modelConfig = parseJson(readLocalStorage(LEGACY_MIGRATION_KEYS[2]));
  const registryPresent = registry && typeof registry === 'object' && Array.isArray(registry.models);
  return {
    present: Boolean(registryPresent || apiKey || modelConfig),
    registry: registryPresent ? registry : undefined,
    apiKeyMasked: apiKey ? maskSecret(apiKey) : null,
    modelConfigPresent: Boolean(modelConfig),
    modelCount: registryPresent ? registry.models.length : 0,
    providerCount: registryPresent ? registry.providers?.length ?? 0 : 0,
  };
};

export const uploadLegacyConfig = async (
  summary: LegacyMigrationSummary
): Promise<{ modelCount: number; apiKeyMasked?: string | null }> => {
  const payload: Record<string, unknown> = {};
  if (summary.registry) payload.registry = summary.registry;
  const apiKey = parseJson(readLocalStorage(LEGACY_MIGRATION_KEYS[1]));
  if (apiKey) payload.apiKey = apiKey;
  const modelConfig = parseJson(readLocalStorage(LEGACY_MIGRATION_KEYS[2]));
  if (modelConfig) payload.modelConfig = modelConfig;
  return apiFetch('/admin/migration/model-config', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

export const deleteLegacyLocalConfig = (): void => {
  for (const key of LEGACY_MIGRATION_KEYS) {
    removeLocalKey(key);
  }
};

export { maskSecret, readLocalStorage, removeLocalKey, parseJson };