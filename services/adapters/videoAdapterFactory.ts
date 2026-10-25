import { VideoModelDefinition } from '../../types/model';
import { VideoAdapter, VideoAdapterFactory } from './videoAdapterInterface';
import { veoAdapter } from './veoAdapter';
import { soraAdapter } from './soraAdapter';
import { doubaoAdapter } from './doubaoAdapter';
import { minimaxAdapter } from './minimaxAdapter';

/**
 * 视频适配器工厂 - 根据模型配置自动选择对应的适配器实现
 * 
 * 映射规则：
 * - adapter_kind === 'gateway' -> 由上层 modelService 处理（不走此工厂）
 * - model.params.mode === 'sync' 且 veo 系列模型 -> VeoAdapter
 * - model.params.mode === 'async' 且 sora/openai 系列 -> SoraAdapter
 * - doubao/seedance 系列 -> DoubaoAdapter
 * - minimax/h3 系列 -> MinimaxAdapter
 * - 其余回退到基于 mode 的默认适配器
 */
class VideoAdapterFactoryImpl implements VideoAdapterFactory {
  private adapters = new Map<string, VideoAdapter>([
    ['veo', veoAdapter],
    ['sora', soraAdapter],
    ['doubao', doubaoAdapter],
    ['minimax', minimaxAdapter],
  ]);

  /**
   * 根据模型 ID 或配置推断适配器类型
   */
  private inferAdapterType(model: VideoModelDefinition): string {
    const id = model.id.toLowerCase();
    const apiModel = (model.apiModel || '').toLowerCase();
    const endpoint = (model.endpoint || '').toLowerCase();
    const mode = model.params?.mode || 'async';

    // 明确的模型 ID 模式匹配
    if (id.includes('veo') || apiModel.includes('veo')) return 'veo';
    if (id.includes('sora') || apiModel.includes('sora')) return 'sora';
    if (id.includes('doubao') || apiModel.includes('doubao') || apiModel.includes('seedance')) return 'doubao';
    if (id.includes('minimax') || apiModel.includes('minimax') || apiModel.includes('h3')) return 'minimax';

    // 端点路径匹配
    if (endpoint.includes('/v2/') || endpoint.includes('/v1/videos')) return 'sora'; // OpenAI 兼容异步
    if (endpoint.includes('/contents/generations') || endpoint.includes('/api/v3/')) return 'doubao';

    // 模式回退
    if (mode === 'sync') return 'veo'; // Veo 是同步模式的主力
    return 'sora'; // 默认异步模式
  }

  createVideoAdapter(model: VideoModelDefinition): VideoAdapter {
    const adapterType = this.inferAdapterType(model);
    const adapter = this.adapters.get(adapterType);
    
    if (!adapter) {
      console.warn(`[VideoAdapterFactory] 未知适配器类型: ${adapterType}，回退到 sora`);
      return this.adapters.get('sora')!;
    }
    
    console.log(`[VideoAdapterFactory] 使用 ${adapter.name} 适配器处理模型: ${model.id}`);
    return adapter;
  }

  getSupportedModels(): string[] {
    return Array.from(this.adapters.keys());
  }

  /** 注册自定义适配器（用于扩展） */
  registerAdapter(name: string, adapter: VideoAdapter): void {
    this.adapters.set(name.toLowerCase(), adapter);
  }
}

export const videoAdapterFactory = new VideoAdapterFactoryImpl();
export type { VideoAdapter, VideoAdapterFactory } from './videoAdapterInterface';