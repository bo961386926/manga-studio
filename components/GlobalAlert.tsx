import React, { createContext, useContext, useState, useCallback } from 'react';
import { X, AlertCircle, CheckCircle, Info } from 'lucide-react';

type AlertType = 'info' | 'success' | 'error' | 'warning';

interface AlertOptions {
  title?: string;
  type?: AlertType;
  onConfirm?: () => void;
  onCancel?: () => void;
  confirmText?: string;
  cancelText?: string;
  showCancel?: boolean;
}

interface AlertContextType {
  showAlert: (message: string, options?: AlertOptions) => void;
  closeAlert: () => void;
}

const AlertContext = createContext<AlertContextType | undefined>(undefined);

export const useAlert = () => {
  const context = useContext(AlertContext);
  if (!context) {
    throw new Error('useAlert must be used within an AlertProvider');
  }
  return context;
};

interface AlertState {
  isOpen: boolean;
  message: string;
  title?: string;
  type: AlertType;
  onConfirm?: () => void;
  onCancel?: () => void;
  confirmText?: string;
  cancelText?: string;
  showCancel?: boolean;
}

export const AlertProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [alertState, setAlertState] = useState<AlertState>({
    isOpen: false,
    message: '',
    type: 'info'
  });

  const showAlert = useCallback((message: string, options?: AlertOptions) => {
    setAlertState({
      isOpen: true,
      message,
      title: options?.title,
      type: options?.type || 'info',
      onConfirm: options?.onConfirm,
      onCancel: options?.onCancel,
      confirmText: options?.confirmText || '确定',
      cancelText: options?.cancelText || '取消',
      showCancel: options?.showCancel || false
    });
  }, []);

  const closeAlert = useCallback(() => {
    if (alertState.onConfirm) {
      alertState.onConfirm();
    }
    setAlertState(prev => ({ ...prev, isOpen: false }));
  }, [alertState]);

  const handleCancel = useCallback(() => {
    if (alertState.onCancel) {
      alertState.onCancel();
    }
    setAlertState(prev => ({ ...prev, isOpen: false }));
  }, [alertState]);

  const getIcon = () => {
    switch (alertState.type) {
      case 'success': return <CheckCircle className="w-6 h-6 text-green-500" />;
      case 'error': return <AlertCircle className="w-6 h-6 text-red-500" />;
      case 'warning': return <AlertCircle className="w-6 h-6 text-yellow-500" />;
      default: return <Info className="w-6 h-6 text-blue-500" />;
    }
  };

  const getTitle = () => {
    if (alertState.title) return alertState.title;
    switch (alertState.type) {
      case 'success': return '成功';
      case 'error': return '错误';
      case 'warning': return '警告';
      default: return '提示';
    }
  };

  return (
    <AlertContext.Provider value={{ showAlert, closeAlert }}>
      {children}
      {alertState.isOpen && (
        <div 
          className="fixed inset-0 z-[9999] bg-slate-950/80 backdrop-blur-xl flex items-center justify-center p-4"
          onClick={alertState.showCancel ? handleCancel : closeAlert}
        >
          <div 
            className="bg-slate-950/90 border border-cyan-200/15 rounded-[1.75rem] p-6 max-w-sm w-full space-y-4 shadow-2xl shadow-cyan-950/30 animate-in fade-in zoom-in duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                {getIcon()}
                <h3 className="text-lg font-semibold text-white">{getTitle()}</h3>
              </div>
              <button 
                onClick={alertState.showCancel ? handleCancel : closeAlert}
                className="text-zinc-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="text-zinc-300 text-sm leading-relaxed">
              {alertState.message}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              {alertState.showCancel && (
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 bg-white/10 hover:bg-white/15 text-zinc-300 hover:text-white rounded-xl text-sm font-medium transition-colors"
                >
                  {alertState.cancelText}
                </button>
              )}
              <button
                onClick={closeAlert}
                className="px-4 py-2 bg-cyan-300 hover:bg-cyan-200 text-slate-950 rounded-xl text-sm font-medium transition-colors"
              >
                {alertState.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </AlertContext.Provider>
  );
};
