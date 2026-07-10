import { formatDayLabel } from '../../lib/time';

/** Centered 'Today' / 'Yesterday' / date rule between transcript days. */
export function ChatDayDivider({ epochMs }: { epochMs: number }): JSX.Element {
  return (
    <div className="flex items-center gap-3 my-2">
      <div className="h-px flex-1 bg-surface-700/60" />
      <span className="text-[10px] uppercase tracking-wide text-surface-500">
        {formatDayLabel(epochMs, Date.now())}
      </span>
      <div className="h-px flex-1 bg-surface-700/60" />
    </div>
  );
}
