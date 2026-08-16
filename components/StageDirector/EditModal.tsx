import React from 'react';
import { X, Edit2, Check, Sparkles, Loader2 } from 'lucide-react';

interface EditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  title: string;
  icon?: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  textareaClassName?: string;
  showAIGenerate?: boolean;
  onAIGenerate?: () => Promise<void>;
  isAIGenerating?: boolean;
}

const EditModal: React.FC<EditModalProps> = ({
  isOpen,
  onClose,
  onSave,
  title,
  icon,
  value,
  onChange,
  placeholder = '输入内容...',
  textareaClassName = 'font-normal',
  showAIGenerate = false,
  onAIGenerate,
  isAIGenerating = false
}) => {
  if (!isOpen) return null;

  const handleAIGenerate = async () => {
    if (onAIGenerate && !isAIGenerating) {
      await onAIGenerate();
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xl flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div 
        className="bg-slate-950/90 border border-cyan-200/15 rounded-[1.75rem] p-6 max-w-2xl w-full space-y-4 shadow-2xl shadow-cyan-950/30 animate-in fade-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-white font-bold flex items-center gap-2">
            {icon || <Edit2 className="w-4 h-4 text-cyan-300" />}
            {title}
          </h3>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-xl text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        
        {showAIGenerate && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleAIGenerate}
              disabled={isAIGenerating}
              className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                isAIGenerating
                  ? 'bg-white/10 text-zinc-400 cursor-not-allowed'
                  : 'bg-cyan-300 text-slate-950 hover:bg-cyan-200 shadow-lg shadow-cyan-500/20'
              }`}
            >
              {isAIGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  AI正在生成动作建议...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  AI生成动作建议
                </>
              )}
            </button>
          </div>
        )}

        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full h-64 bg-white/[0.06] text-white border border-white/10 rounded-2xl p-4 text-sm outline-none focus:border-cyan-300/40 transition-colors resize-none ${textareaClassName}`}
          placeholder={placeholder}
          autoFocus
          disabled={isAIGenerating}
        />
        
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isAIGenerating}
            className="px-4 py-2 bg-white/10 text-zinc-300 hover:bg-white/15 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            取消
          </button>
          <button
            onClick={onSave}
            disabled={isAIGenerating}
            className="px-4 py-2 bg-cyan-300 text-slate-950 hover:bg-cyan-200 rounded-xl text-sm font-bold transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Check className="w-4 h-4" />
            保存
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditModal;
