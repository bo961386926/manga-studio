import React from 'react';
import { HIGHLIGHTS } from './constants';

interface HighlightPageProps {
  onNext: () => void;
}

const HighlightPage: React.FC<HighlightPageProps> = ({ onNext }) => {
  return (
    <div className="flex flex-col items-center text-center">
      {/* 标题 */}
      <h2 className="text-2xl font-bold text-white mb-8">
        画面连贯，角色不变脸
      </h2>

      {/* 亮点说明 */}
      <div className="w-full max-w-md space-y-4 mb-8">
        {HIGHLIGHTS.map((highlight, index) => (
          <div
            key={index}
            className="flex items-start gap-4 bg-white/[0.045] border border-white/10 rounded-2xl p-4 text-left hover:border-cyan-200/35 transition-colors"
          >
            <span className="text-2xl flex-shrink-0">{highlight.icon}</span>
            <div>
              <h3 className="text-white font-bold text-sm mb-1">{highlight.title}</h3>
              <p className="text-zinc-400 text-xs">{highlight.description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* 场景共鸣 */}
      <div className="bg-gradient-to-r from-cyan-300/10 via-sky-400/10 to-fuchsia-400/10 border border-cyan-200/20 rounded-2xl px-6 py-4 mb-10 max-w-md">
        <p className="text-zinc-300 text-sm italic">
          "拍一个换装变身的短剧，再也不怕角色走形了"
        </p>
      </div>

      {/* 主按钮 */}
      <button
        onClick={onNext}
        className="px-8 py-3 bg-cyan-300 text-slate-950 font-bold text-sm rounded-xl hover:bg-cyan-200 transition-all duration-200 transform hover:scale-105 shadow-lg shadow-cyan-500/20"
      >
        最后一步
      </button>
    </div>
  );
};

export default HighlightPage;
