import React from 'react';
import { FileText, Users, Clapperboard, Film, ArrowRight } from 'lucide-react';
import { WORKFLOW_STEPS } from './constants';

interface WorkflowPageProps {
  onNext: () => void;
}

const icons = [FileText, Users, Clapperboard, Film];

const WorkflowPage: React.FC<WorkflowPageProps> = ({ onNext }) => {
  return (
    <div className="flex flex-col items-center text-center">
      {/* 标题 */}
      <h2 className="text-2xl font-bold text-white mb-8">
        四步出片，就这么简单
      </h2>

      {/* 流程图示意 */}
      <div className="w-full max-w-md mb-10">
        <div className="flex items-center justify-between mb-6">
          {WORKFLOW_STEPS.map((step, index) => {
            const Icon = icons[index];
            return (
              <React.Fragment key={index}>
                <div className="flex flex-col items-center">
                  <div className="w-12 h-12 rounded-xl bg-cyan-300/10 border border-cyan-200/25 flex items-center justify-center mb-2">
                    <Icon className="w-5 h-5 text-cyan-300" />
                  </div>
                  <span className="text-[10px] text-zinc-500 font-mono">{step.number}</span>
                </div>
                {index < WORKFLOW_STEPS.length - 1 && (
                  <ArrowRight className="w-4 h-4 text-zinc-600 flex-shrink-0" />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* 步骤说明列表 */}
        <div className="space-y-3 text-left">
          {WORKFLOW_STEPS.map((step, index) => (
            <div 
              key={index}
              className="flex items-center gap-3 bg-white/[0.045] border border-white/10 rounded-xl px-4 py-3"
            >
              <span className="text-cyan-300 font-bold text-sm">{step.number}</span>
              <span className="text-white font-medium text-sm">{step.title}</span>
              <span className="text-zinc-500 text-xs">→ {step.description}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 主按钮 */}
      <button
        onClick={onNext}
        className="px-8 py-3 bg-cyan-300 text-slate-950 font-bold text-sm rounded-xl hover:bg-cyan-200 transition-all duration-200 transform hover:scale-105 shadow-lg shadow-cyan-500/20"
      >
        继续了解
      </button>
    </div>
  );
};

export default WorkflowPage;
