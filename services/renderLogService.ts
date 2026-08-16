import { RenderLog } from '../types';

type LogCallback = (log: RenderLog) => void;

let logCallback: LogCallback | null = null;

export const setLogCallback = (callback: LogCallback) => {
  logCallback = callback;
};

export const clearLogCallback = () => {
  logCallback = null;
};

export const addRenderLog = (log: Omit<RenderLog, 'id' | 'timestamp'>): void => {
  const fullLog: RenderLog = {
    ...log,
    id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: Date.now()
  };

  if (logCallback) {
    logCallback(fullLog);
  } else {
    console.warn('[RenderLog] No callback set - log not saved:', fullLog);
  }
};

export const withLogging = async <T>(
  operation: () => Promise<T>,
  logInfo: {
    type: RenderLog['type'];
    resourceId: string;
    resourceName: string;
    model: string;
    prompt?: string;
  }
): Promise<T> => {
  const startTime = Date.now();
  
  try {
    const result = await operation();
    const duration = Date.now() - startTime;
    
    addRenderLog({
      ...logInfo,
      status: 'success',
      duration
    });
    
    return result;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    addRenderLog({
      ...logInfo,
      status: 'failed',
      error: error.message || String(error),
      duration
    });
    
    throw error;
  }
};

export const addRenderLogWithTokens = (
  logInfo: Omit<RenderLog, 'id' | 'timestamp'> & {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  }
): void => {
  addRenderLog(logInfo);
};
