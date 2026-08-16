import React from 'react';
import { Sparkles } from 'lucide-react';

interface WelcomePageProps {
  onNext: () => void;
  onSkip: () => void;
}

const WelcomePage: React.FC<WelcomePageProps> = ({ onNext, onSkip }) => {
  return (
    <div className="flex flex-col items-center text-center">
      {/* 大图区域：Logo + 装饰 */}
      <div className="relative mb-8">
        <div className="absolute -inset-8 bg-gradient-to-r from-cyan-300/20 via-sky-400/20 to-fuchsia-400/20 rounded-full blur-3xl opacity-50"></div>
        <img 
          src="/logo.svg" 
          alt="漫剧工场" 
          className="w-24 h-24 relative z-10"
        />
        <Sparkles className="absolute -top-2 -right-2 w-6 h-6 text-yellow-400 animate-pulse" />
      </div>

      {/* 欢迎语 */}
      <h1 className="text-3xl font-bold text-white mb-3">
        嗨，创作者
      </h1>

      {/* 核心价值 */}
      <p className="text-xl text-zinc-300 mb-2">
        把你的故事，变成会动的短剧
      </p>

      {/* 说明文案 */}
      <p className="text-sm text-zinc-500 mb-10 max-w-xs">
        只需一段剧本，AI帮你搞定剩下的一切
      </p>

      {/* 主按钮 */}
      <button
        onClick={onNext}
        className="px-8 py-3 bg-cyan-300 text-slate-950 font-bold text-sm rounded-xl hover:bg-cyan-200 transition-all duration-200 transform hover:scale-105 shadow-lg shadow-cyan-500/20"
      >
        看看怎么玩
      </button>

      {/* 跳过入口 */}
      <button
        onClick={onSkip}
        className="mt-6 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
      >
        稍后了解，直接开始
      </button>
    </div>
  );
};

export default WelcomePage;
