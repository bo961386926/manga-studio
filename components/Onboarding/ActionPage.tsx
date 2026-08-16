import React from 'react';
import { QUICK_START_OPTIONS } from './constants';
import { FileText, Film } from 'lucide-react';

interface ActionPageProps {
  onComplete: () => void;
  onQuickStart: (option: 'script' | 'example') => void;
}

const icons = {
  script: FileText,
  example: Film,
};

const ActionPage: React.FC<ActionPageProps> = ({ onComplete, onQuickStart }) => {
  return (
    <div className="flex flex-col items-center text-center">
      {/* 标题 */}
      <h2 className="text-2xl font-bold text-white mb-2">
        现在就开始创作
      </h2>

      {/* 说明文案 */}
      <p className="text-zinc-500 text-sm mb-8">
        选一个方式，马上体验
      </p>

      {/* 选项卡片 */}
      <div className="w-full max-w-md space-y-3 mb-8">
        {QUICK_START_OPTIONS.map((option) => {
          const Icon = icons[option.id as keyof typeof icons];
          return (
            <button
              key={option.id}
              onClick={() => onQuickStart(option.id as 'script' | 'example')}
              className="w-full flex items-center gap-4 bg-white/[0.045] border border-white/10 rounded-2xl p-4 text-left hover:border-cyan-200/35 hover:bg-white/[0.07] transition-all group"
            >
              <div className="w-12 h-12 rounded-xl bg-cyan-300/10 border border-cyan-200/25 flex items-center justify-center flex-shrink-0 group-hover:bg-cyan-300/20 transition-colors">
                <Icon className="w-5 h-5 text-cyan-300" />
              </div>
              <div>
                <h3 className="text-white font-bold text-sm mb-1 flex items-center gap-2">
                  <span>{option.icon}</span>
                  {option.title}
                </h3>
                <p className="text-zinc-500 text-xs">{option.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* 主按钮 */}
      <button
        onClick={onComplete}
        className="px-8 py-3 bg-cyan-300 text-slate-950 font-bold text-sm rounded-xl hover:bg-cyan-200 transition-all duration-200 transform hover:scale-105 shadow-lg shadow-cyan-500/20"
      >
        创建我的第一部短剧
      </button>

      {/* 辅助入口 */}
      <p className="mt-6 text-[10px] text-zinc-600">
        以后可在侧边栏「帮助」中重新查看引导
      </p>
    </div>
  );
};

export default ActionPage;
