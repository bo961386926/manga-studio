import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  scanLegacyConfig, 
  uploadLegacyConfig, 
  deleteLegacyLocalConfig, 
  maskSecret, 
  readLocalStorage, 
  removeLocalKey, 
  parseJson 
} from '../../services/modelRegistry/migration';
import { apiFetch } from '../../services/storageService';

// Mock storageService
vi.mock('../../services/storageService', () => ({
  apiFetch: vi.fn(),
}));

describe('migration.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear localStorage
    if (typeof window !== 'undefined') {
      window.localStorage.clear();
    }
  });

  describe('maskSecret', () => {
    it('null/undefined/空字符串返回 null', () => {
      expect(maskSecret(null)).toBeNull();
      expect(maskSecret(undefined)).toBeNull();
      expect(maskSecret('')).toBeNull();
    });

    it('短字符串(<=8) 返回 ****', () => {
      expect(maskSecret('abc')).toBe('****');
      expect(maskSecret('12345678')).toBe('****');
    });

    it('长字符串返回 前4后4 掩码', () => {
      expect(maskSecret('sk-1234567890abcdef')).toBe('sk-1****cdef');
      expect(maskSecret('abcdefghijkl')).toBe('abcd****ijkl');
    });
  });

  describe('readLocalStorage', () => {
    it('读取直接 key', () => {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('test-key', 'direct-value');
        expect(readLocalStorage('test-key')).toBe('direct-value');
      }
    });

    it('回退读取带前缀 key', () => {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('manga_studio_config:prefixed-key', 'prefixed-value');
        expect(readLocalStorage('prefixed-key')).toBe('prefixed-value');
      }
    });

    it('不存在返回 null', () => {
      expect(readLocalStorage('non-existent')).toBeNull();
    });

    it('SSR 环境返回 null', () => {
      // 模拟 window 未定义
      const originalWindow = global.window;
      // @ts-ignore
      delete global.window;
      expect(readLocalStorage('any')).toBeNull();
      global.window = originalWindow;
    });
  });

  describe('removeLocalKey', () => {
    it('删除直接 key 和带前缀 key', () => {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('test-key', 'value');
        window.localStorage.setItem('manga_studio_config:test-key', 'value');
        removeLocalKey('test-key');
        expect(window.localStorage.getItem('test-key')).toBeNull();
        expect(window.localStorage.getItem('manga_studio_config:test-key')).toBeNull();
      }
    });

    it('SSR 环境不报错', () => {
      const originalWindow = global.window;
      // @ts-ignore
      delete global.window;
      expect(() => removeLocalKey('any')).not.toThrow();
      global.window = originalWindow;
    });
  });

  describe('parseJson', () => {
    it('null 返回 null', () => {
      expect(parseJson(null)).toBeNull();
    });

    it('有效 JSON 解析', () => {
      expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    });

    it('无效 JSON 原样返回', () => {
      expect(parseJson('not-json')).toBe('not-json');
    });
  });

  describe('scanLegacyConfig', () => {
    it('无遗留配置返回 present=false', () => {
      const result = scanLegacyConfig();
      expect(result.present).toBe(false);
      expect(result.modelCount).toBe(0);
      expect(result.providerCount).toBe(0);
    });

    it('检测到 registry 返回统计', () => {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('manga_studio_model_registry', JSON.stringify({
          models: [{}, {}, {}],
          providers: [{}, {}],
        }));
        const result = scanLegacyConfig();
        expect(result.present).toBe(true);
        expect(result.modelCount).toBe(3);
        expect(result.providerCount).toBe(2);
      }
    });

    it('检测到 apiKey 返回掩码', () => {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('antsk_api_key', 'sk-1234567890abcdef');
        const result = scanLegacyConfig();
        expect(result.present).toBe(true);
        expect(result.apiKeyMasked).toBe('sk-1****cdef');
      }
    });

    it('检测到 modelConfig', () => {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('manga_studio_model_config', '{}');
        const result = scanLegacyConfig();
        expect(result.present).toBe(true);
        expect(result.modelConfigPresent).toBe(true);
      }
    });
  });

  describe('uploadLegacyConfig', () => {
    it('上传 payload 包含检测到的配置', async () => {
      const mockResponse = { success: true, modelCount: 5 };
      vi.mocked(apiFetch).mockResolvedValue(mockResponse);
      
      // Manually construct summary with registry to test the upload path
      const summary = {
        present: true,
        registry: { models: [], providers: [] },
        apiKeyMasked: 'sk-1****cdef',
        modelConfigPresent: false,
        modelCount: 0,
        providerCount: 0,
      };
      
      const result = await uploadLegacyConfig(summary);
      
      expect(apiFetch).toHaveBeenCalledWith('/admin/migration/model-config', {
        method: 'POST',
        body: expect.stringContaining('registry'),
      });
      // Function returns whatever apiFetch returns
      expect(result).toEqual(mockResponse);
    });
  });

  describe('deleteLegacyLocalConfig', () => {
    it('删除三个遗留 key', () => {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('manga_studio_model_registry', '{}');
        window.localStorage.setItem('antsk_api_key', 'key');
        window.localStorage.setItem('manga_studio_model_config', '{}');
        deleteLegacyLocalConfig();
        expect(window.localStorage.getItem('manga_studio_model_registry')).toBeNull();
        expect(window.localStorage.getItem('antsk_api_key')).toBeNull();
        expect(window.localStorage.getItem('manga_studio_model_config')).toBeNull();
      }
    });
  });
});