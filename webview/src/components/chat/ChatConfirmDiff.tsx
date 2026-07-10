import { ArrowRight, AlertTriangle } from 'lucide-react';
import type { ChatConfirmChange, ChatRouteSnapshot, ChatRouteFieldDiff } from '../../types/chat';

/** METHOD pill. */
function MethodBadge({ method }: { method: string }): JSX.Element {
  return (
    <span className="px-1.5 py-0.5 rounded bg-surface-800 border border-surface-700 font-mono text-[10px] font-semibold text-surface-200">
      {method}
    </span>
  );
}

/** One route snapshot: header line, behavior disclosures, body preview. */
function RouteSnapshotBlock({ route, tone }: { route: ChatRouteSnapshot; tone: 'add' | 'remove' | 'neutral' }): JSX.Element {
  const toneClass =
    tone === 'add' ? 'text-emerald-700 dark:text-emerald-300'
    : tone === 'remove' ? 'text-red-700 dark:text-red-300'
    : 'text-surface-200';
  const marker = tone === 'add' ? '+' : tone === 'remove' ? '−' : '';
  return (
    <div className="space-y-1">
      <div className={`flex items-center gap-1.5 text-xs font-mono ${toneClass}`}>
        {marker && <span className="w-3 shrink-0 text-center">{marker}</span>}
        <MethodBadge method={route.method} />
        <span className="break-all">{route.path}</span>
        <span className="text-surface-400">→ {route.statusCode}</span>
        {route.enabled === false && <span className="text-surface-400">(disabled)</span>}
      </div>
      {route.disclosures.map((line, i) => (
        <div key={i} className="flex items-start gap-1 pl-4 text-[11px] text-amber-700 dark:text-amber-300">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          <span className="break-words">{line}</span>
        </div>
      ))}
      {route.bodyPreview !== undefined && (
        <pre className="ml-4 p-1.5 rounded bg-surface-900/60 border border-surface-700 text-[11px] font-mono whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
          {route.bodyPreview}
        </pre>
      )}
    </div>
  );
}

/** field: before → after row. */
function FieldDiffRow({ diff }: { diff: ChatRouteFieldDiff }): JSX.Element {
  return (
    <div className="flex items-start gap-1.5 text-[11px] font-mono">
      <span className="text-surface-400 shrink-0">{diff.field}:</span>
      <span className="text-red-700 dark:text-red-300 line-through break-all">{diff.before}</span>
      <ArrowRight size={11} className="mt-0.5 shrink-0 text-surface-400" />
      <span className="text-emerald-700 dark:text-emerald-300 break-all">{diff.after}</span>
    </div>
  );
}

/**
 * Structured diff body for a pending confirm. Renders per change.kind; every
 * value is extension-clamped plain text. An unknown kind renders nothing —
 * the caller (ChatConfirmCard) must then fall back to request.detail.
 */
export function ChatConfirmDiff({ change }: { change: ChatConfirmChange }): JSX.Element | null {
  switch (change.kind) {
    case 'create_server':
      return (
        <div className="text-xs text-surface-300 space-y-0.5">
          <div>Server <span className="font-mono text-surface-200">{change.serverName}</span></div>
          <div>Protocol <span className="font-mono">{change.protocol ?? 'http'}</span>, port{' '}
            <span className="font-mono">{change.port ?? 'default'}</span> — starts empty and stopped.</div>
        </div>
      );
    case 'add_route':
      return (
        <div className="space-y-2">
          <div className="text-[11px] text-surface-400">
            Adding {change.routes?.length ?? 0} route(s) to “{change.serverName}”
          </div>
          {(change.routes ?? []).map((r, i) => <RouteSnapshotBlock key={i} route={r} tone="add" />)}
        </div>
      );
    case 'update_route': {
      // When the response field changes, the full after-body preview must be
      // visible even for static responses (which carry no disclosures) — the
      // 80-char field diff alone can clamp away the actual change.
      const responseChanged = (change.fieldDiffs ?? []).some((d) => d.field === 'response');
      const showAfter =
        change.after !== undefined &&
        (change.after.disclosures.length > 0 ||
          (responseChanged && change.after.bodyPreview !== undefined));
      return (
        <div className="space-y-2">
          {change.before && (
            <div className="flex items-center gap-1.5 text-xs font-mono text-surface-200">
              <MethodBadge method={change.before.method} />
              <span className="break-all">{change.before.path}</span>
              <span className="text-surface-400">on “{change.serverName}”</span>
            </div>
          )}
          <div className="space-y-1 pl-1">
            {(change.fieldDiffs ?? []).map((d, i) => <FieldDiffRow key={i} diff={d} />)}
            {(change.fieldDiffs ?? []).length === 0 && (
              <div className="text-[11px] text-surface-400">No effective field changes.</div>
            )}
          </div>
          {showAfter && change.after && (
            <div className="space-y-1">
              {responseChanged && (
                <div className="text-[11px] text-surface-400">Route after this change:</div>
              )}
              <RouteSnapshotBlock route={change.after} tone="neutral" />
            </div>
          )}
        </div>
      );
    }
    case 'delete_route':
      return (
        <div className="space-y-2">
          <div className="text-[11px] text-surface-400">Removing from “{change.serverName}” permanently</div>
          {change.before && <RouteSnapshotBlock route={change.before} tone="remove" />}
        </div>
      );
    case 'start_server':
    case 'stop_server':
      return (
        <div className="text-xs text-surface-300">
          {change.kind === 'start_server' ? 'Start' : 'Stop'}{' '}
          <span className="font-mono text-surface-200">{change.serverName}</span>
          {change.port !== undefined && (
            <> — <span className="font-mono">http://localhost:{change.port}</span></>
          )}
        </div>
      );
    default:
      return null;
  }
}
