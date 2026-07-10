import { cn } from '../../lib/utils';
import { useNow } from '../../hooks/useNow';
import { formatAbsoluteTime, formatRelativeTime } from '../../lib/time';

/** Relative timestamp ('3m ago') with an absolute tooltip; shared 60 s ticker. */
export function ChatTimestamp({
  epochMs,
  className,
}: {
  epochMs: number;
  className?: string;
}): JSX.Element {
  const now = useNow();
  return (
    <span
      className={cn('text-[10px] text-surface-500', className)}
      title={formatAbsoluteTime(epochMs)}
    >
      {formatRelativeTime(epochMs, now)}
    </span>
  );
}
