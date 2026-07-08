import { describe, it, expect, vi } from 'vitest';
import {
  CENSUS_HEAD_MAX_BYTES,
  CENSUS_LARGEST_FILES,
  CENSUS_MANIFEST_LINES,
  CENSUS_MAX_MANIFESTS,
  CENSUS_README_LINES,
  CENSUS_READ_BUDGET_BYTES,
  CENSUS_TOP_EXTENSIONS,
  CENSUS_TREE_MAX_LINES,
  buildWorkspaceCensus,
  describeCensus,
  pickManifestPaths,
  pickReadmePath,
  renderDirTree,
  type WorkspaceCensus,
} from '../src/ai/scan/census';

const f = (path: string, size = 100): { path: string; size: number } => ({ path, size });

/** readHead stub that resolves fixed content per path ('' by default). */
function reader(contents: Record<string, string> = {}): (path: string) => Promise<string> {
  return async (path: string) => contents[path] ?? '';
}

describe('renderDirTree', () => {
  it('renders the top 3 levels with subtree entry counts', () => {
    const tree = renderDirTree([
      'a.txt',
      'src/x.lua',
      'src/api/y.lua',
      'src/api/deep/z.lua',
      'src/api/deep/deeper/w.lua',
    ]);
    const lines = tree.split('\n');
    expect(lines[0]).toBe('. (5 files)');
    expect(lines).toContain('src/ (4 files)');
    expect(lines).toContain('  api/ (3 files)');
    expect(lines).toContain('    deep/ (2 files)');
    // Depth 4 is collapsed into its ancestor counts, never rendered.
    expect(tree).not.toContain('deeper');
  });

  it('sorts directories alphabetically', () => {
    const tree = renderDirTree(['zeta/a', 'alpha/b', 'mid/c']);
    expect(tree.indexOf('alpha/')).toBeLessThan(tree.indexOf('mid/'));
    expect(tree.indexOf('mid/')).toBeLessThan(tree.indexOf('zeta/'));
  });

  it('truncates at the line cap with a trailing ellipsis', () => {
    const paths = Array.from({ length: CENSUS_TREE_MAX_LINES + 20 }, (_, i) => `dir${String(i).padStart(3, '0')}/f.txt`);
    const tree = renderDirTree(paths);
    const lines = tree.split('\n');
    // Root line + capped dir lines + ellipsis line.
    expect(lines).toHaveLength(CENSUS_TREE_MAX_LINES + 2);
    expect(lines[lines.length - 1]).toBe('… (more directories not shown)');
  });

  it('handles an empty workspace', () => {
    expect(renderDirTree([])).toBe('. (0 files)');
  });
});

describe('pickReadmePath / pickManifestPaths', () => {
  it('prefers the shallowest README', () => {
    expect(pickReadmePath(['docs/README.md', 'README.md', 'sub/readme.txt'])).toBe('README.md');
    expect(pickReadmePath(['docs/readme', 'docs/zz.md'])).toBe('docs/readme');
    expect(pickReadmePath(['src/main.ts'])).toBeUndefined();
  });

  it('ignores READMEs in vendored directories', () => {
    expect(pickReadmePath(['node_modules/pkg/README.md'])).toBeUndefined();
  });

  it('selects manifests shallowest-first, capped, excluding vendored dirs', () => {
    const paths = [
      'b/package.json',
      'package.json',
      'go.mod',
      'node_modules/x/package.json',
      'a/pubspec.yaml',
      'src/main.lua',
    ];
    expect(pickManifestPaths(paths)).toEqual(['go.mod', 'package.json', 'a/pubspec.yaml', 'b/package.json']);
    const many = Array.from({ length: 12 }, (_, i) => `p${String(i).padStart(2, '0')}/package.json`);
    expect(pickManifestPaths(many)).toHaveLength(CENSUS_MAX_MANIFESTS);
  });

  it('recognizes suffix-style manifests like .csproj and extensionless ones like Makefile', () => {
    expect(pickManifestPaths(['App/App.csproj', 'Makefile', 'Dockerfile'])).toEqual([
      'Dockerfile',
      'Makefile',
      'App/App.csproj',
    ]);
  });
});

describe('buildWorkspaceCensus', () => {
  it('builds the extension histogram case-insensitively with byte sums', async () => {
    const census = await buildWorkspaceCensus(
      [f('a.LUA', 100), f('b.lua', 50), f('c.txt', 10), f('Makefile', 5), f('.env', 3)],
      reader()
    );
    expect(census.totalFiles).toBe(5);
    const lua = census.extensionHistogram.find((e) => e.ext === '.lua');
    expect(lua).toEqual({ ext: '.lua', files: 2, bytes: 150 });
    // Extensionless files and dotfiles both land in '(none)'.
    const none = census.extensionHistogram.find((e) => e.ext === '(none)');
    expect(none).toEqual({ ext: '(none)', files: 2, bytes: 8 });
    expect(census.extensionHistogram[0].ext).toBe('.lua'); // most files first
  });

  it('caps the histogram at the top 20 extensions', async () => {
    const files = Array.from({ length: CENSUS_TOP_EXTENSIONS + 5 }, (_, i) => f(`file.ext${i}`, 1));
    const census = await buildWorkspaceCensus(files, reader());
    expect(census.extensionHistogram).toHaveLength(CENSUS_TOP_EXTENSIONS);
  });

  it('lists the largest scannable files, filtered by shouldScanPath', async () => {
    const census = await buildWorkspaceCensus(
      [f('big.lua', 5000), f('img.png', 9000), f('node_modules/x.js', 8000), f('small.txt', 10)],
      reader()
    );
    expect(census.largestSourceFiles).toEqual(['big.lua', 'small.txt']);
  });

  it('caps largestSourceFiles at 15, largest first', async () => {
    const files = Array.from({ length: 25 }, (_, i) => f(`s${String(i).padStart(2, '0')}.lua`, i + 1));
    const census = await buildWorkspaceCensus(files, reader());
    expect(census.largestSourceFiles).toHaveLength(CENSUS_LARGEST_FILES);
    expect(census.largestSourceFiles[0]).toBe('s24.lua');
  });

  it('keeps the first 60 lines of the shallowest README', async () => {
    const readme = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const census = await buildWorkspaceCensus(
      [f('README.md'), f('docs/README.md')],
      reader({ 'README.md': readme, 'docs/README.md': 'wrong one' })
    );
    const lines = (census.readmeHead ?? '').split('\n');
    expect(lines).toHaveLength(CENSUS_README_LINES);
    expect(lines[0]).toBe('line 0');
    expect(lines[59]).toBe('line 59');
  });

  it('keeps 40 lines per manifest head', async () => {
    const manifest = Array.from({ length: 80 }, (_, i) => `dep ${i}`).join('\n');
    const census = await buildWorkspaceCensus([f('package.json')], reader({ 'package.json': manifest }));
    expect(census.manifestHeads).toHaveLength(1);
    expect(census.manifestHeads[0].path).toBe('package.json');
    expect(census.manifestHeads[0].head.split('\n')).toHaveLength(CENSUS_MANIFEST_LINES);
  });

  it('never consumes more than the read budget and stops calling readHead after it', async () => {
    // 1 README + 8 manifests, each returning a single huge line: the per-file
    // cap (32KB) makes exactly 8 reads fill the 256KB budget, so the last
    // manifest must be skipped without a readHead call.
    const files = [
      f('README.md'),
      f('go.mod'),
      f('package.json'),
      ...['a', 'b', 'c', 'd', 'e', 'f'].map((d) => f(`${d}/package.json`)),
    ];
    const readHead = vi.fn(async () => 'x'.repeat(CENSUS_HEAD_MAX_BYTES + 10_000));
    const census = await buildWorkspaceCensus(files, readHead);
    expect(readHead).toHaveBeenCalledTimes(8); // readme + 7 manifests
    expect(census.manifestHeads).toHaveLength(7);
    const consumed =
      (census.readmeHead?.length ?? 0) +
      census.manifestHeads.reduce((sum, m) => sum + m.head.length, 0);
    expect(consumed).toBeLessThanOrEqual(CENSUS_READ_BUDGET_BYTES);
    expect(census.readmeHead?.length).toBe(CENSUS_HEAD_MAX_BYTES);
  });

  it('skips files whose readHead fails without losing the rest', async () => {
    const readHead = async (path: string): Promise<string> => {
      if (path === 'package.json') {
        throw new Error('EACCES');
      }
      return `head of ${path}`;
    };
    const census = await buildWorkspaceCensus([f('package.json'), f('go.mod'), f('README.md')], readHead);
    expect(census.readmeHead).toBe('head of README.md');
    expect(census.manifestHeads).toEqual([{ path: 'go.mod', head: 'head of go.mod' }]);
  });

  it('normalizes Windows separators and dedupes paths', async () => {
    const census = await buildWorkspaceCensus(
      [f('src\\win.lua', 10), f('src/win.lua', 10)],
      reader()
    );
    expect(census.totalFiles).toBe(1);
    expect(census.dirTree).toContain('src/ (1 files)');
  });

  it('handles an empty file list', async () => {
    const census = await buildWorkspaceCensus([], reader());
    expect(census.totalFiles).toBe(0);
    expect(census.dirTree).toBe('. (0 files)');
    expect(census.extensionHistogram).toEqual([]);
    expect(census.largestSourceFiles).toEqual([]);
    expect(census.readmeHead).toBeUndefined();
    expect(census.manifestHeads).toEqual([]);
  });
});

describe('describeCensus', () => {
  it('renders every populated section', async () => {
    const census = await buildWorkspaceCensus(
      [f('README.md', 200), f('package.json', 300), f('src/api.lua', 2048), f('src/util.lua', 100)],
      reader({ 'README.md': '# My Service', 'package.json': '{ "name": "svc" }' })
    );
    const text = describeCensus(census);
    expect(text).toContain('## Workspace census (4 files)');
    expect(text).toContain('### Directory tree (top 3 levels)');
    expect(text).toContain('src/ (2 files)');
    expect(text).toContain('### File types (top 20 by count)');
    expect(text).toContain('- .lua: 2 file(s), 2.1 KB');
    expect(text).toContain('### Largest scannable files');
    expect(text).toContain('- src/api.lua');
    expect(text).toContain('### README (first 60 lines)');
    expect(text).toContain('# My Service');
    expect(text).toContain('### Manifest: package.json');
    expect(text).toContain('{ "name": "svc" }');
  });

  it('omits empty sections', () => {
    const census: WorkspaceCensus = {
      totalFiles: 0,
      dirTree: '. (0 files)',
      extensionHistogram: [],
      largestSourceFiles: [],
      manifestHeads: [],
    };
    const text = describeCensus(census);
    expect(text).not.toContain('### File types');
    expect(text).not.toContain('### Largest scannable files');
    expect(text).not.toContain('### README');
    expect(text).not.toContain('### Manifest:');
    expect(text).toContain('## Workspace census (0 files)');
  });

  it('formats byte sizes across magnitudes', async () => {
    const census = await buildWorkspaceCensus(
      [f('tiny.a', 512), f('mid.b', 4 * 1024), f('big.c', 3 * 1024 * 1024)],
      reader()
    );
    const text = describeCensus(census);
    expect(text).toContain('- .a: 1 file(s), 512 B');
    expect(text).toContain('- .b: 1 file(s), 4.0 KB');
    expect(text).toContain('- .c: 1 file(s), 3.0 MB');
  });
});
