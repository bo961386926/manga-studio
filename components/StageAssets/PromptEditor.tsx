import React, { useState } from 'react';
import { Edit3, Save, AlertCircle, Camera } from 'lucide-react';

interface PromptEditorProps {
  prompt: string;
  onSave: (newPrompt: string) => void;
  label?: string;
  placeholder?: string;
  maxHeight?: string;
}

const PromptEditor: React.FC<PromptEditorProps> = ({
  prompt,
  onSave,
  label = '提示词',
  placeholder = '输入视觉描述...',
  maxHeight = 'max-h-[200px]',
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState(prompt);

  const handleStartEdit = () => {
    setIsEditing(true);
    setEditedPrompt(prompt || '');
  };

  const handleSave = () => {
    onSave(editedPrompt.trim());
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedPrompt(prompt || '');
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-1.5">
          <Camera className="w-3 h-3" />
          {label}
        </label>
        {!isEditing && (
          <button
            onClick={handleStartEdit}
            className="text-zinc-500 hover:text-white transition-colors p-1 hover:bg-white/10 rounded-xl"
            title="编辑提示词"
          >
            <Edit3 className="w-3 h-3" />
          </button>
        )}
      </div>

      {isEditing ? (
        <div className="flex-1 flex flex-col gap-2">
          <textarea
            value={editedPrompt}
            onChange={(e) => setEditedPrompt(e.target.value)}
            className={`flex-1 bg-white/[0.06] border border-cyan-300/30 text-white px-3 py-2 text-xs rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-300/10 resize-none font-mono leading-relaxed min-h-[100px] ${maxHeight}`}
            placeholder={placeholder}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="flex-1 py-1.5 bg-cyan-300 hover:bg-cyan-200 text-slate-950 rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
            >
              <Save className="w-3 h-3" />
              保存
            </button>
            <button
              onClick={handleCancel}
              className="flex-1 py-1.5 bg-white/10 hover:bg-white/15 text-zinc-300 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <div className={`flex-1 bg-slate-950/45 border border-white/10 rounded-xl p-3 overflow-y-auto ${maxHeight}`}>
          {prompt ? (
            <p className="text-[11px] text-zinc-400 leading-relaxed font-mono">
              {prompt}
            </p>
          ) : (
            <div className="flex items-start gap-2 text-zinc-600">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p className="text-[10px] leading-relaxed">
                未设置提示词。点击编辑按钮添加视觉描述。
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PromptEditor;
