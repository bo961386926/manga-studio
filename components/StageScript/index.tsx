// Author: forsearch | Updated: 2026-04-30
import React, { useState, useEffect } from 'react';
import { ProjectState } from '../../types';
import { parseScriptToData, generateShotList, continueScript, continueScriptStream, rewriteScript, rewriteScriptStream } from '../../services/geminiService';
import { getFinalValue, validateConfig } from './utils';
import { DEFAULTS, VISUAL_STYLE_OPTIONS } from './constants';
import ConfigPanel from './ConfigPanel';
import ScriptEditor from './ScriptEditor';
import SceneBreakdown from './SceneBreakdown';

interface Props {
  project: ProjectState;
  updateProject: (updates: Partial<ProjectState> | ((prev: ProjectState) => ProjectState)) => void;
}

type TabMode = 'story' | 'script';

const StageScript: React.FC<Props> = ({ project, updateProject }) => {
  const [activeTab, setActiveTab] = useState<TabMode>(project.scriptData ? 'script' : 'story');
  
  const [localScript, setLocalScript] = useState(project.rawScript);
  const [localTitle, setLocalTitle] = useState(project.title);
  const [localDuration, setLocalDuration] = useState(project.targetDuration || DEFAULTS.duration);
  const [localLanguage, setLocalLanguage] = useState(project.language || DEFAULTS.language);
  const [localModel, setLocalModel] = useState(project.shotGenerationModel || DEFAULTS.model);
  const [localVisualStyle, setLocalVisualStyle] = useState(project.visualStyle || DEFAULTS.visualStyle);
  const [customDurationInput, setCustomDurationInput] = useState('');
  const [customModelInput, setCustomModelInput] = useState('');
  const [customStyleInput, setCustomStyleInput] = useState('');
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState<string>('');
  const [isContinuing, setIsContinuing] = useState(false);
  const [isRewriting, setIsRewriting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(null);
  const [editingCharacterPrompt, setEditingCharacterPrompt] = useState('');
  const [editingShotId, setEditingShotId] = useState<string | null>(null);
  const [editingShotPrompt, setEditingShotPrompt] = useState('');
  const [editingShotCharactersId, setEditingShotCharactersId] = useState<string | null>(null);
  const [editingShotActionId, setEditingShotActionId] = useState<string | null>(null);
  const [editingShotActionText, setEditingShotActionText] = useState('');
  const [editingShotDialogueText, setEditingShotDialogueText] = useState('');

  useEffect(() => {
    setLocalScript(project.rawScript);
    setLocalTitle(project.title);
    setLocalDuration(project.targetDuration || DEFAULTS.duration);
    setLocalLanguage(project.language || DEFAULTS.language);
    setLocalModel(project.shotGenerationModel || DEFAULTS.model);
    // 视觉风格恢复:若为预设选项直接选中;否则视为自定义值,回显到 custom 输入框
    const vs = project.visualStyle || DEFAULTS.visualStyle;
    const isPreset = VISUAL_STYLE_OPTIONS.some(o => o.value === vs);
    if (isPreset) {
      setLocalVisualStyle(vs);
      setCustomStyleInput('');
    } else {
      setLocalVisualStyle('custom');
      setCustomStyleInput(vs);
    }
    // 恢复任务状态(切页/刷新后):仍在跑则显示处理中,失败则显示错误
    if (project.isParsingScript) {
      setIsProcessing(true);
      setProcessingStep(project.taskStep || '任务正在后台执行...');
    } else {
      setIsProcessing(false);
      setProcessingStep('');
    }
    setError(project.taskError || null);
  }, [project.id]);

  // 后台任务完成/失败时同步本组件 UI(处理切页后任务在后台结束、原闭包 setState 失效的情况)
  useEffect(() => {
    if (!project.isParsingScript && isProcessing) {
      setIsProcessing(false);
      setProcessingStep('');
      if (project.taskError) setError(project.taskError);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.isParsingScript]);

  const handleAnalyze = async () => {
    const finalDuration = getFinalValue(localDuration, customDurationInput);
    const finalModel = getFinalValue(localModel, customModelInput);
    const finalVisualStyle = getFinalValue(localVisualStyle, customStyleInput);

    const validation = validateConfig({
      script: localScript,
      duration: finalDuration,
      model: finalModel,
      visualStyle: finalVisualStyle
    });

    if (!validation.valid) {
      setError(validation.error);
      return;
    }

    setIsProcessing(true);
    setProcessingStep('正在解析剧本结构...');
    setError(null);
    try {
      updateProject({
        title: localTitle,
        rawScript: localScript,
        targetDuration: finalDuration,
        language: localLanguage,
        visualStyle: finalVisualStyle,
        shotGenerationModel: finalModel,
        isParsingScript: true,
        taskStep: '正在解析剧本结构...',
        taskError: undefined
      });

      console.log('[StageScript] 步骤1/3: 解析剧本结构...');
      setProcessingStep('正在解析剧本结构，提取角色与场景...');
      updateProject({ taskStep: '正在解析剧本结构，提取角色与场景...' });
      const scriptData = await parseScriptToData(localScript, localLanguage, finalModel, finalVisualStyle);
      
      scriptData.targetDuration = finalDuration;
      scriptData.language = localLanguage;
      scriptData.visualStyle = finalVisualStyle;
      scriptData.shotGenerationModel = finalModel;

      if (localTitle && localTitle !== "未命名项目") {
        scriptData.title = localTitle;
      }

      console.log(`[StageScript] 步骤2/3: 为 ${scriptData.scenes.length} 个场景生成分镜...`);
      setProcessingStep(`正在为 ${scriptData.scenes.length} 个场景生成分镜脚本...`);
      updateProject({ taskStep: `正在为 ${scriptData.scenes.length} 个场景生成分镜脚本...` });
      const shots = await generateShotList(scriptData, finalModel);

      console.log(`[StageScript] 步骤3/3: 完成！共 ${shots.length} 个镜位`);
      setProcessingStep('正在保存结果...');
      updateProject({ taskStep: '正在保存结果...' });
      updateProject({ 
        scriptData, 
        shots, 
        isParsingScript: false,
        taskStep: undefined,
        taskError: undefined,
        title: scriptData.title 
      });
      
      setActiveTab('script');

    } catch (err: any) {
      console.error('[StageScript] 生成失败:', err);
      const errMsg = `错误: ${err.message || "AI 连接失败"}`;
      setError(errMsg);
      updateProject({ isParsingScript: false, taskStep: undefined, taskError: errMsg });
    } finally {
      setIsProcessing(false);
      setProcessingStep('');
    }
  };

  const handleContinueScript = async () => {
    const finalModel = getFinalValue(localModel, customModelInput);
    
    if (!localScript.trim()) {
      setError("请先输入一些剧本内容作为基础。");
      return;
    }
    if (!finalModel) {
      setError("请选择或输入模型名称。");
      return;
    }

    setIsContinuing(true);
    setError(null);
    const baseScript = localScript;
    let streamed = '';
    try {
      const continuedContent = await continueScriptStream(
        baseScript,
        localLanguage,
        finalModel,
        (delta) => {
          streamed += delta;
          const newScript = baseScript + '\n\n' + streamed;
          setLocalScript(newScript);
          updateProject({ rawScript: newScript });
        }
      );
      if (continuedContent) {
        const newScript = baseScript + '\n\n' + continuedContent;
        setLocalScript(newScript);
        updateProject({ rawScript: newScript });
      }
    } catch (err: any) {
      console.error(err);
      setError(`AI续写失败: ${err.message || "连接失败"}`);
      try {
        const continuedContent = await continueScript(baseScript, localLanguage, finalModel);
        const newScript = baseScript + '\n\n' + continuedContent;
        setLocalScript(newScript);
        updateProject({ rawScript: newScript });
      } catch (fallbackErr: any) {
        console.error(fallbackErr);
      }
    } finally {
      setIsContinuing(false);
    }
  };

  const handleRewriteScript = async () => {
    const finalModel = getFinalValue(localModel, customModelInput);
    
    if (!localScript.trim()) {
      setError("请先输入剧本内容。");
      return;
    }
    if (!finalModel) {
      setError("请选择或输入模型名称。");
      return;
    }

    setIsRewriting(true);
    setError(null);
    const baseScript = localScript;
    let streamed = '';
    try {
      setLocalScript('');
      updateProject({ rawScript: '' });
      const rewrittenContent = await rewriteScriptStream(
        baseScript,
        localLanguage,
        finalModel,
        (delta) => {
          streamed += delta;
          setLocalScript(streamed);
          updateProject({ rawScript: streamed });
        }
      );
      if (rewrittenContent) {
        setLocalScript(rewrittenContent);
        updateProject({ rawScript: rewrittenContent });
      }
    } catch (err: any) {
      console.error(err);
      setError(`AI改写失败: ${err.message || "连接失败"}`);
      try {
        const rewrittenContent = await rewriteScript(baseScript, localLanguage, finalModel);
        setLocalScript(rewrittenContent);
        updateProject({ rawScript: rewrittenContent });
      } catch (fallbackErr: any) {
        console.error(fallbackErr);
      }
    } finally {
      setIsRewriting(false);
    }
  };

  const handleEditCharacter = (charId: string, prompt: string) => {
    setEditingCharacterId(charId);
    setEditingCharacterPrompt(prompt);
  };

  const handleSaveCharacter = (charId: string, prompt: string) => {
    if (!project.scriptData) return;
    
    const updatedCharacters = project.scriptData.characters.map(c => 
      c.id === charId ? { ...c, visualPrompt: prompt } : c
    );
    
    updateProject({
      scriptData: {
        ...project.scriptData,
        characters: updatedCharacters
      }
    });
    
    setEditingCharacterId(null);
    setEditingCharacterPrompt('');
  };

  const handleCancelCharacterEdit = () => {
    setEditingCharacterId(null);
    setEditingCharacterPrompt('');
  };

  const handleEditShotPrompt = (shotId: string, prompt: string) => {
    setEditingShotId(shotId);
    setEditingShotPrompt(prompt);
  };

  const handleSaveShotPrompt = () => {
    if (!editingShotId) return;
    
    const updatedShots = project.shots.map(shot => {
      if (shot.id === editingShotId && shot.keyframes.length > 0) {
        return {
          ...shot,
          keyframes: shot.keyframes.map((kf, idx) => 
            idx === 0 ? { ...kf, visualPrompt: editingShotPrompt } : kf
          )
        };
      }
      return shot;
    });
    
    updateProject({ shots: updatedShots });
    setEditingShotId(null);
    setEditingShotPrompt('');
  };

  const handleCancelShotPrompt = () => {
    setEditingShotId(null);
    setEditingShotPrompt('');
  };

  const handleEditShotCharacters = (shotId: string) => {
    setEditingShotCharactersId(shotId);
  };

  const handleAddCharacterToShot = (shotId: string, characterId: string) => {
    const updatedShots = project.shots.map(shot => {
      const characters = Array.isArray(shot.characters) ? shot.characters : [];
      if (shot.id === shotId && !characters.includes(characterId)) {
        return { ...shot, characters: [...characters, characterId] };
      }
      return shot;
    });
    updateProject({ shots: updatedShots });
  };

  const handleRemoveCharacterFromShot = (shotId: string, characterId: string) => {
    const updatedShots = project.shots.map(shot => {
      if (shot.id === shotId) {
        const characters = Array.isArray(shot.characters) ? shot.characters : [];
        return { ...shot, characters: characters.filter(cid => cid !== characterId) };
      }
      return shot;
    });
    updateProject({ shots: updatedShots });
  };

  const handleCloseShotCharactersEdit = () => {
    setEditingShotCharactersId(null);
  };

  const handleEditShotAction = (shotId: string, action: string, dialogue: string) => {
    setEditingShotActionId(shotId);
    setEditingShotActionText(action);
    setEditingShotDialogueText(dialogue);
  };

  const handleSaveShotAction = () => {
    if (!editingShotActionId) return;
    
    const updatedShots = project.shots.map(shot => {
      if (shot.id === editingShotActionId) {
        return {
          ...shot,
          actionSummary: editingShotActionText,
          dialogue: editingShotDialogueText.trim() || undefined
        };
      }
      return shot;
    });
    
    updateProject({ shots: updatedShots });
    setEditingShotActionId(null);
    setEditingShotActionText('');
    setEditingShotDialogueText('');
  };

  const handleCancelShotAction = () => {
    setEditingShotActionId(null);
    setEditingShotActionText('');
    setEditingShotDialogueText('');
  };

  return (
    <div className="h-full bg-transparent relative z-10">
      {activeTab === 'story' ? (
        <div className="flex h-full bg-slate-950/35 text-slate-200 backdrop-blur-sm">
          <ConfigPanel
            title={localTitle}
            duration={localDuration}
            language={localLanguage}
            model={localModel}
            visualStyle={localVisualStyle}
            customDurationInput={customDurationInput}
            customModelInput={customModelInput}
            customStyleInput={customStyleInput}
            isProcessing={isProcessing}
            processingStep={processingStep}
            error={error}
            onTitleChange={setLocalTitle}
            onDurationChange={setLocalDuration}
            onLanguageChange={setLocalLanguage}
            onModelChange={setLocalModel}
            onVisualStyleChange={(value) => {
              setLocalVisualStyle(value);
              // 选择预设时立即保存;切到 custom 时先清空输入回显
              updateProject({ visualStyle: value === 'custom' ? '' : value });
            }}
            onCustomDurationChange={setCustomDurationInput}
            onCustomModelChange={setCustomModelInput}
            onCustomStyleChange={(value) => {
              setCustomStyleInput(value);
              // 自定义风格输入即时保存,避免切换/刷新丢失
              if (localVisualStyle === 'custom') {
                updateProject({ visualStyle: value });
              }
            }}
            onAnalyze={handleAnalyze}
          />
          <ScriptEditor
            script={localScript}
            onChange={setLocalScript}
            onContinue={handleContinueScript}
            onRewrite={handleRewriteScript}
            isContinuing={isContinuing}
            isRewriting={isRewriting}
            lastModified={project.lastModified}
          />
        </div>
      ) : (
        <SceneBreakdown
          project={project}
          editingCharacterId={editingCharacterId}
          editingCharacterPrompt={editingCharacterPrompt}
          editingShotId={editingShotId}
          editingShotPrompt={editingShotPrompt}
          editingShotCharactersId={editingShotCharactersId}
          editingShotActionId={editingShotActionId}
          editingShotActionText={editingShotActionText}
          editingShotDialogueText={editingShotDialogueText}
          onEditCharacter={handleEditCharacter}
          onSaveCharacter={handleSaveCharacter}
          onCancelCharacterEdit={handleCancelCharacterEdit}
          onEditShotPrompt={handleEditShotPrompt}
          onSaveShotPrompt={handleSaveShotPrompt}
          onCancelShotPrompt={handleCancelShotPrompt}
          onEditShotCharacters={handleEditShotCharacters}
          onAddCharacterToShot={handleAddCharacterToShot}
          onRemoveCharacterFromShot={handleRemoveCharacterFromShot}
          onCloseShotCharactersEdit={handleCloseShotCharactersEdit}
          onEditShotAction={handleEditShotAction}
          onSaveShotAction={handleSaveShotAction}
          onCancelShotAction={handleCancelShotAction}
          onBackToStory={() => setActiveTab('story')}
        />
      )}
    </div>
  );
};

export default StageScript;