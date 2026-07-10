import { useEffect, useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { copyText } from '../../lib/clipboard';

/**
 * Static fenced-code card for assistant markdown: language header + copy
 * button + scrollable <pre>. No CodeMirror — static blocks don't need an
 * editor instance per message.
 */
export function ChatCodeBlock({ language, code }: { language?: string; code: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== undefined) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleCopy = async () => {
    if (await copyText(code)) {
      setCopied(true);
      if (timeoutRef.current !== undefined) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="my-2 rounded-md border border-surface-600">
      <div className="bg-surface-950 border-b border-surface-600 rounded-t-md px-2 py-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-surface-400">
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          title="Copy code"
          aria-label="Copy code"
          className="focus-ring p-1 rounded text-surface-400 hover:text-surface-100 transition-colors duration-150"
        >
          {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 bg-surface-950 rounded-b-md">
        <code className="font-mono text-xs whitespace-pre text-surface-100">{code}</code>
      </pre>
    </div>
  );
}
