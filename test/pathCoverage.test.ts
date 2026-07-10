import { describe, it, expect } from 'vitest';
import { isPathCovered } from '../src/ai/proactive/pathCoverage';

// Pins the behavior of isPathCovered as moved verbatim out of DriftWatcher.ts.
describe('isPathCovered', () => {
  it('matches an exact route', () => {
    expect(isPathCovered('/api/users', ['/api/users'])).toBe(true);
  });

  it('is case-insensitive on literal segments', () => {
    expect(isPathCovered('/API/Users', ['/api/users'])).toBe(true);
    expect(isPathCovered('/api/users', ['/API/USERS'])).toBe(true);
  });

  it('treats :param route segments as wildcards', () => {
    expect(isPathCovered('/api/users/123', ['/api/users/:id'])).toBe(true);
    expect(isPathCovered('/api/users/123/posts', ['/api/users/:id'])).toBe(false);
  });

  it('treats :param candidate segments as wildcards too', () => {
    expect(isPathCovered('/api/users/:userId', ['/api/users/42'])).toBe(true);
  });

  it('matches a trailing * route against any deeper candidate', () => {
    expect(isPathCovered('/api/anything/deep/here', ['/api/*'])).toBe(true);
    expect(isPathCovered('/api', ['/api/*'])).toBe(true);
    expect(isPathCovered('/other/x', ['/api/*'])).toBe(false);
  });

  it('matches a prefix-carrying route by its tail (Retrofit relative paths)', () => {
    expect(isPathCovered('/users/1', ['/v1/api/users/:id'])).toBe(true);
    expect(isPathCovered('/users', ['/v1/api/users'])).toBe(true);
  });

  it('rejects when the route is shorter than the candidate', () => {
    expect(isPathCovered('/api/users/1/posts', ['/users/1'])).toBe(false);
  });

  it('rejects on segment mismatch and empty route lists', () => {
    expect(isPathCovered('/api/orders', ['/api/users'])).toBe(false);
    expect(isPathCovered('/api/users', [])).toBe(false);
  });
});
