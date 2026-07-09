import { describe, it, expect } from 'vitest';
import {
  parseOperationNameFromQuery,
  parseGraphQlBody,
  matchesGraphQlRoute,
} from '../../src/matching/graphqlMatch.js';
import { RequestMatcher, RequestInfo, GRAPHQL_MATCH_SCORE } from '../../src/matching/RequestMatcher.js';
import { RouteConfig, GraphQlRoute } from '../../src/types/core.js';

const gqlRoute = (
  graphql: GraphQlRoute,
  path = '/graphql',
  overrides: Partial<RouteConfig> = {}
): RouteConfig => ({
  id: 'r-gql',
  name: 'gql',
  enabled: true,
  method: 'POST',
  path,
  graphql,
  response: { type: 'static', statusCode: 200 },
  ...overrides,
});

const post = (path: string, body: unknown): RequestInfo => ({
  method: 'POST',
  path,
  headers: {},
  query: {},
  body,
});

describe('parseOperationNameFromQuery', () => {
  it('reads name and type from a named operation', () => {
    expect(parseOperationNameFromQuery('query GetUser { user { id } }')).toEqual({
      operationType: 'query',
      operationName: 'GetUser',
    });
    expect(parseOperationNameFromQuery('mutation AddUser($n:String){ addUser }')).toEqual({
      operationType: 'mutation',
      operationName: 'AddUser',
    });
    expect(parseOperationNameFromQuery('subscription OnPing { ping }')).toEqual({
      operationType: 'subscription',
      operationName: 'OnPing',
    });
  });

  it('treats the anonymous shorthand as a typeless-name query', () => {
    expect(parseOperationNameFromQuery('{ user { id } }')).toEqual({ operationType: 'query' });
  });

  it('returns a type but no name for an anonymous keyworded operation', () => {
    expect(parseOperationNameFromQuery('query { user }')).toEqual({ operationType: 'query' });
    expect(parseOperationNameFromQuery('mutation ($x: Int) { do }')).toEqual({
      operationType: 'mutation',
    });
  });

  it('skips leading whitespace, commas and # comments', () => {
    const q = '\n  # a comment line\n  ,, query GetThing { thing }';
    expect(parseOperationNameFromQuery(q)).toEqual({
      operationType: 'query',
      operationName: 'GetThing',
    });
  });

  it('returns {} for unrecognizable leading tokens and empty input', () => {
    expect(parseOperationNameFromQuery('fragment F on T { id }')).toEqual({});
    expect(parseOperationNameFromQuery('   ')).toEqual({});
    expect(parseOperationNameFromQuery('')).toEqual({});
  });

  it('skips one or more leading fragment definitions to reach the operation', () => {
    expect(
      parseOperationNameFromQuery('fragment F on User { id }\nquery GetUser { user { ...F } }')
    ).toEqual({ operationType: 'query', operationName: 'GetUser' });
    expect(
      parseOperationNameFromQuery(
        'fragment A on T { a }\nfragment B on T { b }\nmutation Go { go }'
      )
    ).toEqual({ operationType: 'mutation', operationName: 'Go' });
  });

  it('parses a 200KB pathological query in linear time', () => {
    // Deeply padded shorthand: lots of whitespace/comment noise then a body.
    const noise = ' '.repeat(200_000);
    const q = `query GetHuge${noise}{ a b c }`;
    const start = Date.now();
    const parsed = parseOperationNameFromQuery(q);
    const elapsed = Date.now() - start;
    expect(parsed).toEqual({ operationType: 'query', operationName: 'GetHuge' });
    expect(elapsed).toBeLessThan(500);

    // A purely-whitespace tail after a keyword must also stay linear.
    const q2 = 'query' + noise;
    const start2 = Date.now();
    expect(parseOperationNameFromQuery(q2)).toEqual({ operationType: 'query' });
    expect(Date.now() - start2).toBeLessThan(500);
  });
});

describe('parseGraphQlBody', () => {
  it('accepts an object body', () => {
    expect(parseGraphQlBody({ query: 'query A { a }', operationName: 'A' })).toEqual({
      query: 'query A { a }',
      operationName: 'A',
      variables: undefined,
    });
  });

  it('accepts a JSON string body', () => {
    expect(parseGraphQlBody('{"query":"{ a }"}')).toEqual({
      query: '{ a }',
      operationName: undefined,
      variables: undefined,
    });
  });

  it('returns null for malformed or non-graphql bodies', () => {
    expect(parseGraphQlBody('not json')).toBeNull();
    expect(parseGraphQlBody(undefined)).toBeNull();
    expect(parseGraphQlBody(42)).toBeNull();
    expect(parseGraphQlBody({ notQuery: 1 })).toBeNull();
    expect(parseGraphQlBody({ query: 123 })).toBeNull();
  });
});

describe('matchesGraphQlRoute', () => {
  const route: GraphQlRoute = { operationName: 'GetUser', operationType: 'query' };

  it('matches on parsed operation name and type', () => {
    expect(matchesGraphQlRoute('POST', { query: 'query GetUser { u }' }, route)).toBe(true);
  });

  it('prefers body.operationName over the query text', () => {
    expect(
      matchesGraphQlRoute('POST', { query: 'query GetUser { u }', operationName: 'GetUser' }, route)
    ).toBe(true);
  });

  it('rejects when the operation type disagrees', () => {
    expect(matchesGraphQlRoute('POST', { query: 'mutation GetUser { u }' }, route)).toBe(false);
  });

  it('rejects non-POST, malformed, and anonymous-without-name requests', () => {
    expect(matchesGraphQlRoute('GET', { query: 'query GetUser { u }' }, route)).toBe(false);
    expect(matchesGraphQlRoute('POST', 'garbage', route)).toBe(false);
    expect(matchesGraphQlRoute('POST', { query: '{ user }' }, route)).toBe(false);
  });

  it('uses the type of the operation selected by operationName in a multi-op doc', () => {
    const mutationRoute: GraphQlRoute = { operationName: 'SetUser', operationType: 'mutation' };
    const body = {
      query: 'query GetUser { user { id } }\nmutation SetUser { setUser }',
      operationName: 'SetUser',
    };
    // The first operation is a query, but operationName selects the mutation.
    expect(matchesGraphQlRoute('POST', body, mutationRoute)).toBe(true);
  });

  it('matches a named operation preceded by a fragment definition', () => {
    const body = { query: 'fragment F on User { id }\nquery GetUser { user { ...F } }' };
    expect(matchesGraphQlRoute('POST', body, route)).toBe(true);
  });
});

describe('RequestMatcher — graphql-native routes', () => {
  const matcher = new RequestMatcher();

  it('matches and adds GRAPHQL_MATCH_SCORE on top of the path score', () => {
    const routes = [gqlRoute({ operationName: 'GetUser', operationType: 'query' })];
    const result = matcher.match(post('/graphql', { query: 'query GetUser { u }' }), routes);
    expect(result.matched).toBe(true);
    expect(result.route?.id).toBe('r-gql');
    // exact single-segment path (20) + graphql bonus (15)
    expect(result.score).toBe(20 + GRAPHQL_MATCH_SCORE);
  });

  it('does NOT degrade to a path-only match when the operation mismatches', () => {
    const routes = [gqlRoute({ operationName: 'GetUser', operationType: 'query' })];
    const result = matcher.match(post('/graphql', { query: 'query Other { u }' }), routes);
    expect(result.matched).toBe(false);
  });

  it('falls through to a plain route on the same path for a malformed body', () => {
    const plain: RouteConfig = {
      id: 'r-plain',
      name: 'plain',
      enabled: true,
      method: 'POST',
      path: '/graphql',
      response: { type: 'static', statusCode: 200 },
    };
    const routes = [gqlRoute({ operationName: 'GetUser', operationType: 'query' }), plain];
    const result = matcher.match(post('/graphql', 'not-json'), routes);
    expect(result.matched).toBe(true);
    expect(result.route?.id).toBe('r-plain');
  });

  it('out-ranks a generic body-matcher route on the same path', () => {
    const graphql = gqlRoute({ operationName: 'GetUser', operationType: 'query' });
    const bodyMatch: RouteConfig = {
      id: 'r-body',
      name: 'body',
      enabled: true,
      method: 'POST',
      path: '/graphql',
      matcher: { body: { type: 'contains', value: 'GetUser' } },
      response: { type: 'static', statusCode: 200 },
    };
    const req = post('/graphql', { query: 'query GetUser { u }' });
    expect(matcher.match(req, [bodyMatch, graphql]).route?.id).toBe('r-gql');
    // order-independent
    expect(matcher.match(req, [graphql, bodyMatch]).route?.id).toBe('r-gql');
  });
});
