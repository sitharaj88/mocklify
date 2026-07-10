import { Children, isValidElement } from 'react';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { postChatMessage } from '../../store/chat';
import { CHAT_LINK_MAX_CHARS } from '../../types/chat';
import { ChatCodeBlock } from './ChatCodeBlock';

/**
 * Assistant markdown renderer (user text stays plain). Safety posture:
 * react-markdown renders React elements only — no dangerouslySetInnerHTML;
 * `skipHtml` drops raw HTML nodes; links never navigate the webview (they
 * post chatOpenLink for the extension's http/https allowlist +
 * vscode.env.openExternal); images never render an <img> (CSP allows https:
 * images — model output must not trigger fetches).
 */

/** http(s)-only and bounded — everything else renders inert. */
function isOpenableUrl(url: unknown): url is string {
  return (
    typeof url === 'string' && url.length <= CHAT_LINK_MAX_CHARS && /^https?:\/\//i.test(url)
  );
}

const LINK_CLASS =
  'text-violet-600 dark:text-violet-400 underline underline-offset-2 hover:opacity-80';

function openLink(url: string): void {
  postChatMessage({ type: 'chatOpenLink', data: { url } });
}

function MdLink({ href, children }: ComponentProps<'a'>): JSX.Element {
  if (!isOpenableUrl(href)) {
    // No navigation path exists for non-http(s) — render inert text.
    return <span>{children}</span>;
  }
  return (
    <a
      href={href}
      title={href}
      className={LINK_CLASS}
      onClick={(e) => {
        e.preventDefault();
        openLink(href);
      }}
    >
      {children}
    </a>
  );
}

function MdImg({ src, alt }: ComponentProps<'img'>): JSX.Element {
  if (!isOpenableUrl(src)) {
    return <span>[image]</span>;
  }
  return (
    <a
      href={src}
      title={src}
      className={LINK_CLASS}
      onClick={(e) => {
        e.preventDefault();
        openLink(src);
      }}
    >
      {'[image] ' + (alt || src)}
    </a>
  );
}

/** Inline code only — block code never reaches here visually (MdPre swallows it). */
function MdCode({ className, children }: ComponentProps<'code'>): JSX.Element {
  // surface-700/600/100 hold contrast against the surface-800 bubble in BOTH
  // themes (the palette inverts via CSS vars); 900/800 would wash out to
  // near-white-on-white in light mode.
  return (
    <code
      className={
        'px-1 py-0.5 rounded bg-surface-700 border border-surface-600 font-mono text-[0.85em] text-surface-100'
      }
    >
      {children}
    </code>
  );
}

/** Flatten a rendered markdown subtree back to its raw string content. */
function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (isValidElement(node)) {
    return extractText((node.props as { children?: ReactNode }).children);
  }
  return '';
}

function MdPre({ children }: ComponentProps<'pre'>): JSX.Element {
  const child = Children.toArray(children).find(isValidElement) as
    | ReactElement<{ className?: string; children?: ReactNode }>
    | undefined;
  const match = /language-([\w-]+)/.exec(
    typeof child?.props.className === 'string' ? child.props.className : ''
  );
  const code = extractText(child?.props.children).replace(/\n$/, '');
  return <ChatCodeBlock language={match?.[1]} code={code} />;
}

function MdTable({ children }: ComponentProps<'table'>): JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse [&_th]:border [&_td]:border [&_th]:border-surface-600 [&_td]:border-surface-600 [&_th]:px-2 [&_td]:px-2 [&_th]:py-1 [&_td]:py-1 [&_th]:bg-surface-700">
        {children}
      </table>
    </div>
  );
}

/** Assistant-only markdown body (GFM, raw HTML dropped). */
export function ChatMarkdown({ text }: { text: string }): JSX.Element {
  return (
    <div className="chat-markdown text-sm text-surface-200 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: MdLink,
          code: MdCode,
          pre: MdPre,
          img: MdImg,
          table: MdTable,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
