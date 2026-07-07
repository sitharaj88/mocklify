import { describe, it, expect } from 'vitest';
import {
  validateWorkspacePath,
  sanitizeGlob,
  relativeToRoot,
  optionalLineNumber,
  windowFileContent,
  compileSearchMatcher,
  excludedPathReason,
  hasNestedQuantifier,
  formatSearchMatch,
  ReadBudget,
  BUDGET_EXHAUSTED_MESSAGE,
  DEFAULT_READ_BUDGET_BYTES,
  READ_MAX_LINES,
  READ_MAX_BYTES,
  SEARCH_MAX_PATTERN_LENGTH,
  SEARCH_MATCH_TEXT_CHARS,
} from '../src/ai/agent/workspaceTools';

function expectRejected(input: unknown): string {
  const result = validateWorkspacePath(input);
  expect(result.ok, `expected rejection for ${JSON.stringify(input)}`).toBe(false);
  return result.ok ? '' : result.error;
}

function expectAccepted(input: string): string {
  const result = validateWorkspacePath(input);
  expect(result.ok, `expected acceptance for ${JSON.stringify(input)}`).toBe(true);
  return result.ok ? result.path : '';
}

describe('validateWorkspacePath', () => {
  it('accepts plain workspace-relative paths', () => {
    expect(expectAccepted('src/app.ts')).toBe('src/app.ts');
    expect(expectAccepted('a/b/c.txt')).toBe('a/b/c.txt');
    expect(expectAccepted('README.md')).toBe('README.md');
  });

  it('normalizes ./ prefixes, duplicate and trailing slashes', () => {
    expect(expectAccepted('./src/app.ts')).toBe('src/app.ts');
    expect(expectAccepted('src//app.ts')).toBe('src/app.ts');
    expect(expectAccepted('src/api/')).toBe('src/api');
  });

  it('normalizes Windows separators', () => {
    expect(expectAccepted('src\\api\\client.ts')).toBe('src/api/client.ts');
  });

  it('rejects absolute paths (posix, drive letter, UNC)', () => {
    expect(expectRejected('/etc/passwd')).toContain('workspace-relative');
    expectRejected('C:\\Windows\\system32\\config');
    expectRejected('C:/Windows/notepad.exe');
    expectRejected('\\\\server\\share\\file.txt');
  });

  it('rejects home-relative paths', () => {
    expectRejected('~/secrets.txt');
    expectRejected('~');
  });

  it('rejects .. traversal in any position or separator style', () => {
    expect(expectRejected('../secret')).toContain('workspace-relative');
    expectRejected('..');
    expectRejected('a/../../b');
    expectRejected('src/../../../etc/passwd');
    expectRejected('..\\escape.txt');
    expectRejected('a\\..\\..\\b');
  });

  it('rejects URL-encoded traversal, including double encoding', () => {
    expectRejected('%2e%2e%2fescape');
    expectRejected('src/%2e%2e/x');
    expectRejected('..%2fescape');
    expectRejected('%2e%2e%5cescape'); // encoded backslash
    expectRejected('%252e%252e%252fescape'); // double-encoded
    expectRejected('%2fetc%2fpasswd'); // encoded absolute
  });

  it('rejects null bytes, raw or encoded', () => {
    expectRejected('a\0.ts');
    expectRejected('a%00.ts');
  });

  it('rejects empty and non-string input', () => {
    expectRejected('');
    expectRejected('   ');
    expectRejected('.');
    expectRejected('./');
    expectRejected(undefined);
    expectRejected(42);
    expectRejected(['src/app.ts']);
  });

  it('keeps legitimate dot-containing names', () => {
    expect(expectAccepted('src/app.test.ts')).toBe('src/app.test.ts');
    expect(expectAccepted('.github/workflows/ci.yml')).toBe('.github/workflows/ci.yml');
    expect(expectAccepted('a/...three-dots/file')).toBe('a/...three-dots/file');
  });

  it('tells the model to use workspace-relative paths in every rejection', () => {
    for (const bad of ['/abs', '../up', '%2e%2e%2f', '', '~']) {
      expect(expectRejected(bad)).toContain('workspace-relative');
    }
  });
});

describe('sanitizeGlob', () => {
  it('accepts normal globs unchanged', () => {
    const result = sanitizeGlob('**/*.ts');
    expect(result).toEqual({ ok: true, glob: '**/*.ts' });
    expect(sanitizeGlob('src/**/{api,service}/*.kt')).toEqual({
      ok: true,
      glob: 'src/**/{api,service}/*.kt',
    });
  });

  it('makes absolute globs relative', () => {
    expect(sanitizeGlob('/src/**')).toEqual({ ok: true, glob: 'src/**' });
    expect(sanitizeGlob('C:\\src\\**')).toEqual({ ok: true, glob: 'src/**' });
  });

  it('rejects traversal, raw or encoded', () => {
    expect(sanitizeGlob('../**').ok).toBe(false);
    expect(sanitizeGlob('src/../../**').ok).toBe(false);
    expect(sanitizeGlob('%2e%2e/**').ok).toBe(false);
  });

  it('rejects empty, non-string, oversized, and null-byte input', () => {
    expect(sanitizeGlob('').ok).toBe(false);
    expect(sanitizeGlob('  ').ok).toBe(false);
    expect(sanitizeGlob(undefined).ok).toBe(false);
    expect(sanitizeGlob(9).ok).toBe(false);
    expect(sanitizeGlob('*'.repeat(501)).ok).toBe(false);
    expect(sanitizeGlob('a\0b/**').ok).toBe(false);
  });
});

describe('relativeToRoot', () => {
  it('strips the root prefix', () => {
    expect(relativeToRoot('/work/app', '/work/app/src/a.ts')).toBe('src/a.ts');
    expect(relativeToRoot('/work/app/', '/work/app/src/a.ts')).toBe('src/a.ts');
  });

  it('leaves paths outside the root untouched', () => {
    expect(relativeToRoot('/work/app', '/other/place/a.ts')).toBe('/other/place/a.ts');
    expect(relativeToRoot('/work/app', '/work/app-evil/a.ts')).toBe('/work/app-evil/a.ts');
  });
});

describe('optionalLineNumber', () => {
  it('passes through undefined and null as absent', () => {
    expect(optionalLineNumber(undefined, 'startLine')).toEqual({ ok: true });
    expect(optionalLineNumber(null, 'endLine')).toEqual({ ok: true });
  });

  it('accepts positive integers and numeric strings', () => {
    expect(optionalLineNumber(7, 'startLine')).toEqual({ ok: true, value: 7 });
    expect(optionalLineNumber('12', 'endLine')).toEqual({ ok: true, value: 12 });
  });

  it('rejects zero, negatives, floats, and junk', () => {
    expect(optionalLineNumber(0, 'startLine').ok).toBe(false);
    expect(optionalLineNumber(-3, 'startLine').ok).toBe(false);
    expect(optionalLineNumber(1.5, 'startLine').ok).toBe(false);
    expect(optionalLineNumber('abc', 'startLine').ok).toBe(false);
    expect(optionalLineNumber({}, 'startLine').ok).toBe(false);
  });
});

function makeLines(count: number): string {
  return Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n');
}

describe('windowFileContent', () => {
  it('numbers lines 1-indexed from the start by default', () => {
    const win = windowFileContent('alpha\nbeta\ngamma');
    if ('error' in win) throw new Error(win.error);
    expect(win.text).toBe('1: alpha\n2: beta\n3: gamma');
    expect(win.startLine).toBe(1);
    expect(win.endLine).toBe(3);
    expect(win.totalLines).toBe(3);
    expect(win.truncated).toBe(false);
  });

  it('respects startLine and endLine windows', () => {
    const win = windowFileContent(makeLines(10), 3, 5);
    if ('error' in win) throw new Error(win.error);
    expect(win.text).toBe('3: line 3\n4: line 4\n5: line 5');
    expect(win.truncated).toBe(false);
  });

  it('handles CRLF line endings', () => {
    const win = windowFileContent('a\r\nb\r\nc', 2, 2);
    if ('error' in win) throw new Error(win.error);
    expect(win.text).toBe('2: b');
  });

  it('clamps endLine past EOF without marking truncation', () => {
    const win = windowFileContent(makeLines(4), 2, 100);
    if ('error' in win) throw new Error(win.error);
    expect(win.endLine).toBe(4);
    expect(win.truncated).toBe(false);
  });

  it('errors when startLine is past EOF or the range is inverted', () => {
    const past = windowFileContent(makeLines(3), 9);
    expect('error' in past && past.error).toContain('3 lines');
    const inverted = windowFileContent(makeLines(10), 5, 2);
    expect('error' in inverted).toBe(true);
  });

  it(`caps at ${READ_MAX_LINES} lines and flags truncation`, () => {
    const win = windowFileContent(makeLines(1000));
    if ('error' in win) throw new Error(win.error);
    expect(win.endLine - win.startLine + 1).toBe(READ_MAX_LINES);
    expect(win.truncated).toBe(true);
    expect(win.text.split('\n')).toHaveLength(READ_MAX_LINES);
  });

  it(`caps at ${READ_MAX_BYTES} bytes and flags truncation`, () => {
    const bigLines = Array.from({ length: 300 }, () => 'x'.repeat(500)).join('\n');
    const win = windowFileContent(bigLines);
    if ('error' in win) throw new Error(win.error);
    expect(Buffer.byteLength(win.text, 'utf-8')).toBeLessThanOrEqual(READ_MAX_BYTES + 512);
    expect(win.truncated).toBe(true);
    expect(win.endLine).toBeLessThan(300);
  });

  it('delivers a slice of a single line larger than the byte cap', () => {
    const monster = 'y'.repeat(READ_MAX_BYTES * 2);
    const win = windowFileContent(monster);
    if ('error' in win) throw new Error(win.error);
    expect(win.text.length).toBeGreaterThan(0);
    expect(win.text.length).toBeLessThanOrEqual(READ_MAX_BYTES);
    expect(win.truncated).toBe(false); // the only line was (partially) delivered
  });

  it('paging with startLine resumes exactly where the last window ended', () => {
    const content = makeLines(900);
    const first = windowFileContent(content);
    if ('error' in first) throw new Error(first.error);
    const second = windowFileContent(content, first.endLine + 1);
    if ('error' in second) throw new Error(second.error);
    expect(second.text.startsWith(`${first.endLine + 1}: `)).toBe(true);
  });
});

describe('compileSearchMatcher', () => {
  it('matches plain substrings, case-sensitively', () => {
    const m = compileSearchMatcher('fetchUsers');
    if (!m.ok) throw new Error(m.error);
    expect(m.test('const data = await fetchUsers();')).toBe(true);
    expect(m.test('const data = await FETCHUSERS();')).toBe(false);
  });

  it('also matches as a regex when the pattern compiles', () => {
    const m = compileSearchMatcher('use[A-Z]\\w+');
    if (!m.ok) throw new Error(m.error);
    expect(m.test('const { data } = useQuery(key);')).toBe(true);
    expect(m.test('nothing here')).toBe(false);
  });

  it('falls back to substring-only for invalid regexes without throwing', () => {
    const m = compileSearchMatcher('fetch(');
    if (!m.ok) throw new Error(m.error);
    expect(m.test('await fetch("/api/users")')).toBe(true);
    expect(m.test('await axios.get("/api")')).toBe(false);
  });

  it('is stateless across calls (no sticky lastIndex)', () => {
    const m = compileSearchMatcher('ap.');
    if (!m.ok) throw new Error(m.error);
    expect(m.test('"/api/users"')).toBe(true);
    expect(m.test('"/api/users"')).toBe(true);
    expect(m.test('"/api/users"')).toBe(true);
  });

  it(`rejects patterns over ${SEARCH_MAX_PATTERN_LENGTH} characters`, () => {
    expect(compileSearchMatcher('a'.repeat(SEARCH_MAX_PATTERN_LENGTH)).ok).toBe(true);
    const long = compileSearchMatcher('a'.repeat(SEARCH_MAX_PATTERN_LENGTH + 1));
    expect(long.ok).toBe(false);
  });

  it('rejects empty and non-string patterns', () => {
    expect(compileSearchMatcher('').ok).toBe(false);
    expect(compileSearchMatcher(undefined).ok).toBe(false);
    expect(compileSearchMatcher(123).ok).toBe(false);
  });

  it('only evaluates a bounded slice of very long lines', () => {
    const m = compileSearchMatcher('needle');
    if (!m.ok) throw new Error(m.error);
    expect(m.test('x'.repeat(2000) + 'needle')).toBe(false);
    expect(m.test('needle' + 'x'.repeat(2000))).toBe(true);
  });

  it('never compiles catastrophic-backtracking patterns as regex', () => {
    const m = compileSearchMatcher('(a+)+$');
    if (!m.ok) throw new Error(m.error);
    const hostile = 'a'.repeat(1000) + 'b';
    const start = Date.now();
    expect(m.test(hostile)).toBe(false); // substring-only — returns instantly
    expect(Date.now() - start).toBeLessThan(1000);
    expect(m.test('x(a+)+$y')).toBe(true); // still matches as a substring
  });
});

describe('hasNestedQuantifier', () => {
  it('flags the classic ReDoS shapes', () => {
    expect(hasNestedQuantifier('(a+)+')).toBe(true);
    expect(hasNestedQuantifier('(a*)*')).toBe(true);
    expect(hasNestedQuantifier('(.*a){20}')).toBe(true);
    expect(hasNestedQuantifier('((ab)+c?)+')).toBe(true);
    expect(hasNestedQuantifier('(x|y+)*')).toBe(true);
  });

  it('propagates an inner quantifier through nested groups', () => {
    expect(hasNestedQuantifier('((a+)b)+')).toBe(true);
  });

  it('accepts ordinary patterns', () => {
    expect(hasNestedQuantifier('use[A-Z]\\w+')).toBe(false);
    expect(hasNestedQuantifier('fetch\\(.*\\)')).toBe(false);
    expect(hasNestedQuantifier('(GET|POST) /api')).toBe(false);
    expect(hasNestedQuantifier('(a+)(b)+')).toBe(false);
    expect(hasNestedQuantifier('[a+]+')).toBe(false); // class content is literal
    expect(hasNestedQuantifier('\\(a+\\)+')).toBe(false); // escaped parens
  });
});

describe('excludedPathReason', () => {
  it('refuses paths inside SCAN_EXCLUDE_GLOB directories', () => {
    expect(excludedPathReason('.git/config')).toContain('excluded');
    expect(excludedPathReason('node_modules/pkg/index.js')).toContain('excluded');
    expect(excludedPathReason('webview/dist/main.js')).toContain('excluded');
    expect(excludedPathReason('sub/coverage/lcov.info')).toContain('excluded');
  });

  it('refuses generated files the scan glob excludes', () => {
    expect(excludedPathReason('lib/app.min.js')).toContain('excluded');
    expect(excludedPathReason('src/types.d.ts')).toContain('excluded');
  });

  it('refuses likely secrets regardless of the exclude glob', () => {
    for (const path of [
      '.env',
      '.env.production',
      'config/.env.local',
      'certs/server.pem',
      'keys/private.key',
      '.ssh/id_rsa',
      'id_ed25519',
      '.npmrc',
      '.aws/credentials',
      'infra/terraform.tfstate',
      'android/release.keystore',
    ]) {
      expect(excludedPathReason(path), path).toContain('refuses to read');
    }
  });

  it('allows ordinary source and config files, including dotpaths', () => {
    for (const path of [
      'src/api/client.ts',
      '.github/workflows/ci.yml',
      'environment.ts',
      'src/env.d.ts.example',
      'package.json',
      'keyboard.ts',
    ]) {
      expect(excludedPathReason(path), path).toBeUndefined();
    }
  });
});

describe('formatSearchMatch', () => {
  it('formats as path:line: text with trimming', () => {
    expect(formatSearchMatch('src/a.ts', 12, '   const x = fetch("/api");  ')).toBe(
      'src/a.ts:12: const x = fetch("/api");'
    );
  });

  it('caps the match text length', () => {
    const line = 'z'.repeat(1000);
    const formatted = formatSearchMatch('a.ts', 1, line);
    expect(formatted).toBe(`a.ts:1: ${'z'.repeat(SEARCH_MATCH_TEXT_CHARS)}`);
  });
});

describe('ReadBudget', () => {
  it('accumulates charges and reports exhaustion at the limit', () => {
    const budget = new ReadBudget(100);
    expect(budget.exhausted).toBe(false);
    budget.charge(60);
    expect(budget.exhausted).toBe(false);
    expect(budget.bytesUsed).toBe(60);
    budget.charge(40);
    expect(budget.exhausted).toBe(true);
    expect(budget.bytesUsed).toBe(100);
  });

  it('stays exhausted once crossed and ignores non-positive charges', () => {
    const budget = new ReadBudget(10);
    budget.charge(-5);
    budget.charge(0);
    expect(budget.bytesUsed).toBe(0);
    budget.charge(25);
    expect(budget.exhausted).toBe(true);
    budget.charge(-100);
    expect(budget.exhausted).toBe(true);
  });

  it('defaults to 512KB', () => {
    expect(DEFAULT_READ_BUDGET_BYTES).toBe(512 * 1024);
    const budget = new ReadBudget();
    budget.charge(DEFAULT_READ_BUDGET_BYTES - 1);
    expect(budget.exhausted).toBe(false);
    budget.charge(1);
    expect(budget.exhausted).toBe(true);
  });

  it('exposes the exact exhaustion message the loop must return', () => {
    expect(BUDGET_EXHAUSTED_MESSAGE).toBe(
      'Read budget exhausted — produce your answer from what you have.'
    );
  });
});
