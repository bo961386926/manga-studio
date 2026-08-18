import React, { useState } from 'react';
import { STYLES } from './constants';

interface Option {
  label: string;
  value: string;
  desc?: string;
  preview?: string;
}

interface Props {
  label: string;
  icon?: React.ReactNode;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  customInput?: string;
  onCustomInputChange?: (value: string) => void;
  customPlaceholder?: string;
  gridCols?: 1 | 2;
  helpText?: string;
  helpLink?: { text: string; url: string };
}

// 从 label 提取首个 emoji，用作图片缺失时的占位
const extractEmoji = (label: string): string => {
  const m = label.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u);
  return m ? m[0] : '🎨';
};

const OptionSelector: React.FC<Props> = ({
  label,
  icon,
  options,
  value,
  onChange,
  customInput,
  onCustomInputChange,
  customPlaceholder,
  gridCols = 2,
  helpText,
  helpLink
}) => {
  const [hovered, setHovered] = useState<{ opt: Option; x: number; y: number } | null>(null);
  const [failedImgs, setFailedImgs] = useState<Set<string>>(new Set());

  return (
    <div className="space-y-2">
      <label className={`${STYLES.label} flex items-center gap-2`}>
        {icon}
        {label}
      </label>
      <div className={`grid grid-cols-${gridCols} gap-2`}>
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            onMouseEnter={opt.preview ? (e) => setHovered({ opt, x: e.clientX, y: e.clientY }) : undefined}
            onMouseLeave={opt.preview ? () => setHovered(null) : undefined}
            title={opt.desc}
            className={`px-${gridCols === 1 ? '3' : '2'} py-2.5 text-[11px] font-medium rounded-md transition-all text-${gridCols === 1 ? 'left' : 'center'} border ${
              value === opt.value
                ? STYLES.button.selected
                : `${STYLES.button.secondary} border`
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {value === 'custom' && onCustomInputChange && (
        <div className="pt-1">
          <input 
            type="text"
            value={customInput}
            onChange={(e) => onCustomInputChange(e.target.value)}
            className={`${STYLES.input} font-mono`}
            placeholder={customPlaceholder}
          />
        </div>
      )}
      {helpText && (
        <div className="pt-1 px-3 py-2 bg-white/[0.04] border border-white/10 rounded-xl">
          <p className="text-[10px] text-zinc-500 leading-relaxed">
            💡 提示：{helpText}
            {helpLink && (
              <>
                {' '}
                <a 
                  href={helpLink.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-zinc-400 hover:text-white underline underline-offset-2 transition-colors font-medium"
                >
                  {helpLink.text}
                </a>
              </>
            )}
          </p>
        </div>
      )}

      {/* 悬浮放大预览：鼠标移入风格按钮时，在鼠标附近显示大图 + 名称 + 描述 */}
      {hovered && hovered.opt.preview && (
        <div
          className="fixed z-[100] pointer-events-none w-56 rounded-xl overflow-hidden border border-cyan-300/30 bg-slate-950/95 backdrop-blur-xl shadow-2xl shadow-cyan-500/20 animate-in fade-in zoom-in-95 duration-150"
          style={{
            left: Math.min(hovered.x + 16, (typeof window !== 'undefined' ? window.innerWidth : 1920) - 240),
            top: Math.max(hovered.y - 8, 8)
          }}
        >
          <div className="h-32 w-full bg-slate-900 flex items-center justify-center overflow-hidden relative">
            {!failedImgs.has(hovered.opt.value) ? (
              <img
                src={hovered.opt.preview}
                alt={hovered.opt.label}
                onError={() => setFailedImgs(prev => new Set(prev).add(hovered.opt.value))}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-5xl">{extractEmoji(hovered.opt.label)}</span>
            )}
          </div>
          <div className="p-2.5">
            <div className="text-xs font-bold text-white mb-0.5">{hovered.opt.label}</div>
            {hovered.opt.desc && (
              <div className="text-[10px] text-zinc-400 leading-relaxed">{hovered.opt.desc}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default OptionSelector;
