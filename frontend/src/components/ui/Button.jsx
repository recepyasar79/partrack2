import { LoadingSpinner } from './Icons';

export function Button({ 
  as: As = 'button', 
  variant = 'primary', 
  size = 'md', 
  className = '', 
  children, 
  loading = false,
  disabled,
  ...rest 
}) {
  const base = 'inline-flex items-center justify-center font-medium rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 active:scale-[0.98]';
  
  const sizes = {
    sm: 'px-3 py-1.5 text-sm min-h-[36px]',
    md: 'px-4 py-2.5 text-base min-h-[44px]',
    lg: 'px-6 py-3.5 text-base min-h-[48px]',
    xl: 'px-8 py-4 text-lg min-h-[56px]',
  };

  const variants = {
    primary: 'bg-gradient-to-r from-brand-600 to-brand-600 hover:from-brand-500 hover:to-brand-500 text-white shadow-sm hover:shadow-md focus:ring-brand-500',
    secondary: 'bg-slate-100 text-slate-700 hover:bg-slate-200 focus:ring-slate-400 border border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 dark:border-slate-700',
    secondaryDark: 'bg-slate-800 text-white hover:bg-slate-700 focus:ring-slate-500 dark:bg-slate-700 dark:hover:bg-slate-600',
    danger: 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-600 text-white shadow-sm hover:shadow-md focus:ring-red-500',
    success: 'bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-600 text-white shadow-sm hover:shadow-md focus:ring-green-500',
    outline: 'border-2 border-brand-500 text-brand-600 hover:bg-brand-100 hover:border-brand-600 hover:shadow-md focus:ring-brand-500 bg-transparent dark:text-brand-300 dark:border-brand-400 dark:hover:bg-brand-900/30',
    ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 focus:ring-slate-300 dark:text-slate-300 dark:hover:bg-slate-800',
    soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100 focus:ring-brand-500 dark:bg-brand-900/40 dark:text-brand-200 dark:hover:bg-brand-900/60',
  };

  const isDisabled = disabled || loading;

  return (
    <As 
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} 
      disabled={isDisabled}
      {...rest}
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <LoadingSpinner className="w-4 h-4" />
          <span>Yükleniyor…</span>
        </span>
      ) : children}
    </As>
  );
}