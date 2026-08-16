import React, { useState, useEffect } from 'react';
import { Video, Loader2, Edit2, Sparkles } from 'lucide-react';
import { Shot, AspectRatio, VideoDuration } from '../../types';
import { VideoSettingsPanel } from '../AspectRatioSelector';
import { 
  getDefaultAspectRatio, 
  getDefaultVideoDuration,
  getVideoModels,
  getActiveVideoModel,
} from '../../services/modelRegistry';
import { VideoModelDefinition } from '../../types/model';
import { base64ToBlobUrl } from '../../services/videoUtils';

interface VideoGeneratorProps {
  shot: Shot;
  hasStartFrame: boolean;
  hasEndFrame: boolean;
  onGenerate: (aspectRatio: AspectRatio, duration: VideoDuration, modelId: string) => void;
  onEditPrompt: () => void;
  onOptimizeForModeration?: () => void | Promise<void>;
  isOptimizingForModeration?: boolean;
}

const VideoGenerator: React.FC<VideoGeneratorProps> = ({
  shot,
  hasStartFrame,
  hasEndFrame,
  onGenerate,
  onEditPrompt,
  onOptimizeForModeration,
  isOptimizingForModeration = false
}) => {
  const videoModels = getVideoModels().filter(m => m.isEnabled);
  const defaultModel = getActiveVideoModel();
  
  const [selectedModelId, setSelectedModelId] = useState<string>(
    shot.videoModel || defaultModel?.id || videoModels[0]?.id || 'sora-2'
  );
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(() => getDefaultAspectRatio());
  const [duration, setDuration] = useState<VideoDuration>(() => getDefaultVideoDuration());
  
  const selectedModel = videoModels.find(m => m.id === selectedModelId) as VideoModelDefinition | undefined;
  const modelType: 'sora' | 'veo' = selectedModel?.params.mode === 'async' ? 'sora' : 'veo';
  
  const isGenerating = shot.interval?.status === 'generating';
  const hasVideo = !!shot.interval?.videoUrl;

  const [elapsedTime, setElapsedTime] = useState(0);
  const [progress, setProgress] = useState(0);
  const [videoBlobUrl, setVideoBlobUrl] = useState<string>('');

  useEffect(() => {
    if (shot.interval?.videoUrl) {
      if (shot.interval.videoUrl.startsWith('data:')) {
        const blobUrl = base64ToBlobUrl(shot.interval.videoUrl);
        setVideoBlobUrl(blobUrl);
        return () => {
          URL.revokeObjectURL(blobUrl);
        };
      } else {
        setVideoBlobUrl(shot.interval.videoUrl);
      }
    } else {
      setVideoBlobUrl('');
    }
  }, [shot.interval?.videoUrl]);

  useEffect(() => {
    let timer: any;
    if (isGenerating) {
      setElapsedTime(0);
      setProgress(0);
      const startTime = Date.now();
      timer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setElapsedTime(elapsed);
        
        const targetTime = 45; 
        if (elapsed < targetTime) {
          const calculatedProgress = Math.min(95, Math.floor((elapsed / targetTime) * 95));
          setProgress(calculatedProgress);
        } else {
          const extraTime = elapsed - targetTime;
          const calculatedProgress = Math.min(99, 95 + Math.floor((1 - Math.exp(-extraTime / 20)) * 4));
          setProgress(calculatedProgress);
        }
      }, 1000);
    } else {
      setElapsedTime(0);
      setProgress(0);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isGenerating]);

  useEffect(() => {
    if (selectedModel) {
      if (!selectedModel.params.supportedAspectRatios.includes(aspectRatio)) {
        setAspectRatio(selectedModel.params.defaultAspectRatio);
      }
      if (!selectedModel.params.supportedDurations.includes(duration)) {
        setDuration(selectedModel.params.defaultDuration);
      }
    }
  }, [selectedModelId]);

  const handleGenerate = () => {
    onGenerate(aspectRatio, duration, selectedModelId);
  };

  return (
    <div className="bg-white/[0.045] rounded-2xl p-5 border border-white/10 space-y-4 backdrop-blur">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
          <Video className="w-3 h-3 text-cyan-300" />
          视频生成
          <button 
            onClick={onEditPrompt}
            className="p-1 text-yellow-400 hover:text-white transition-colors"
            title="预览/编辑视频提示词"
          >
            <Edit2 className="w-3 h-3" />
          </button>
        </h4>
        {shot.interval?.status === 'completed' && (
          <span className="text-[10px] text-green-500 font-mono flex items-center gap-1">
            ● READY
          </span>
        )}
      </div>
      
      <div className="space-y-2">
        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block">
          选择视频模型
        </label>
        <select
          value={selectedModelId}
          onChange={(e) => setSelectedModelId(e.target.value)}
          className="w-full bg-white/[0.06] text-white border border-white/10 rounded-xl px-3 py-2 text-xs outline-none focus:border-cyan-300/40 transition-colors"
          disabled={isGenerating}
        >
          {videoModels.map((model) => {
            const vm = model as VideoModelDefinition;
            const modeLabel = vm.params.mode === 'async' ? '异步' : '同步';
            return (
              <option key={model.id} value={model.id}>
                {model.name} ({modeLabel})
              </option>
            );
          })}
        </select>
        {selectedModel && (
          <p className="text-[9px] text-zinc-600 font-mono">
            ✦ {selectedModel.name}: 
            {selectedModel.params.mode === 'async' 
              ? ` 支持 ${selectedModel.params.supportedAspectRatios.join('/')}，可选 ${selectedModel.params.supportedDurations.join('/')}秒`
              : ` 高速生成，支持 ${selectedModel.params.supportedAspectRatios.join('/')}`
            }
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block">
          视频设置
        </label>
        <VideoSettingsPanel
          aspectRatio={aspectRatio}
          onAspectRatioChange={setAspectRatio}
          duration={duration}
          onDurationChange={setDuration}
          modelType={modelType}
          disabled={isGenerating}
          supportedAspectRatios={selectedModel?.params.supportedAspectRatios}
          supportedDurations={selectedModel?.params.supportedDurations}
        />
      </div>
      
      {hasVideo ? (
        <div className="w-full aspect-video bg-black rounded-lg overflow-hidden border border-zinc-700 relative shadow-lg">
          <video src={videoBlobUrl} controls className="w-full h-full" />
        </div>
      ) : (
        <div className="w-full aspect-video bg-slate-950/55 rounded-2xl border border-dashed border-cyan-200/15 flex items-center justify-center">
          <span className="text-xs text-zinc-600 font-mono">PREVIEW AREA</span>
        </div>
      )}

      {isGenerating && (
        <div className="space-y-1.5 p-3 bg-cyan-950/20 border border-cyan-500/10 rounded-xl animate-pulse">
          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-cyan-200">正在生成视频中...</span>
            <span className="text-cyan-300 font-bold">{progress}%</span>
          </div>
          <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden border border-white/5">
            <div 
              className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-1000 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-zinc-500 font-mono">
            <span>已耗时: {elapsedTime}秒</span>
            <span>预计总共需: ~45秒</span>
          </div>
        </div>
      )}

      <button
        onClick={handleGenerate}
        disabled={!hasStartFrame || isGenerating}
        className={`w-full py-3 rounded-lg font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${
          hasVideo 
            ? 'bg-white/10 text-zinc-300 hover:bg-white/15'
            : 'bg-cyan-300 text-slate-950 hover:bg-cyan-200 shadow-lg shadow-cyan-500/20'
        } ${(!hasStartFrame) ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {isGenerating ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            生成视频中 ({aspectRatio}, {modelType === 'sora' ? `${duration}秒` : selectedModel?.name})...
          </>
        ) : (
          <>{hasVideo ? '重新生成视频' : '开始生成视频'}</>
        )}
      </button>

      {shot.interval?.status === 'failed' && shot.interval?.videoPrompt && onOptimizeForModeration && (
        <button
          type="button"
          onClick={() => onOptimizeForModeration()}
          disabled={isOptimizingForModeration}
          className="w-full py-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-2 bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 disabled:opacity-50 transition-colors"
        >
          {isOptimizingForModeration ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              正在优化描述…
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              AI 优化描述（规避审核）
            </>
          )}
        </button>
      )}
      
      {!hasEndFrame && (
        <div className="text-[9px] text-zinc-500 text-center font-mono">
          * 未检测到结束帧，将使用单图生成模式 (Image-to-Video)
        </div>
      )}
    </div>
  );
};

export default VideoGenerator;
