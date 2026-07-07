import { describe, it, expect } from 'vitest';
import {
  hasGraphQlMarkers,
  modelFileNameCandidates,
  formatModelSection,
} from '../src/ai/scan/modelContext';

describe('hasGraphQlMarkers', () => {
  it('detects Apollo client usage', () => {
    expect(hasGraphQlMarkers('const client = new ApolloClient({ cache: new InMemoryCache() })')).toBe(true);
  });

  it('detects gql template tags', () => {
    expect(hasGraphQlMarkers('const QUERY = gql`query Users { users { id } }`')).toBe(true);
  });

  it('detects graphql-request and urql imports', () => {
    expect(hasGraphQlMarkers("import { GraphQLClient } from 'graphql-request'")).toBe(true);
    expect(hasGraphQlMarkers("import { createClient } from '@urql/core'")).toBe(true);
  });

  it('detects quoted /graphql endpoints', () => {
    expect(hasGraphQlMarkers('fetch("https://api.example.com/graphql", opts)')).toBe(true);
  });

  it('ignores plain REST code', () => {
    expect(hasGraphQlMarkers('await fetch("/api/users"); axios.get("/api/orders/1")')).toBe(false);
  });
});

describe('modelFileNameCandidates', () => {
  it('produces PascalCase, lowercase, and snake_case stems', () => {
    expect(modelFileNameCandidates('UserProfile')).toEqual([
      'UserProfile',
      'userprofile',
      'user_profile',
    ]);
  });

  it('deduplicates when the variants collide', () => {
    expect(modelFileNameCandidates('User')).toEqual(['User', 'user']);
  });
});

describe('formatModelSection', () => {
  const files = [
    { path: 'src/models/user.ts', definitions: 'interface User {\n  id: string;\n  name: string;\n}' },
    { path: 'src/models/order.ts', definitions: 'interface Order {\n  id: string;\n  total: number;\n}' },
  ];

  it('renders a header plus per-file blocks', () => {
    const section = formatModelSection(files, 4000);
    expect(section).toMatch(/^## Data models/);
    expect(section).toContain('// File: src/models/user.ts');
    expect(section).toContain('interface Order {');
  });

  it('returns an empty string when there is nothing to show', () => {
    expect(formatModelSection([], 4000)).toBe('');
    expect(formatModelSection([{ path: 'a.ts', definitions: '   ' }], 4000)).toBe('');
  });

  it('keeps whole files until the budget runs out', () => {
    const budget = 120 + files[0].definitions.length; // header + first block only
    const section = formatModelSection(files, budget);
    expect(section).toContain('// File: src/models/user.ts');
    expect(section).not.toContain('src/models/order.ts');
    expect(section.length).toBeLessThanOrEqual(budget);
  });

  it('never exceeds the given budget', () => {
    const section = formatModelSection(files, 4000);
    expect(section.length).toBeLessThanOrEqual(4000);
  });
});
