import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-surface-700 text-surface-200 border border-surface-600',
        brand: 'bg-brand-500/15 text-brand-400 border border-brand-500/20',
        success: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20',
        warning: 'bg-amber-500/15 text-amber-400 border border-amber-500/20',
        danger: 'bg-red-500/15 text-red-400 border border-red-500/20',
        info: 'bg-blue-500/15 text-blue-400 border border-blue-500/20',
        purple: 'bg-purple-500/15 text-purple-400 border border-purple-500/20',
        // HTTP method badges
        get: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-mono',
        post: 'bg-blue-500/15 text-blue-400 border border-blue-500/20 font-mono',
        put: 'bg-amber-500/15 text-amber-400 border border-amber-500/20 font-mono',
        patch: 'bg-purple-500/15 text-purple-400 border border-purple-500/20 font-mono',
        delete: 'bg-red-500/15 text-red-400 border border-red-500/20 font-mono',
        options: 'bg-surface-500/15 text-surface-400 border border-surface-500/20 font-mono',
        head: 'bg-surface-500/15 text-surface-400 border border-surface-500/20 font-mono',
        // Status badges
        running: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20',
        stopped: 'bg-surface-500/15 text-surface-400 border border-surface-500/20',
        error: 'bg-red-500/15 text-red-400 border border-red-500/20',
      },
      size: {
        default: 'text-xs px-2 py-0.5',
        sm: 'text-2xs px-1.5 py-0.5',
        lg: 'text-sm px-2.5 py-1',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant, size }), className)} {...props} />
  );
}

// Helper to get badge variant from HTTP method
export function getMethodVariant(method: string): BadgeProps['variant'] {
  const methodMap: Record<string, BadgeProps['variant']> = {
    GET: 'get',
    POST: 'post',
    PUT: 'put',
    PATCH: 'patch',
    DELETE: 'delete',
    OPTIONS: 'options',
    HEAD: 'head',
  };
  return methodMap[method.toUpperCase()] || 'default';
}

// Helper to get badge variant from status code
export function getStatusVariant(code: number): BadgeProps['variant'] {
  if (code >= 200 && code < 300) return 'success';
  if (code >= 300 && code < 400) return 'info';
  if (code >= 400 && code < 500) return 'warning';
  if (code >= 500) return 'danger';
  return 'default';
}

export { Badge, badgeVariants };
