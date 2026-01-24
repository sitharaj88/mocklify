import * as React from 'react';
import { cn } from '../../lib/utils';

interface StatusDotProps extends React.HTMLAttributes<HTMLDivElement> {
  status: 'running' | 'stopped' | 'error' | 'warning';
  pulse?: boolean;
  size?: 'sm' | 'default' | 'lg';
}

function StatusDot({
  status,
  pulse = true,
  size = 'default',
  className,
  ...props
}: StatusDotProps) {
  const statusColors = {
    running: 'bg-emerald-500',
    stopped: 'bg-surface-500',
    error: 'bg-red-500',
    warning: 'bg-amber-500',
  };

  const statusGlows = {
    running: 'shadow-emerald-500/50',
    stopped: 'shadow-surface-500/50',
    error: 'shadow-red-500/50',
    warning: 'shadow-amber-500/50',
  };

  const sizes = {
    sm: 'w-1.5 h-1.5',
    default: 'w-2 h-2',
    lg: 'w-3 h-3',
  };

  return (
    <div className={cn('relative flex items-center justify-center', className)} {...props}>
      {pulse && status === 'running' && (
        <span
          className={cn(
            'absolute inline-flex rounded-full opacity-75 animate-ping',
            statusColors[status],
            sizes[size]
          )}
        />
      )}
      <span
        className={cn(
          'relative inline-flex rounded-full shadow-lg',
          statusColors[status],
          statusGlows[status],
          sizes[size]
        )}
      />
    </div>
  );
}

export { StatusDot };
