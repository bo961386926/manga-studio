// Legacy model configuration migration: deterministic ownership mapping and
// one-time admin import into user_settings. Design source:
// self-hosted-cloud-models-design.md §9.3 and data-isolation plan Task 3.
import { setUserSetting, removeUserSetting } from '../repositories/settings.js';
import { recordAudit } from '../auth/audit.js';

// Deterministic mapping:
// - built-in models become shared (server-wide, confirmed by admin);
// - old custom (self-hosted) models become private, owned by the bootstrap admin.
export const classifyLegacyModel = ({ id, provider }, { isBuiltIn, adminId }) => {
  if (isBuiltIn) return { scope: 'shared', ownerId: null };
  return { scope: 'private', ownerId: adminId };
};

export const classifyRegistry = (registry, { adminId }) => {
  const models = Array.isArray(registry?.models) ? registry.models : [];
  return models.map((m) => ({
    id: m.id,
    scope: classifyLegacyModel(m, { isBuiltIn: m.isBuiltIn === true, adminId }).scope,
    ownerId: classifyLegacyModel(m, { isBuiltIn: m.isBuiltIn === true, adminId }).ownerId,
  }));
};

// Mask credentials for reports and UI summaries.
export const maskSecret = (value) => {
  if (!value) return null;
  const s = String(value);
  if (s.length <= 8) return '****';
  return `${s.slice(0, 4)}****${s.slice(-4)}`;
};

// One-time import: stores the legacy registry/api key under the admin's user
// settings with a deterministic ownership report. Returns a masked report.
export const importModelConfig = async ({ adminId, registry, apiKey, modelConfig }) => {
  const report = {
    modelCount: Array.isArray(registry?.models) ? registry.models.length : 0,
    providerCount: Array.isArray(registry?.providers) ? registry.providers.length : 0,
    ownership: classifyRegistry(registry, { adminId }),
    apiKeyConfigured: Boolean(apiKey),
    hasModelConfig: Boolean(modelConfig),
  };
  if (registry) {
    await setUserSetting(adminId, 'model_registry', {
      ...registry,
      migrationOwnership: report.ownership,
    });
  }
  if (apiKey) {
    await setUserSetting(adminId, 'antsk_api_key', apiKey);
  }
  if (modelConfig) {
    await setUserSetting(adminId, 'model_config', modelConfig);
  }
  await recordAudit({
    actorUserId: adminId,
    targetUserId: adminId,
    eventType: 'migration.model_config.import',
    result: 'success',
    metadata: { action: 'migrate', detail: `models=${report.modelCount} providers=${report.providerCount}` },
  });
  return {
    ...report,
    apiKeyMasked: maskSecret(apiKey),
  };
};

export const clearImportedSettings = async ({ adminId }) => {
  await removeUserSetting(adminId, 'model_registry');
  await removeUserSetting(adminId, 'antsk_api_key');
  await removeUserSetting(adminId, 'model_config');
};
