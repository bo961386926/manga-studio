// Author: forsearch | Updated: 2026-06-26
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught an error:', error);
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center h-full bg-slate-950/70 backdrop-blur-sm text-slate-300 p-8">
          <AlertTriangle className="w-16 h-16 text-red-400 mb-6 opacity-80" />
          <h2 className="text-2xl font-bold text-white mb-3">页面发生错误</h2>
          <p className="text-slate-400 text-sm mb-2 max-w-lg text-center">
            渲染组件时出现了未预期的错误，这可能是因为 AI 返回的数据格式异常导致的。
          </p>
          {this.state.error && (
            <div className="bg-slate-900/80 border border-red-500/30 rounded-lg p-4 mb-6 max-w-xl w-full">
              <p className="text-red-400 text-sm font-mono break-all">
                {this.state.error.message || String(this.state.error)}
              </p>
              {this.state.errorInfo && (
                <details className="mt-3">
                  <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-400">
                    查看组件堆栈
                  </summary>
                  <pre className="text-xs text-slate-600 mt-2 whitespace-pre-wrap max-h-48 overflow-auto">
                    {this.state.errorInfo.componentStack}
                  </pre>
                </details>
              )}
            </div>
          )}
          <button
            onClick={this.handleReset}
            className="flex items-center gap-2 px-5 py-2.5 bg-cyan-500/20 border border-cyan-400/30 rounded-xl text-cyan-300 hover:bg-cyan-500/30 transition-all text-sm font-medium"
          >
            <RefreshCw className="w-4 h-4" />
            重试
          </button>
          <p className="text-xs text-slate-600 mt-4">
            如果问题持续出现，请打开浏览器控制台查看详细错误信息。
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;