/**
 * 视频生成的诚实状态展示（修复审计缺陷 F5）。
 *
 * 背景：旧实现按 targetTime=45s 做线性+渐近的伪进度，并固定显示"预计总共需: ~45秒"，
 * 与真实轮询任务完全脱钩。本模块只做两件事：把轮询状态映射为诚实的中文文案，
 * 并格式化实际已用时。禁止输出任何百分比或剩余时间预估。
 *
 * 输入状态值来源：
 *  - 网关轮询 getJob（services/modelService.ts generateVideoWithPolling）：
 *    queued / polling / submitting / submission_uncertain / succeeded / failed / cancelled / expired
 *  - UI 侧 shot.interval.status（types.ts VideoInterval）：
 *    pending / generating / completed / failed
 */

export interface VideoProgressDisplay {
  /** 诚实的阶段文案，如"排队中/生成中/已完成/生成失败/已取消/已过期" */
  stageLabel: string;
  /** 实际已用时，格式"已用时 mm:ss"（分钟数不封顶，超过 1 小时如实累计） */
  elapsedLabel: string;
}

const STAGE_LABELS: Record<string, string> = {
  // 网关轮询状态
  queued: '排队中',
  polling: '生成中',
  submitting: '提交中',
  submission_uncertain: '状态待确认',
  succeeded: '已完成',
  failed: '生成失败',
  cancelled: '已取消',
  expired: '已过期',
  // UI 侧 interval 状态
  pending: '排队中',
  generating: '生成中',
  completed: '已完成',
};

const UNKNOWN_STAGE_LABEL = '状态未知';

/** 把毫秒时间戳差格式化为"已用时 mm:ss"；分钟数不封顶（如 61:01）。 */
const formatElapsedLabel = (elapsedSeconds: number): string => {
  const totalSeconds = Math.max(0, Math.floor(elapsedSeconds));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return `已用时 ${mm}:${ss}`;
};

/**
 * 根据真实轮询状态与时间戳计算展示对象。
 * 未知/缺失状态显示兜底文案"状态未知"；时钟回拨时已用时钳制为 00:00。
 */
export const getVideoProgressDisplay = (
  status: string | null | undefined,
  startedAtMs: number,
  nowMs: number
): VideoProgressDisplay => {
  const stageLabel = (status && STAGE_LABELS[status]) || UNKNOWN_STAGE_LABEL;
  const elapsedSeconds = (nowMs - startedAtMs) / 1000;
  return {
    stageLabel,
    elapsedLabel: formatElapsedLabel(elapsedSeconds),
  };
};
