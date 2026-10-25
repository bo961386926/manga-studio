/**
 * 旧厂商直连通道（proxyFetch）已随 /api/ai-forward 下线。
 *
 * 该函数是所有 legacy 适配器的唯一失败出口（chat/image/video 共 30+ 调用点），
 * 用户最终在界面上看到的就是它的 error.message。因此它必须给出**可执行的中文指引**，
 * 而不是暴露内部实现细节（英文的 "legacy forward proxy removed"）——后者让用户
 * 完全不知道下一步该做什么。
 */
import { describe, it, expect } from 'vitest';
import { proxyFetch } from '../services/apiClient';

describe('legacy 通道的用户可见错误（F4-7）', () => {
  it('抛出可执行的中文指引，而不是内部实现细节', async () => {
    await expect(proxyFetch('https://example.com/v1/chat/completions')).rejects.toThrow();

    let message = '';
    try {
      await proxyFetch('https://example.com/v1/chat/completions');
    } catch (err: any) {
      message = String(err?.message || '');
    }

    // 必须指向「下一步做什么」
    expect(message).toMatch(/模型配置|网关/);
    expect(message).toMatch(/服务商|模型/);
    // 不得把内部黑话甩给用户
    expect(message).not.toMatch(/legacy forward proxy/i);
    expect(message).not.toMatch(/self-hosted gateway/i);
  });
});
