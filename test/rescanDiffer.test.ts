import { describe, it, expect } from 'vitest';
import {
  RESCAN_DIFF_MAX_LISTED,
  RESCAN_FINGERPRINT_MAX_CHARS,
  buildRescanChatPrompt,
  buildRescanNotificationText,
  diffRescan,
  rescanFingerprint,
  type RescanRoute,
  type RescanServerInfo,
} from '../src/ai/proactive/rescanDiffer';
import { CHAT_PREFILL_MAX_CHARS } from '../src/ai/proactive/driftProposal';
import {
  SCAN_MEMORY_VERSION,
  type ScanMemory,
} from '../src/ai/scan/scanMemory';

function servers(...routes: RescanRoute[]): RescanServerInfo[] {
  return [{ name: 'Main', routes }];
}

function memoryWith(...surfaces: { name: string; rootPath: string }[]): ScanMemory {
  return {
    version: SCAN_MEMORY_VERSION,
    updatedAt: '2026-01-01T00:00:00.000Z',
    surfaces: surfaces.map((s) => ({
      ...s,
      direction: 'consumes' as const,
      apiLayerPaths: [],
      modelPaths: [],
      conventions: {},
    })),
    notes: [],
  };
}

describe('diffRescan', () => {
  it('classifies uncovered summary endpoints as added', () => {
    const diff = diffRescan(
      [{ method: 'GET', path: '/api/orders' }],
      servers({ method: 'GET', path: '/api/users' }),
      null
    );
    expect(diff.addedEndpoints).toEqual([{ method: 'GET', path: '/api/orders' }]);
    expect(diff.addedCount).toBe(1);
    expect(diff.notify).toBe(true);
  });

  it('respects isPathCovered semantics: :param, trailing *, Retrofit tail, case', () => {
    const configured = servers(
      { method: 'GET', path: '/api/users/:id' },
      { method: 'GET', path: '/files/*' },
      { method: 'GET', path: '/v1/api/orders' }
    );
    const diff = diffRescan(
      [
        { method: 'GET', path: '/api/users/123' }, // :param covered
        { method: 'GET', path: '/files/a/b/c' }, // wildcard covered
        { method: 'GET', path: '/orders' }, // Retrofit tail covered
        { method: 'GET', path: '/API/USERS/:userId' }, // case-insensitive covered
        { method: 'GET', path: '/api/products' }, // added
      ],
      configured,
      null
    );
    expect(diff.addedCount).toBe(1);
    expect(diff.addedEndpoints).toEqual([{ method: 'GET', path: '/api/products' }]);
  });

  it('expands method arrays on both sides and dedupes case-insensitively', () => {
    const diff = diffRescan(
      [
        { method: ['GET', 'post'], path: '/api/a' },
        { method: 'get', path: '/API/A' }, // duplicate of GET /api/a
      ],
      servers({ method: ['GET', 'POST'], path: '/api/a' }),
      null
    );
    expect(diff.addedCount).toBe(0);
    expect(diff.changedCount).toBe(0);
    expect(diff.notify).toBe(false);
  });

  it('counts covered-path/uncovered-method endpoints as changed, not added', () => {
    const diff = diffRescan(
      [{ method: ['GET', 'DELETE'], path: '/api/users' }],
      servers({ method: 'get', path: '/api/users' }),
      null
    );
    expect(diff.addedCount).toBe(0);
    expect(diff.changedCount).toBe(1); // DELETE not offered
    expect(diff.notify).toBe(false);
  });

  it('requires the method on a route that actually covers the path', () => {
    const diff = diffRescan(
      [{ method: 'POST', path: '/api/users' }],
      servers(
        { method: 'GET', path: '/api/users' },
        { method: 'POST', path: '/api/orders' } // POST exists but elsewhere
      ),
      null
    );
    expect(diff.changedCount).toBe(1);
  });

  it('counts configured routes not covered by any summary path as removed', () => {
    const diff = diffRescan(
      [{ method: 'GET', path: '/api/users' }],
      servers(
        { method: 'GET', path: '/api/users' },
        { method: 'GET', path: '/api/legacy' }
      ),
      null
    );
    expect(diff.removedCount).toBe(1);
    expect(diff.notify).toBe(false);
  });

  it('never notifies for removed/changed-only diffs', () => {
    const diff = diffRescan(
      [{ method: 'PUT', path: '/api/users' }],
      servers(
        { method: 'GET', path: '/api/users' },
        { method: 'GET', path: '/api/gone' }
      ),
      null
    );
    expect(diff.changedCount).toBe(1);
    expect(diff.removedCount).toBe(1);
    expect(diff.addedCount).toBe(0);
    expect(diff.notify).toBe(false);
  });

  it('forces newSurfaceNames to [] when memory is null', () => {
    const diff = diffRescan([], [], null, [{ name: 'Shop', rootPath: '' }]);
    expect(diff.newSurfaceNames).toEqual([]);
    expect(diff.notify).toBe(false);
  });

  it('reports surfaces unknown to memory and skips known ones (surfaceKey rule)', () => {
    const diff = diffRescan(
      [],
      [],
      memoryWith({ name: 'Shop', rootPath: '' }, { name: 'Admin', rootPath: 'apps/admin' }),
      [
        { name: 'shop', rootPath: '' }, // known: case-insensitive name match
        { name: 'Admin', rootPath: 'apps/other' }, // new: different rootPath
        { name: 'Payments', rootPath: '' }, // new
      ]
    );
    expect(diff.newSurfaceNames).toEqual(['Admin', 'Payments']);
    expect(diff.notify).toBe(true);
  });

  it('caps newSurfaceNames at RESCAN_DIFF_MAX_LISTED', () => {
    const refs = Array.from({ length: 12 }, (_, i) => ({
      name: `Surface${i}`,
      rootPath: '',
    }));
    const diff = diffRescan([], [], memoryWith(), refs);
    expect(diff.newSurfaceNames.length).toBe(RESCAN_DIFF_MAX_LISTED);
  });

  it('bounds addedEndpoints to RESCAN_DIFF_MAX_LISTED while addedCount is exact', () => {
    const routes: RescanRoute[] = Array.from({ length: 11 }, (_, i) => ({
      method: 'GET',
      path: `/api/e${String(i).padStart(2, '0')}`,
    }));
    const diff = diffRescan(routes, [], null);
    expect(diff.addedCount).toBe(11);
    expect(diff.addedEndpoints.length).toBe(RESCAN_DIFF_MAX_LISTED);
    // Sorted by `METHOD path` key.
    expect(diff.addedEndpoints[0]).toEqual({ method: 'GET', path: '/api/e00' });
  });
});

describe('rescanFingerprint', () => {
  it('is stable and covers added keys plus surface names', () => {
    const diff = diffRescan(
      [
        { method: 'post', path: '/api/B' },
        { method: 'GET', path: '/api/a' },
      ],
      [],
      memoryWith(),
      [{ name: 'Shop', rootPath: '' }]
    );
    const fp = rescanFingerprint(diff);
    expect(fp).toBe('rescan:GET /api/a|POST /api/b|s:Shop');
    expect(rescanFingerprint(diff)).toBe(fp);
  });

  it('is sliced to RESCAN_FINGERPRINT_MAX_CHARS', () => {
    const routes: RescanRoute[] = Array.from({ length: 8 }, (_, i) => ({
      method: 'GET',
      path: `/${'x'.repeat(200)}/${i}`,
    }));
    const diff = diffRescan(routes, [], null);
    expect(rescanFingerprint(diff).length).toBe(RESCAN_FINGERPRINT_MAX_CHARS);
  });
});

describe('buildRescanNotificationText', () => {
  it('lists the first 3 METHOD path keys with an overflow count', () => {
    const routes: RescanRoute[] = Array.from({ length: 5 }, (_, i) => ({
      method: 'GET',
      path: `/api/e${i}`,
    }));
    const diff = diffRescan(routes, [], null);
    expect(buildRescanNotificationText(diff)).toBe(
      "Mocklify: Scheduled scan found 5 new endpoint(s) your mocks don't cover: GET /api/e0, GET /api/e1, GET /api/e2 and 2 more."
    );
  });

  it('mentions new surfaces alongside added endpoints', () => {
    const diff = diffRescan(
      [{ method: 'GET', path: '/api/a' }],
      [],
      memoryWith(),
      [{ name: 'Shop', rootPath: '' }]
    );
    expect(buildRescanNotificationText(diff)).toBe(
      "Mocklify: Scheduled scan found 1 new endpoint(s) your mocks don't cover and 1 new API surface(s): GET /api/a."
    );
  });

  it('handles the surfaces-only case', () => {
    const diff = diffRescan([], [], memoryWith(), [
      { name: 'Shop', rootPath: '' },
      { name: 'Admin', rootPath: '' },
    ]);
    expect(buildRescanNotificationText(diff)).toBe(
      'Mocklify: Scheduled scan found 2 new API surface(s): Shop, Admin.'
    );
  });
});

describe('buildRescanChatPrompt', () => {
  it('lists endpoints, annotates overflow, and appends the surfaces line', () => {
    const routes: RescanRoute[] = Array.from({ length: 10 }, (_, i) => ({
      method: 'GET',
      path: `/api/e${String(i).padStart(2, '0')}`,
    }));
    const diff = diffRescan(routes, [], memoryWith(), [{ name: 'Shop', rootPath: '' }]);
    const prompt = buildRescanChatPrompt(diff);
    const lines = prompt.split('\n');
    expect(lines[0]).toBe(
      'A scheduled Mocklify scan of this workspace found 10 endpoint(s) in the code that no mock route covers:'
    );
    expect(lines.filter((l) => l.startsWith('- GET ')).length).toBe(
      RESCAN_DIFF_MAX_LISTED
    );
    expect(lines).toContain('- …and 2 more');
    expect(lines).toContain('It also found new API surface(s): Shop.');
    expect(lines[lines.length - 1]).toBe(
      'Please review these and add mock routes for the ones that make sense, using the existing mock servers where they fit.'
    );
  });

  it('stays within CHAT_PREFILL_MAX_CHARS', () => {
    const routes: RescanRoute[] = Array.from({ length: 8 }, (_, i) => ({
      method: 'GET',
      path: `/${'y'.repeat(600)}/${i}`,
    }));
    const diff = diffRescan(routes, [], null);
    expect(buildRescanChatPrompt(diff).length).toBeLessThanOrEqual(
      CHAT_PREFILL_MAX_CHARS
    );
  });
});
