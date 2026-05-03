import { createContext, useContext, useState, useCallback } from 'react';
import { CheckIcon, XMarkIcon, ExclamationTriangleIcon, InformationCircleIcon } from './Icons';

const ToastContext = createContext(null);

let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (message, type = 'info', timeout = 4000) => {
      const id = nextId++;
      setToasts((t) => [...t, { id, message, type }]);
      if (timeout) setTimeout(() => remove(id), timeout);
    },
    [remove]
  );

  const value = {
    push,
    success: (m) => push(m, 'success'),
    error: (m) => push(m, 'error', 6000),
    info: (m) => push(m, 'info'),
    warning: (m) => push(m, 'warning'),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 flex flex-col gap-2 w-[90vw] max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`
              rounded-xl px-4 py-3 shadow-lg text-sm flex items-center gap-3 
              animate-slide-up
              ${t.type === 'success' 
                ? 'bg-gradient-to-r from-green-500 to-green-600 text-white' 
                : t.type === 'error' 
                ? 'bg-gradient-to-r from-red-500 to-red-600 text-white'
                : t.type === 'warning'
                ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white'
                : 'bg-gradient-to-r from-slate-700 to-slate-800 text-white'
              }
            `}
          >
            <div className="flex-shrink-0">
              {t.type === 'success' && <CheckIcon className="w-5 h-5" />}
              {t.type === 'error' && <XMarkIcon className="w-5 h-5" />}
              {t.type === 'warning' && <ExclamationTriangleIcon className="w-5 h-5" />}
              {t.type === 'info' && <InformationCircleIcon className="w-5 h-5" />}
            </div>
            <span className="flex-1">{t.message}</span>
            <button 
              onClick={() => remove(t.id)}
              className="flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast, ToastProvider içinde olmalı');
  return ctx;
}