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

const apiFetch = async (path: string, options?: RequestInit): Promise<any> => {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
};

// ========== Projects ==========

export const saveProjectToDB = async (project: ProjectState): Promise<void> => {
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