import { forwardRef, useId } from 'react';
import { ExclamationTriangleIcon } from './Icons';

export const Input = forwardRef(function Input(
  { label, error, className = '', containerClassName = '', id, icon: Icon, helperText, ...rest },
  ref
) {
  const autoId = useId();
  const inputId = id || autoId;
  const hasError = !!error;

  return (
    <div className={`flex flex-col gap-1.5 ${containerClassName}`}>
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5"
        >
          {label}
          {rest.required && <span className="text-red-500">*</span>}
        </label>
      )}
      <div className="relative">
        {Icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
            <Icon className="w-5 h-5" />
          </div>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`
            w-full min-h-[48px] rounded-xl border bg-white dark:bg-slate-900 px-4 py-3 text-base text-slate-900 dark:text-slate-100
            placeholder:text-slate-400 dark:placeholder:text-slate-500
            transition-all duration-200
            focus:outline-none focus:ring-2 focus:ring-offset-0
            disabled:bg-slate-50 dark:disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed
            ${Icon ? 'pl-11' : ''}
            ${hasError
              ? 'border-red-300 focus:border-red-500 focus:ring-red-200 bg-red-50/30 dark:bg-red-900/20 dark:border-red-700'
              : 'border-slate-200 dark:border-slate-700 focus:border-brand-500 focus:ring-brand-200 dark:focus:ring-brand-800 hover:border-slate-300 dark:hover:border-slate-600'
            }
            ${className}
          `}
          {...rest}
        />
        {hasError && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-red-500">
            <ExclamationTriangleIcon className="w-5 h-5" />
          </div>
        )}
      </div>
      {(error || helperText) && (
        <p className={`text-sm ${hasError ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>
          {error || helperText}
        </p>
      )}
    </div>
  );
});

export const Select = forwardRef(function Select(
  { label, error, className = '', containerClassName = '', id, children, ...rest },
  ref
) {
  const autoId = useId();
  const inputId = id || autoId;
  const hasError = !!error;

  return (
    <div className={`flex flex-col gap-1.5 ${containerClassName}`}>
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5"
        >
          {label}
          {rest.required && <span className="text-red-500">*</span>}
        </label>
      )}
      <select
        ref={ref}
        id={inputId}
        className={`
          w-full min-h-[48px] rounded-xl border bg-white dark:bg-slate-900 px-4 py-3 text-base text-slate-900 dark:text-slate-100
          transition-all duration-200 cursor-pointer
          focus:outline-none focus:ring-2 focus:ring-offset-0
          disabled:bg-slate-50 dark:disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed
          ${hasError
            ? 'border-red-300 focus:border-red-500 focus:ring-red-200 bg-red-50/30 dark:bg-red-900/20 dark:border-red-700'
            : 'border-slate-200 dark:border-slate-700 focus:border-brand-500 focus:ring-brand-200 dark:focus:ring-brand-800 hover:border-slate-300 dark:hover:border-slate-600'
          }
          ${className}
        `}
        {...rest}
      >
        {children}
      </select>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
});

export const Textarea = forwardRef(function Textarea(
  { label, error, className = '', containerClassName = '', id, rows = 4, ...rest },
  ref
) {
  const autoId = useId();
  const inputId = id || autoId;
  const hasError = !!error;

  return (
    <div className={`flex flex-col gap-1.5 ${containerClassName}`}>
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5"
        >
          {label}
          {rest.required && <span className="text-red-500">*</span>}
        </label>
      )}
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        className={`
          w-full rounded-xl border bg-white dark:bg-slate-900 px-4 py-3 text-base text-slate-900 dark:text-slate-100
          placeholder:text-slate-400 dark:placeholder:text-slate-500 resize-none
          transition-all duration-200
          focus:outline-none focus:ring-2 focus:ring-offset-0
          disabled:bg-slate-50 dark:disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed
          ${hasError
            ? 'border-red-300 focus:border-red-500 focus:ring-red-200 bg-red-50/30 dark:bg-red-900/20 dark:border-red-700'
            : 'border-slate-200 dark:border-slate-700 focus:border-brand-500 focus:ring-brand-200 dark:focus:ring-brand-800 hover:border-slate-300 dark:hover:border-slate-600'
          }
          ${className}
        `}
        {...rest}
      />
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
});
