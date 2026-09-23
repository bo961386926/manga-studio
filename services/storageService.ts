// Author: forsearch | Updated: 2026-06-26
import { ProjectState, AssetLibraryItem } from '../types';

const API_BASE = '/api';
const LOCAL_STORAGE_CONFIG_PREFIX = 'manga_studio_config:';

const getLocalStorageConfig = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(`${LOCAL_STORAGE_CONFIG_PREFIX}${key}`);
  } catch {
    return null;
  }
};

const setLocalStorageConfig = (key: string, value: string): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${LOCAL_STORAGE_CONFIG_PREFIX}${key}`, value);
  } catch {
    // ignore storage quota issues
  }
};

const removeLocalStorageConfig = (key: string): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(`${LOCAL_STORAGE_CONFIG_PREFIX}${key}`);
  } catch {
    // ignore storage quota issues
  }
};

// Session-scoped CSRF state (raw token held only in memory, never persisted).
let csrfToken: string | undefined;

export const setCsrfToken = (t?: string): void => {
  csrfToken = t;
};

export const getCsrfToken = (): string | undefined => csrfToken;

export const apiFetch = async (path: string, options?: RequestInit): Promise<any> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options?.headers as Record<string, string>) || {}),
  };
  if (options?.method && options.method !== 'GET' && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  if (res.status === 401) {
    // Session lost; drop the in-memory CSRF token.
    csrfToken = undefined;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
};

// ========== Projects ==========

// 完整项目必须有 shots 键（哪怕是空数组）。列表接口返回的"元数据"对象
// （仅 id/title/stage/cover/logline）没有该键——拒绝保存，防止元数据
// 覆盖掉数据库中的完整项目内容。
const isFullProjectShape = (project: ProjectState): boolean =>
  project &&
  typeof project === 'object' &&
  'shots' in project &&
  'scriptData' in project &&
  typeof project.id === 'string';

export const saveProjectToDB = async (project: ProjectState): Promise<void> => {
  if (!isFullProjectShape(project)) {
    throw new Error('项目数据不完整，拒绝保存（列表元数据不可写回数据库）');
  }
  await apiFetch('/projects', {
    method: 'POST',
    body: JSON.stringify({ ...project, lastModified: Date.now() }),
  });
};

export const loadProjectFromDB = async (id: string): Promise<ProjectState> => {
  const project = await apiFetch(`/projects/${encodeURIComponent(id)}`);
  if (!project.renderLogs) {
    project.renderLogs = [];
  }
  return project;
};

export const getAllProjectsMetadata = async (): Promise<ProjectState[]> => {
  return apiFetch('/projects');
};

export const deleteProjectFromDB = async (id: string): Promise<void> => {
  await apiFetch(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
};

// ========== Assets ==========

export const saveAssetToLibrary = async (item: AssetLibraryItem): Promise<void> => {
  await apiFetch('/assets', {
    method: 'POST',
    body: JSON.stringify(item),
  });
};

export const getAllAssetLibraryItems = async (): Promise<AssetLibraryItem[]> => {
  return apiFetch('/assets');
};

export const deleteAssetFromLibrary = async (id: string): Promise<void> => {
  await apiFetch(`/assets/${encodeURIComponent(id)}`, { method: 'DELETE' });
};

// ========== Image helpers (no storage involved) ==========

export const convertImageToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('只支持图片文件'));
      return;
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      reject(new Error('图片大小不能超过 10MB'));
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const result = reader.result as string;
      resolve(result);
    };

    reader.onerror = () => {
      reject(new Error('图片读取失败'));
    };

    reader.readAsDataURL(file);
  });
};

// ========== Config ==========

export const getConfig = async (key: string): Promise<string | null> => {
  try {
    const value = await apiFetch(`/config/${encodeURIComponent(key)}`);
    // value is already the JSON value from API; if it was stored as string, return as-is
    const normalized = typeof value === 'string' ? value : JSON.stringify(value);
    if (normalized !== null) {
      setLocalStorageConfig(key, normalized);
    }
    return normalized;
  } catch {
    return getLocalStorageConfig(key);
  }
};

export const setConfig = async (key: string, value: string): Promise<void> => {
  let parsed: any = value;
  try {
    parsed = JSON.parse(value);
  } catch {
    // not JSON, store as plain string
  }

  const serializedValue = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
  setLocalStorageConfig(key, serializedValue);

  try {
    await apiFetch(`/config/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value: parsed }),
    });
  } catch {
    // ignore API failure; localStorage fallback already saved
  }
};

export const removeConfig = async (key: string): Promise<void> => {
  removeLocalStorageConfig(key);
  try {
    await apiFetch(`/config/${encodeURIComponent(key)}`, { method: 'DELETE' });
  } catch {
    // ignore
  }
};

// ========== Legacy migration (no-op with PostgreSQL) ==========

export const migrateConfigFromLocalStorage = async (): Promise<void> => {
  // With PostgreSQL backend, no migration from localStorage needed.
  // Keep API compatibility.
};

// ========== Project factory ==========

export const createNewProjectState = (): ProjectState => {
  const id = 'proj_' + Date.now().toString(36);
  return {
    id,
    title: '未命名项目',
    createdAt: Date.now(),
    lastModified: Date.now(),
    stage: 'script',
    targetDuration: '60s',
    language: '中文',
    visualStyle: 'live-action',
    shotGenerationModel: 'gpt-5.1',
    rawScript: `标题：示例剧本

场景 1
外景。夜晚街道 - 雨夜
霓虹灯在水坑中反射出破碎的光芒。
侦探（30岁,穿着风衣）站在街角,点燃了一支烟。

侦探
这雨什么时候才会停？`,
    scriptData: null,
    shots: [],
    isParsingScript: false,
    renderLogs: [],
  };
};