import { forwardRef, useId } from 'react';

export const Input = forwardRef(function Input(
  { label, error, className = '', containerClassName = '', id, ...rest },
  ref
) {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <div className={`flex flex-col gap-1 ${containerClassName}`}>
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        className={`min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 ${
          error ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : ''
        } ${className}`}
        {...rest}
      />
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
});
