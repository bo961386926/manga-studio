/**
 * Model Registry - 统一门面导出
 * 
 * 内部模块：
 * - registryCore: 核心状态管理 (load/save/init/reset)
 * - providers: 提供商 CRUD
 * - models: 模型 CRUD + 激活模型管理
 * - keys: API Key 管理 (已废弃，仅兼容)
 * - defaults: 默认值辅助函数
 * - migration: 遗留配置迁移
 * - utils: 共享工具函数
 */

// Core
export {
  loadRegistry,
  saveRegistry,
  initRegistry,
  getRegistryState,
  resetRegistry,
  getDefaultState,
  parseAndMergeState,
} from './registryCore';

// Providers
export {
  getProviders,
  getProviderById,
  getDefaultProvider,
  addProvider,
  updateProvider,
  removeProvider,
} from './providers';

// Models
export {
  getModels,
  getChatModels,
  getImageModels,
  getVideoModels,
  getModelById,
  getActiveModel,
  getActiveChatModel,
  getActiveImageModel,
  getActiveVideoModel,
  setActiveModel,
  registerModel,
  updateModel,
  removeModel,
  toggleModelEnabled,
} from './models';

// Keys (deprecated)
export {
  getGlobalApiKey,
  setGlobalApiKey,
  getKeyMode,
  setKeyMode,
  getApiKeyForModel,
  getApiBaseUrlForModel,
} from './keys';

// Defaults
export {
  getActiveModelsConfig,
  isModelAvailable,
  getDefaultAspectRatio,
  getDefaultVideoDuration,
  getVideoModelType,
} from './defaults';

// Migration
export {
  LEGACY_MIGRATION_KEYS,
  scanLegacyConfig,
  uploadLegacyConfig,
  deleteLegacyLocalConfig,
  maskSecret,
  readLocalStorage,
  removeLocalKey,
  parseJson,
} from './migration';

// Types (re-export for convenience)
export type {
  ModelType,
  ModelDefinition,
  ModelProvider,
  ModelRegistryState,
  ActiveModels,
  ChatModelDefinition,
  ImageModelDefinition,
  VideoModelDefinition,
  AspectRatio,
  VideoDuration,
} from '../../types/model';

export type { LegacyMigrationSummary } from './migration';