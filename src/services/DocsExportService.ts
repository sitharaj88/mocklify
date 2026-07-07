import {
  HttpMethod,
  MockServerConfig,
  RequestMatcher,
  ResponseConfig,
  RouteConfig,
} from '../types/core.js';
import { getExtensionVersion } from '../version.js';

export interface DocsExportOptions {
  /** Pre-rendered Markdown prose (e.g. from DocumentationGenerator) inserted as an overview section. */
  markdown?: string;
  /** Extension version stamped into the generated-by footer. */
  version?: string;
}

/** Per-body character cap (~20KB) for pretty-printed response bodies. */
export const MAX_BODY_CHARS = 20_000;

export interface FormattedBody {
  text: string;
  truncated: boolean;
  totalChars: number;
}

interface EndpointDoc {
  route: RouteConfig;
  methods: HttpMethod[];
  anchor: string;
  failures: RouteConfig[];
}

interface TagGroup {
  tag: string;
  endpoints: EndpointDoc[];
}

// ---------------------------------------------------------------------------
// Shared internals
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Same entity set is valid for Confluence storage-format XML. */
const escapeXml = escapeHtml;

/** CDATA cannot contain ']]>' — split it across two CDATA sections. */
function escapeCdata(text: string): string {
  return text.replace(/]]>/g, ']]]]><![CDATA[>');
}

function routeMethods(route: RouteConfig): HttpMethod[] {
  return Array.isArray(route.method) ? route.method : [route.method];
}

/**
 * Group enabled routes by their first tag; disabled routes attach to the first
 * enabled route with the same path as failure scenarios.
 */
function groupEndpoints(server: MockServerConfig): {
  groups: TagGroup[];
  orphanFailures: RouteConfig[];
} {
  const enabled = server.routes.filter((r) => r.enabled);
  const failures = new Map<string, RouteConfig[]>();
  const orphanFailures: RouteConfig[] = [];

  for (const route of server.routes) {
    if (route.enabled) {
      continue;
    }
    const owner = enabled.find((e) => e.path === route.path);
    if (owner) {
      const list = failures.get(owner.id) ?? [];
      list.push(route);
      failures.set(owner.id, list);
    } else {
      orphanFailures.push(route);
    }
  }

  const byTag = new Map<string, EndpointDoc[]>();
  enabled.forEach((route, index) => {
    const tag = route.tags?.[0] ?? 'General';
    const list = byTag.get(tag) ?? [];
    list.push({
      route,
      methods: routeMethods(route),
      anchor: `endpoint-${index}`,
      failures: failures.get(route.id) ?? [],
    });
    byTag.set(tag, list);
  });

  const groups = Array.from(byTag.keys())
    .sort()
    .map((tag) => ({ tag, endpoints: byTag.get(tag) as EndpointDoc[] }));
  return { groups, orphanFailures };
}

/**
 * Pretty-print a response body with a size cap. Returns undefined when there
 * is nothing to render.
 */
export function formatBody(content: unknown): FormattedBody | undefined {
  if (content === undefined || content === null) {
    return undefined;
  }
  const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  if (typeof text !== 'string' || text.length === 0) {
    return undefined;
  }
  if (text.length > MAX_BODY_CHARS) {
    return { text: text.slice(0, MAX_BODY_CHARS), truncated: true, totalChars: text.length };
  }
  return { text, truncated: false, totalChars: text.length };
}

function truncationNote(body: FormattedBody): string {
  return `Truncated — showing first ${MAX_BODY_CHARS} of ${body.totalChars} characters.`;
}

/** POSIX-safe single quoting: close the string, emit an escaped quote, reopen. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Build a curl example for a route (same style as ExportService.exportLogToCurl). */
export function buildRouteCurl(route: RouteConfig, port: number): string {
  const method = routeMethods(route)[0];
  const parts: string[] = ['curl'];

  if (method !== 'GET') {
    parts.push(`-X ${method}`);
  }

  const headerEntries = Object.entries(route.matcher?.headers ?? {});
  const bodyMatcher = route.matcher?.body;
  const exactBody = bodyMatcher?.type === 'exact' ? bodyMatcher.value : undefined;
  if (exactBody !== undefined && !headerEntries.some(([n]) => n.toLowerCase() === 'content-type')) {
    try {
      JSON.parse(exactBody);
      headerEntries.push(['Content-Type', 'application/json']);
    } catch {
      // not JSON — let curl use its default content type
    }
  }
  for (const [name, value] of headerEntries) {
    parts.push(`-H ${shellQuote(`${name}: ${value}`)}`);
  }

  if (exactBody !== undefined) {
    parts.push(`-d ${shellQuote(exactBody)}`);
  }

  const query = Object.entries(route.matcher?.queryParams ?? {});
  const qs =
    query.length > 0
      ? '?' + query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
      : '';
  parts.push(shellQuote(`http://localhost:${port}${route.path}${qs}`));

  return parts.join(' \\\n  ');
}

function matcherSummary(matcher?: RequestMatcher): string[] {
  if (!matcher) {
    return [];
  }
  const lines: string[] = [];
  for (const [name, value] of Object.entries(matcher.headers ?? {})) {
    lines.push(`Header ${name}: ${value}`);
  }
  for (const [name, value] of Object.entries(matcher.queryParams ?? {})) {
    lines.push(`Query ${name} = ${value}`);
  }
  if (matcher.body) {
    const b = matcher.body;
    lines.push(
      b.type === 'jsonPath'
        ? `Body JSONPath ${b.jsonPath ?? ''} = ${b.value}`
        : `Body ${b.type}: ${b.value}`
    );
  }
  return lines;
}

function bodyLanguage(response: ResponseConfig): string {
  const contentType = response.body?.contentType ?? 'application/json';
  if (contentType.includes('json')) {
    return 'json';
  }
  if (contentType.includes('html') || contentType.includes('xml')) {
    return 'html';
  }
  return 'text';
}

// ---------------------------------------------------------------------------
// Minimal Markdown renderer (escaped output; links flattened to keep the page
// free of external references)
// ---------------------------------------------------------------------------

function inlineMd(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  return s;
}

function renderMarkdown(markdown: string): string {
  const out: string[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  let list: string[] | null = null;
  const flushList = (): void => {
    if (list) {
      out.push(`<ul>${list.join('')}</ul>`);
      list = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      flushList();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++;
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushList();
      const level = Math.min(heading[1].length + 1, 6);
      out.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      list = list ?? [];
      list.push(`<li>${inlineMd(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
      i++;
      continue;
    }

    if (line.startsWith('|')) {
      flushList();
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        const cells = lines[i]
          .replace(/^\|/, '')
          .replace(/\|\s*$/, '')
          .split('|')
          .map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) {
          rows.push(cells);
        }
        i++;
      }
      if (rows.length > 0) {
        const [head, ...body] = rows;
        out.push(
          `<table><tbody><tr>${head.map((c) => `<th>${inlineMd(c)}</th>`).join('')}</tr>` +
            body
              .map((r) => `<tr>${r.map((c) => `<td>${inlineMd(c)}</td>`).join('')}</tr>`)
              .join('') +
            '</tbody></table>'
        );
      }
      continue;
    }

    if (line.startsWith('>')) {
      flushList();
      out.push(`<blockquote><p>${inlineMd(line.replace(/^>\s?/, ''))}</p></blockquote>`);
      i++;
      continue;
    }

    if (line.trim() === '') {
      flushList();
      i++;
      continue;
    }

    flushList();
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6}\s|```|\||>|\s*[-*]\s)/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${inlineMd(para.join(' '))}</p>`);
  }
  flushList();
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Standalone HTML page
// ---------------------------------------------------------------------------

// Fixed badge backgrounds with white text keep >= 4.5:1 contrast in both schemes
const BADGE_CSS =
  '.m-get{background:#1d4ed8}.m-post{background:#15803d}.m-put{background:#b45309}' +
  '.m-patch{background:#7e22ce}.m-delete{background:#b91c1c}.m-other{background:#374151}';
const BADGED_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

const LIGHT_VARS =
  '--bg:#ffffff;--fg:#111827;--muted:#5b6472;--border:#e2e8f0;--panel:#f8fafc;--code-bg:#eef2f7;';
const DARK_VARS =
  '--bg:#0f172a;--fg:#e2e8f0;--muted:#94a3b8;--border:#293548;--panel:#16213b;--code-bg:#1e293b;';

function badge(method: string): string {
  const m = method.toLowerCase();
  const cls = BADGED_METHODS.has(m) ? `m-${m}` : 'm-other';
  return `<span class="badge ${cls}">${escapeHtml(method)}</span>`;
}

function filterKey(doc: EndpointDoc): string {
  const parts = [...doc.methods, doc.route.path, doc.route.name, ...(doc.route.tags ?? [])];
  return escapeHtml(parts.join(' ').toLowerCase());
}

function codeBlockHtml(text: string): string {
  return (
    '<div class="codeblock"><button class="copy-btn" type="button">Copy</button>' +
    `<pre><code>${escapeHtml(text)}</code></pre></div>`
  );
}

function renderResponseHtml(response: ResponseConfig): string {
  const parts: string[] = [];
  parts.push(`<h4>Response <span class="status">${response.statusCode}</span></h4>`);
  const headers = Object.entries(response.headers ?? {});
  if (headers.length > 0) {
    parts.push(
      `<ul class="kv">${headers
        .map(([k, v]) => `<li><code>${escapeHtml(k)}</code>: ${escapeHtml(v)}</li>`)
        .join('')}</ul>`
    );
  }
  const body = formatBody(response.body?.content);
  if (body) {
    parts.push(codeBlockHtml(body.text));
    if (body.truncated) {
      parts.push(`<p class="trunc-note">${escapeHtml(truncationNote(body))}</p>`);
    }
  }
  return parts.join('\n');
}

function renderFailureHtml(route: RouteConfig): string {
  const parts: string[] = ['<div class="failure">'];
  parts.push(
    `<p>${routeMethods(route).map(badge).join(' ')} <strong>${escapeHtml(route.name)}</strong> — ` +
      `status <span class="status">${route.response.statusCode}</span></p>`
  );
  const body = formatBody(route.response.body?.content);
  if (body) {
    parts.push(codeBlockHtml(body.text));
    if (body.truncated) {
      parts.push(`<p class="trunc-note">${escapeHtml(truncationNote(body))}</p>`);
    }
  }
  parts.push('</div>');
  return parts.join('\n');
}

function renderEndpointHtml(doc: EndpointDoc, port: number): string {
  const { route } = doc;
  const parts: string[] = [];
  parts.push(`<article class="endpoint" id="${doc.anchor}" data-filter="${filterKey(doc)}">`);
  parts.push(
    `<h3>${doc.methods.map(badge).join(' ')} <code class="path">${escapeHtml(route.path)}</code></h3>`
  );
  parts.push(`<p class="ep-name">${escapeHtml(route.name)}</p>`);
  const rules = matcherSummary(route.matcher);
  if (rules.length > 0) {
    parts.push(
      `<h4>Request matching</h4><ul class="kv">${rules
        .map((r) => `<li>${escapeHtml(r)}</li>`)
        .join('')}</ul>`
    );
  }
  parts.push(renderResponseHtml(route.response));
  parts.push(`<h4>Example request</h4>${codeBlockHtml(buildRouteCurl(route, port))}`);
  if (doc.failures.length > 0) {
    parts.push(
      `<details class="failures"><summary>Failure scenarios (${doc.failures.length})</summary>` +
        doc.failures.map(renderFailureHtml).join('\n') +
        '</details>'
    );
  }
  parts.push('</article>');
  return parts.join('\n');
}

function renderTocHtml(groups: TagGroup[]): string {
  return groups
    .map((group) => {
      const items = group.endpoints
        .map(
          (doc) =>
            `<li data-filter="${filterKey(doc)}"><a href="#${doc.anchor}">` +
            `${badge(doc.methods[0])} <span>${escapeHtml(doc.route.path)}</span></a></li>`
        )
        .join('');
      return (
        `<div class="toc-group" data-group><p class="toc-tag">${escapeHtml(group.tag)}</p>` +
        `<ul>${items}</ul></div>`
      );
    })
    .join('\n');
}

const PAGE_SCRIPT = `(function () {
  var root = document.documentElement;
  var toggle = document.getElementById('theme-toggle');
  toggle.addEventListener('click', function () {
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var current = root.getAttribute('data-theme') || (prefersDark ? 'dark' : 'light');
    root.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
  });
  var filter = document.getElementById('filter');
  filter.addEventListener('input', function () {
    var q = filter.value.trim().toLowerCase();
    document.querySelectorAll('[data-filter]').forEach(function (el) {
      el.style.display = el.getAttribute('data-filter').indexOf(q) >= 0 ? '' : 'none';
    });
    document.querySelectorAll('[data-group]').forEach(function (group) {
      var visible = false;
      group.querySelectorAll('[data-filter]').forEach(function (el) {
        if (el.style.display !== 'none') { visible = true; }
      });
      group.style.display = visible ? '' : 'none';
    });
  });
  document.querySelectorAll('.copy-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var pre = btn.parentElement.querySelector('pre');
      if (!pre) { return; }
      var text = pre.textContent;
      var done = function () {
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = 'Copy'; }, 1200);
      };
      var fallback = function () {
        var ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) { /* ignore */ }
        document.body.removeChild(ta);
        done();
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else {
        fallback();
      }
    });
  });
})();`;

function pageCss(): string {
  return `:root{${LIGHT_VARS}}
@media (prefers-color-scheme: dark){:root{${DARK_VARS}}}
:root[data-theme="light"]{${LIGHT_VARS}}
:root[data-theme="dark"]{${DARK_VARS}}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--fg);line-height:1.55}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
header{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1.5rem;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--bg);z-index:2}
header h1{margin:0;font-size:1.25rem}
.meta{margin:.25rem 0 0;color:var(--muted);font-size:.85rem}
#theme-toggle{background:var(--panel);color:var(--fg);border:1px solid var(--border);border-radius:6px;padding:.4rem .75rem;cursor:pointer}
.layout{display:flex;align-items:flex-start;max-width:1200px;margin:0 auto}
aside{width:280px;flex:none;padding:1rem;position:sticky;top:64px;max-height:calc(100vh - 64px);overflow:auto}
#filter{width:100%;padding:.5rem .6rem;border:1px solid var(--border);border-radius:6px;background:var(--panel);color:var(--fg)}
.toc-tag{margin:1rem 0 .25rem;font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
nav ul{list-style:none;margin:0;padding:0}
nav li a{display:flex;align-items:center;gap:.5rem;padding:.3rem .4rem;border-radius:6px;color:var(--fg);text-decoration:none;font-size:.85rem;overflow-wrap:anywhere}
nav li a:hover{background:var(--panel)}
main{flex:1;min-width:0;padding:1.5rem}
main h2{border-bottom:1px solid var(--border);padding-bottom:.35rem}
.badge{display:inline-block;padding:.1rem .5rem;border-radius:4px;font-size:.7rem;font-weight:700;color:#ffffff;letter-spacing:.03em}
${BADGE_CSS}
article.endpoint{border:1px solid var(--border);border-radius:10px;padding:1.25rem;margin:0 0 1.5rem;background:var(--panel)}
article.endpoint h3{margin:0 0 .25rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;font-size:1.05rem;border:0}
.path{overflow-wrap:anywhere}
.ep-name{margin:.15rem 0 1rem;color:var(--muted)}
h4{margin:1.1rem 0 .4rem;font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.status{display:inline-block;padding:.05rem .45rem;border-radius:4px;background:var(--code-bg);font-weight:700;font-size:.8rem}
ul.kv{margin:.25rem 0;padding-left:1.25rem;font-size:.9rem}
.codeblock{position:relative;margin:.4rem 0}
.codeblock pre{margin:0;padding:.85rem;background:var(--code-bg);border:1px solid var(--border);border-radius:8px;overflow-x:auto;font-size:.82rem}
.copy-btn{position:absolute;top:.4rem;right:.4rem;font-size:.7rem;padding:.2rem .55rem;border-radius:5px;border:1px solid var(--border);background:var(--bg);color:var(--fg);cursor:pointer}
.trunc-note{margin:.2rem 0 0;font-size:.78rem;color:var(--muted);font-style:italic}
details.failures{margin-top:1rem;border:1px solid var(--border);border-radius:8px;padding:.5rem .75rem;background:var(--bg)}
details.failures summary{cursor:pointer;font-weight:600;font-size:.9rem}
.failure{border-top:1px solid var(--border);padding:.6rem 0;font-size:.9rem}
.prose pre{padding:.85rem;background:var(--code-bg);border:1px solid var(--border);border-radius:8px;overflow-x:auto;font-size:.82rem}
main table{border-collapse:collapse;max-width:100%}
main th,main td{border:1px solid var(--border);padding:.35rem .6rem;font-size:.85rem;text-align:left}
footer{padding:1.25rem 1.5rem;border-top:1px solid var(--border);color:var(--muted);font-size:.8rem;text-align:center}
@media (max-width:800px){.layout{flex-direction:column}aside{width:100%;position:static;max-height:none}}`;
}

/**
 * Build a fully self-contained API documentation web page (inline CSS + JS,
 * no external requests) for a mock server.
 */
export function buildApiDocsHtml(server: MockServerConfig, options?: DocsExportOptions): string {
  const version = options?.version ?? getExtensionVersion();
  const { groups, orphanFailures } = groupEndpoints(server);
  const endpointCount = groups.reduce((n, g) => n + g.endpoints.length, 0);
  const generatedOn = new Date().toISOString().slice(0, 10);

  const prose = options?.markdown
    ? `<section class="prose">\n${renderMarkdown(options.markdown)}\n</section>`
    : '';
  const sections = groups
    .map(
      (group) =>
        `<section class="tag-group" data-group><h2>${escapeHtml(group.tag)}</h2>\n` +
        group.endpoints.map((doc) => renderEndpointHtml(doc, server.port)).join('\n') +
        '</section>'
    )
    .join('\n');
  const orphans =
    orphanFailures.length > 0
      ? `<details class="failures"><summary>Other failure scenarios (${orphanFailures.length})</summary>` +
        orphanFailures.map(renderFailureHtml).join('\n') +
        '</details>'
      : '';
  const empty =
    endpointCount === 0 ? '<p class="ep-name">This server has no enabled routes yet.</p>' : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(server.name)} — API Documentation</title>
<style>
${pageCss()}
</style>
</head>
<body>
<header>
<div>
<h1>${escapeHtml(server.name)}</h1>
<p class="meta">Base URL <code>http://localhost:${server.port}</code> · ${endpointCount} endpoint${endpointCount === 1 ? '' : 's'}</p>
</div>
<button id="theme-toggle" type="button">Toggle theme</button>
</header>
<div class="layout">
<aside>
<input id="filter" type="search" placeholder="Filter endpoints…" aria-label="Filter endpoints"/>
<nav>
${renderTocHtml(groups)}
</nav>
</aside>
<main>
${prose}
${empty}
${sections}
${orphans}
</main>
</div>
<footer>Generated by Mocklify v${escapeHtml(version)} on ${generatedOn}</footer>
<script>
${PAGE_SCRIPT}
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Confluence storage format
// ---------------------------------------------------------------------------

const CONFLUENCE_STATUS_COLOURS: Record<string, string> = {
  GET: 'Blue',
  POST: 'Green',
  PUT: 'Yellow',
  PATCH: 'Purple',
  DELETE: 'Red',
};

function statusMacro(method: string): string {
  const colour = CONFLUENCE_STATUS_COLOURS[method] ?? 'Grey';
  return (
    '<ac:structured-macro ac:name="status">' +
    `<ac:parameter ac:name="colour">${colour}</ac:parameter>` +
    `<ac:parameter ac:name="title">${escapeXml(method)}</ac:parameter>` +
    '</ac:structured-macro>'
  );
}

function codeMacro(language: string, text: string): string {
  return (
    '<ac:structured-macro ac:name="code">' +
    `<ac:parameter ac:name="language">${language}</ac:parameter>` +
    `<ac:plain-text-body><![CDATA[${escapeCdata(text)}]]></ac:plain-text-body>` +
    '</ac:structured-macro>'
  );
}

function expandMacro(title: string, richTextBody: string): string {
  return (
    '<ac:structured-macro ac:name="expand">' +
    `<ac:parameter ac:name="title">${escapeXml(title)}</ac:parameter>` +
    `<ac:rich-text-body>${richTextBody}</ac:rich-text-body>` +
    '</ac:structured-macro>'
  );
}

function renderFailureXhtml(route: RouteConfig): string {
  const parts: string[] = [];
  parts.push(
    `<p>${routeMethods(route).map(statusMacro).join(' ')} <strong>${escapeXml(route.name)}</strong>` +
      ` — status ${route.response.statusCode}</p>`
  );
  const body = formatBody(route.response.body?.content);
  if (body) {
    parts.push(codeMacro(bodyLanguage(route.response), body.text));
    if (body.truncated) {
      parts.push(`<p><em>${escapeXml(truncationNote(body))}</em></p>`);
    }
  }
  return parts.join('');
}

function renderEndpointXhtml(doc: EndpointDoc, port: number): string {
  const { route } = doc;
  const parts: string[] = [];
  parts.push(`<h3>${escapeXml(`${doc.methods.join(', ')} ${route.path}`)}</h3>`);
  parts.push(
    `<p>${doc.methods.map(statusMacro).join(' ')} <code>${escapeXml(route.path)}</code>` +
      ` — ${escapeXml(route.name)}</p>`
  );
  const rules = matcherSummary(route.matcher);
  if (rules.length > 0) {
    parts.push(
      '<p><strong>Request matching</strong></p>' +
        `<ul>${rules.map((r) => `<li>${escapeXml(r)}</li>`).join('')}</ul>`
    );
  }
  parts.push(`<p><strong>Response:</strong> ${route.response.statusCode}</p>`);
  const headers = Object.entries(route.response.headers ?? {});
  if (headers.length > 0) {
    parts.push(
      `<ul>${headers
        .map(([k, v]) => `<li><code>${escapeXml(k)}</code>: ${escapeXml(v)}</li>`)
        .join('')}</ul>`
    );
  }
  const body = formatBody(route.response.body?.content);
  if (body) {
    parts.push(codeMacro(bodyLanguage(route.response), body.text));
    if (body.truncated) {
      parts.push(`<p><em>${escapeXml(truncationNote(body))}</em></p>`);
    }
  }
  parts.push('<p><strong>Example request</strong></p>');
  parts.push(codeMacro('bash', buildRouteCurl(route, port)));
  if (doc.failures.length > 0) {
    parts.push(
      expandMacro(
        `Failure scenarios (${doc.failures.length})`,
        doc.failures.map(renderFailureXhtml).join('')
      )
    );
  }
  return parts.join('\n');
}

/**
 * Build a single-page Confluence Storage Format (XHTML) document, suitable for
 * "Insert > Markup" or the REST API body.storage.value.
 */
export function buildConfluenceStorageXhtml(
  server: MockServerConfig,
  options?: DocsExportOptions
): string {
  const version = options?.version ?? getExtensionVersion();
  const { groups, orphanFailures } = groupEndpoints(server);
  const endpointCount = groups.reduce((n, g) => n + g.endpoints.length, 0);

  const out: string[] = [];
  out.push(`<h1>${escapeXml(server.name)} — API Documentation</h1>`);
  out.push(
    `<p><strong>Base URL:</strong> <code>http://localhost:${server.port}</code>` +
      ` · <strong>Endpoints:</strong> ${endpointCount}` +
      ` · Generated by Mocklify v${escapeXml(version)}</p>`
  );
  if (options?.markdown) {
    out.push(renderMarkdown(options.markdown));
  }
  if (endpointCount === 0) {
    out.push('<p><em>This server has no enabled routes yet.</em></p>');
    return out.join('\n');
  }

  out.push('<h2>Endpoint summary</h2>');
  const rows: string[] = [
    '<tr><th>Method</th><th>Path</th><th>Name</th><th>Status</th><th>Tags</th></tr>',
  ];
  for (const group of groups) {
    for (const doc of group.endpoints) {
      rows.push(
        `<tr><td>${doc.methods.map(statusMacro).join(' ')}</td>` +
          `<td><code>${escapeXml(doc.route.path)}</code></td>` +
          `<td>${escapeXml(doc.route.name)}</td>` +
          `<td>${doc.route.response.statusCode}</td>` +
          `<td>${escapeXml((doc.route.tags ?? []).join(', '))}</td></tr>`
      );
    }
  }
  out.push(`<table><tbody>${rows.join('')}</tbody></table>`);

  for (const group of groups) {
    out.push(`<h2>${escapeXml(group.tag)}</h2>`);
    for (const doc of group.endpoints) {
      out.push(renderEndpointXhtml(doc, server.port));
    }
  }

  if (orphanFailures.length > 0) {
    out.push(
      expandMacro(
        `Other failure scenarios (${orphanFailures.length})`,
        orphanFailures.map(renderFailureXhtml).join('')
      )
    );
  }

  return out.join('\n');
}
