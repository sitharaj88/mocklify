import { Info, AlertTriangle, CheckCircle, Lightbulb } from 'lucide-react';
import type { ReactNode } from 'react';

interface InfoBoxProps {
  type?: 'info' | 'warning' | 'success' | 'tip';
  title?: string;
  children: ReactNode;
}

const styles = {
  info: {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    icon: Info,
    iconColor: 'text-blue-400',
  },
  warning: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    icon: AlertTriangle,
    iconColor: 'text-amber-400',
  },
  success: {
    bg: 'bg-green-500/10',
    border: 'border-green-500/30',
    icon: CheckCircle,
    iconColor: 'text-green-400',
  },
  tip: {
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
    icon: Lightbulb,
    iconColor: 'text-purple-400',
  },
};

export default function InfoBox({ type = 'info', title, children }: InfoBoxProps) {
  const style = styles[type];
  const Icon = style.icon;

  return (
    <div className={`${style.bg} ${style.border} border rounded-lg p-4 my-4`}>
      <div className="flex gap-3">
        <Icon className={`w-5 h-5 ${style.iconColor} shrink-0 mt-0.5`} />
        <div>
          {title && <h4 className="font-semibold mb-1">{title}</h4>}
          <div className="text-sm theme-text-secondary">{children}</div>
        </div>
      </div>
    </div>
  );
}
