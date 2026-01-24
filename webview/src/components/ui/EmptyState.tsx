import * as React from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './Button';

interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-16 px-4 text-center',
        className
      )}
      {...props}
    >
      <div className="relative mb-6">
        <div className="absolute inset-0 bg-brand-500/20 blur-xl rounded-full" />
        <div className="relative flex items-center justify-center w-16 h-16 rounded-2xl bg-surface-800 border border-surface-700">
          <Icon className="w-8 h-8 text-surface-400" />
        </div>
      </div>
      <h3 className="text-lg font-medium text-surface-100 mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-surface-400 max-w-sm mb-6">{description}</p>
      )}
      {action && (
        <Button onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

export { EmptyState };
