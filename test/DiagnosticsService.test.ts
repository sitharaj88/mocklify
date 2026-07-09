import { describe, it, expect } from 'vitest';
import {
  buildDiagnosticsReport,
  redact,
  formatForIssueUrl,
  type DiagnosticsInput,
} from '../src/services/DiagnosticsService';

function makeInput(overrides: Partial<DiagnosticsInput> = {}): DiagnosticsInput {
  return {
    extensionVersion: '0.3.2',
    vscodeVersion: '1.95.0',
    os: 'darwin',
    arch: 'arm64',
    node: 'v20.10.0',
    ai: {
      configuredProvider: 'auto',
      resolvedProvider: 'copilot',
      model: null,
      gatewayConfigured: false,
      scanMode: 'auto',
    },
    workspace: { serverCount: 2, routeCount: 7, runningServerCount: 1 },
    features: { driftWatch: false, askQuestions: true },
    lastScan: null,
    lastError: null,
    generatedAt: '2026-07-09T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildDiagnosticsReport — shape and sections', () => {
  it('renders every top-level section with the input values', () => {
    const md = buildDiagnosticsReport(
      makeInput({
        ai: {
          configuredProvider: 'claude',
          resolvedProvider: 'claude',
          model: 'claude-opus-4-8',
          gatewayConfigured: true,
          scanMode: 'agentic',
        },
      })
    );
    expect(md).toContain('## Mocklify Diagnostics');
    expect(md).toContain('### Environment');
    expect(md).toContain('### AI');
    expect(md).toContain('### Workspace');
    expect(md).toContain('### Feature flags');
    expect(md).toContain('### Last codebase scan');
    expect(md).toContain('### Last error');

    expect(md).toContain('**Mocklify version:** 0.3.2');
    expect(md).toContain('**VS Code version:** 1.95.0');
    expect(md).toContain('**OS / arch:** darwin / arm64');
    expect(md).toContain('**Node:** v20.10.0');
    expect(md).toContain('**Configured provider:** claude');
    expect(md).toContain('**Resolved provider:** claude');
    expect(md).toContain('**Model:** claude-opus-4-8');
    expect(md).toContain('**Custom gateway configured:** yes');
    expect(md).toContain('**Scan mode:** agentic');
    expect(md).toContain('**Servers:** 2');
    expect(md).toContain('**Routes:** 7');
    expect(md).toContain('**Running servers:** 1');
    expect(md).toContain('**Drift watch:** no');
    expect(md).toContain('**Ask clarifying questions:** yes');
  });

  it('shows placeholders for absent provider, model, scan, and error', () => {
    const md = buildDiagnosticsReport(
      makeInput({
        ai: {
          configuredProvider: 'auto',
          resolvedProvider: null,
          model: null,
          gatewayConfigured: false,
          scanMode: 'auto',
        },
      })
    );
    expect(md).toContain('**Resolved provider:** none');
    expect(md).toContain('**Model:** default');
    expect(md).toContain('**Custom gateway configured:** no');
    expect(md).toContain('_No scan recorded this session._');
    expect(md).toContain('_None captured this session._');
  });

  it('renders the last scan strategy report when present', () => {
    const md = buildDiagnosticsReport(
      makeInput({
        lastScan: {
          strategies: [
            { surface: 'Payments API', strategy: 'agentic', reason: 'no spec found, deep scan' },
            { surface: 'Users API', strategy: 'spec', reason: 'openapi.yaml present' },
          ],
        },
      })
    );
    expect(md).toContain('**Payments API** → `agentic` — no spec found, deep scan');
    expect(md).toContain('**Users API** → `spec` — openapi.yaml present');
    expect(md).not.toContain('_No scan recorded this session._');
  });

  it('defaults generatedAt to a timestamp when omitted', () => {
    const input = makeInput();
    delete input.generatedAt;
    const md = buildDiagnosticsReport(input);
    expect(md).toMatch(/_Generated: \d{4}-\d{2}-\d{2}T/);
  });
});

describe('redaction — no secret survives', () => {
  it('redacts sk-, ghp_, AIza, Bearer, and long hex from the last error', () => {
    const md = buildDiagnosticsReport(
      makeInput({
        lastError: {
          message: [
            'Auth failed with key sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFF1234',
            'token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
            'google AIzaSyD-1234567890abcdefghijklmnopqrstuv',
            'header Bearer eyJhbGciOiJIUzI1NiIsInR5cC2345',
            'sha 0123456789abcdef0123456789abcdef01234567',
          ].join('\n'),
          when: '2026-07-09T00:00:00.000Z',
        },
      })
    );
    expect(md).not.toContain('sk-ant-api03');
    expect(md).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz');
    expect(md).not.toContain('AIzaSyD-1234567890');
    expect(md).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cC');
    expect(md).not.toContain('0123456789abcdef0123456789abcdef01234567');
    expect(md).toContain('«redacted»');
  });

  it('never emits a gateway URL string — only the boolean', () => {
    const md = buildDiagnosticsReport(
      makeInput({
        ai: {
          configuredProvider: 'claude',
          resolvedProvider: 'claude',
          model: 'claude-opus-4-8',
          gatewayConfigured: true,
          scanMode: 'auto',
        },
        lastError: {
          message: 'connect failed to https://ai-gateway.secret-corp.internal/v1/messages',
        },
      })
    );
    expect(md).not.toContain('ai-gateway.secret-corp.internal');
    expect(md).not.toContain('https://');
    expect(md).toContain('«url»');
    expect(md).toContain('**Custom gateway configured:** yes');
  });

  it('relativizes the workspace root and home dir out of paths', () => {
    const md = buildDiagnosticsReport(
      makeInput({
        workspaceRoot: '/Users/alice/projects/myapp',
        lastError: {
          message:
            'ENOENT: /Users/alice/projects/myapp/.mocklify/servers.json missing (home /Users/alice/.config)',
        },
      })
    );
    expect(md).not.toContain('/Users/alice/projects/myapp');
    expect(md).toContain('./.mocklify/servers.json');
  });

  it('redact() strips authorization headers and key= assignments', () => {
    const out = redact('authorization: Bearer abcdef123456 and api_key=supersecretvalue123');
    expect(out).not.toContain('abcdef123456');
    expect(out).not.toContain('supersecretvalue123');
    expect(out).toContain('«redacted»');
  });

  it('redact() strips JSON-quoted secret values', () => {
    const out = redact('{"api_key": "supersecretvalue123", "authorization": "topsecrettoken99"}');
    expect(out).not.toContain('supersecretvalue123');
    expect(out).not.toContain('topsecrettoken99');
    expect(out).toContain('«redacted»');
  });

  it('redact() is a no-op on benign text', () => {
    expect(redact('just a normal error message')).toBe('just a normal error message');
    expect(redact('')).toBe('');
  });
});

describe('formatForIssueUrl', () => {
  it('builds a new-issue URL for the repository with the body pre-filled', () => {
    const url = formatForIssueUrl('## Mocklify Diagnostics\nhello', {
      repositoryUrl: 'git+https://github.com/sitharaj88/mocklify.git',
    });
    expect(url.startsWith('https://github.com/sitharaj88/mocklify/issues/new?')).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('body')).toBe('## Mocklify Diagnostics\nhello');
    expect(parsed.searchParams.get('title')).toBeTruthy();
  });

  it('normalizes an scp-style git url and falls back on garbage', () => {
    expect(
      formatForIssueUrl('x', { repositoryUrl: 'git@github.com:sitharaj88/mocklify.git' })
    ).toContain('https://github.com/sitharaj88/mocklify/issues/new');
    expect(formatForIssueUrl('x', { repositoryUrl: 'not-a-url' })).toContain(
      'https://github.com/sitharaj88/mocklify/issues/new'
    );
  });

  it('url-encodes markdown special characters in the body', () => {
    const url = formatForIssueUrl('a & b = c #1 %x', {});
    expect(url).not.toContain('a & b = c #1');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('body')).toBe('a & b = c #1 %x');
  });

  it('truncates a body near 6000 chars with a note', () => {
    const big = 'x'.repeat(20000);
    const url = formatForIssueUrl(big, {});
    const parsed = new URL(url);
    const body = parsed.searchParams.get('body') ?? '';
    expect(body.length).toBeLessThanOrEqual(6000);
    expect(body).toContain('truncated');
    expect(body).not.toBe(big);
  });

  it('does not truncate a small body', () => {
    const url = formatForIssueUrl('short report', {});
    expect(new URL(url).searchParams.get('body')).toBe('short report');
  });
});
