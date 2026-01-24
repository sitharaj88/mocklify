import * as React from 'react';
import { cn } from '../../lib/utils';

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  icon?: React.ReactNode;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, icon, ...props }, ref) => {
    return (
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400">
            {icon}
          </div>
        )}
        <input
          type={type}
          className={cn(
            'flex h-10 w-full rounded-lg border bg-surface-800/80 px-3 py-2 text-sm text-surface-100 transition-all duration-200',
            'placeholder:text-surface-500',
            'focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'hover:border-surface-500',
            error
              ? 'border-red-500/50 focus:ring-red-500/30 focus:border-red-500'
              : 'border-surface-600',
            icon && 'pl-10',
            className
          )}
          ref={ref}
          {...props}
        />
      </div>
    );
  }
);
Input.displayName = 'Input';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[100px] w-full rounded-lg border bg-surface-800/80 px-3 py-2 text-sm text-surface-100 transition-all duration-200',
          'placeholder:text-surface-500',
          'focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'hover:border-surface-500',
          'resize-y',
          error
            ? 'border-red-500/50 focus:ring-red-500/30 focus:border-red-500'
            : 'border-surface-600',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }
>(({ className, children, required, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(
      'text-sm font-medium text-surface-200 flex items-center gap-1',
      className
    )}
    {...props}
  >
    {children}
    {required && <span className="text-red-400">*</span>}
  </label>
));
Label.displayName = 'Label';

const FormGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex flex-col gap-2', className)}
    {...props}
  />
));
FormGroup.displayName = 'FormGroup';

const FormHint = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-xs text-surface-400', className)}
    {...props}
  />
));
FormHint.displayName = 'FormHint';

const FormError = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-xs text-red-400', className)}
    {...props}
  />
));
FormError.displayName = 'FormError';

export { Input, Textarea, Label, FormGroup, FormHint, FormError };
