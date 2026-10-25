/**
 * 模型选择器 —— 数据源是服务端网关模型（多服务商/多模型改造后唯一可信来源）。
 *
 * 旧客户端目录（vendor 直连模型）已随 /api/ai-forward 下线而不可用，不再出现在
 * 选项里误导用户。网关列表变化（网关面板增删服务商/模型、迁移向导导入）通过
 * `gateway-models-changed` 窗口事件广播，本组件监听后强制刷新。
 *
 * 值语义：value = 网关模型 id。父组件存量的旧目录 id（如 doubao-pro-32k）在
 * 列表加载后不匹配任何选项，由 shouldAdoptGatewayModel 自动采用第一个可用模型。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Cpu, ChevronDown } from 'lucide-react';
import { ModelType } from '../types/model';
import {
  buildGatewayModelOptions,
  loadGatewayModels,
  shouldAdoptGatewayModel,
  GATEWAY_MODELS_CHANGED_EVENT,
  type GatewayCapability,
  type GatewayModelOption,
} from '../services/gatewayModels';

const capOf = (type: ModelType): GatewayCapability => type;

interface ModelSelectorProps {
  type: ModelType;
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
}

const selectCls =
  'appearance-none bg-white/[0.06] border border-white/10 text-white text-xs rounded-xl focus:border-cyan-300/40 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer';

const ModelSelector: React.FC<ModelSelectorProps> = ({
  type,
  value,
  onChange,
  disabled = false,
  compact = false,
  label,
}) => {
  // null = 加载中；[] = 服务端没有任何该能力的可用模型
  const [options, setOptions] = useState<GatewayModelOption[] | null>(null);

  const refresh = useCallback(
    async (force: boolean) => {
      const models = await loadGatewayModels(force);
      setOptions(buildGatewayModelOptions(models, capOf(type)));
    },
    [type]
  );

  useEffect(() => {
    refresh(false);
    const onChanged = () => refresh(true);
    window.addEventListener(GATEWAY_MODELS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(GATEWAY_MODELS_CHANGED_EVENT, onChanged);
  }, [refresh]);

  // 当前值失效（旧目录存量 id / 模型被删除）时自动采用第一个可用模型
  useEffect(() => {
    if (!options) return;
    const adopt = shouldAdoptGatewayModel(value, options);
    if (adopt) onChange(adopt);
  }, [options, value, onChange]);

  const loading = options === null;
  const empty = options !== null && options.length === 0;
  const selected = options?.find((o) => o.id === value) || null;

  const renderOptions = () => (
    <>
      {loading && <option value="">加载模型中…</option>}
      {empty && <option value="">暂无可用模型——请到「模型配置 → 网关」添加服务商与模型</option>}
      {options?.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </>
  );

  if (compact) {
    return (
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || loading || empty}
          className={`${selectCls} px-3 py-1.5 pr-7`}
        >
          {renderOptions()}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500 pointer-events-none" />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {label && (
        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-1">
          <Cpu className="w-3 h-3" />
          {label}
        </label>
      )}
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || loading || empty}
          className={`${selectCls} w-full px-3 py-2.5 pr-8`}
        >
          {renderOptions()}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
      </div>
      {selected && (
        <p className="text-[9px] text-zinc-600">
          API 模型: {selected.apiModel} · {selected.providerName}
          {selected.providerScope === 'private' ? '（私有）' : ''}
        </p>
      )}
      {empty && (
        <p className="text-[9px] text-zinc-600">
          配置入口：模型配置 → 网关 → 添加服务商与模型（Key 保存在服务端）
        </p>
      )}
    </div>
  );
};

export default ModelSelector;
