import type { LucideIcon } from 'lucide-react';

interface FeatureProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export default function Feature({ icon: Icon, title, description }: FeatureProps) {
  return (
    <div className="p-6 rounded-xl theme-bg-card border theme-border hover:border-purple-500/50 transition-colors">
      <div className="w-12 h-12 rounded-lg bg-purple-500/20 flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-purple-400" />
      </div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="theme-text-secondary text-sm">{description}</p>
    </div>
  );
}
