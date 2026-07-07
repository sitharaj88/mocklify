import { describe, it, expect } from 'vitest';
import {
  scoreApiContent,
  extractApiSnippets,
  chunkScoredFiles,
  dedupeRoutes,
  extractModelReferences,
  extractTypeDefinitions,
} from '../src/ai/scan/heuristics';
import type { RouteConfig } from '../src/types/core';

const RETROFIT_KOTLIN = `
interface UserApi {
    @GET("api/users/{id}")
    suspend fun getUser(@Path("id") id: String): User

    @POST("api/users")
    suspend fun createUser(@Body user: CreateUserRequest): User
}
`;

const FETCH_TS = `
export async function loadOrders(token: string) {
  const response = await fetch(\`\${BASE_URL}/api/orders\`, {
    headers: { Authorization: \`Bearer \${token}\` },
  });
  if (response.status === 401) throw new AuthError();
  return response.json();
}
`;

const PLAIN_UI = `
export function Button({ label }: { label: string }) {
  return <button className="btn">{label}</button>;
}
`;

describe('scoreApiContent', () => {
  it('scores Retrofit interfaces as strong API files', () => {
    expect(scoreApiContent(RETROFIT_KOTLIN, 'UserApi.kt')).toBeGreaterThanOrEqual(10);
  });

  it('scores fetch-based web code as strong API files', () => {
    expect(scoreApiContent(FETCH_TS, 'orders.ts')).toBeGreaterThanOrEqual(10);
  });

  it('scores plain UI components below the threshold', () => {
    expect(scoreApiContent(PLAIN_UI, 'Button.tsx')).toBeLessThan(10);
  });

  it('gives a filename bonus only when markers exist', () => {
    expect(scoreApiContent(PLAIN_UI, 'ApiService.tsx')).toBeLessThan(10);
    const withMarkers = scoreApiContent(FETCH_TS, 'ApiService.ts');
    const withoutHint = scoreApiContent(FETCH_TS, 'orders.ts');
    expect(withMarkers).toBeGreaterThan(withoutHint);
  });
});

describe('scoreApiContent GraphQL markers', () => {
  it('scores Apollo client code as strong API files', () => {
    const apollo = `
import { ApolloClient, InMemoryCache, useLazyQuery } from '@apollo/client';
const client = new ApolloClient({ uri: '/graphql', cache: new InMemoryCache() });
const GET_USERS = gql\`query GetUsers { users { id name } }\`;
`;
    expect(scoreApiContent(apollo, 'client.ts')).toBeGreaterThanOrEqual(10);
  });

  it('scores graphql-request usage as strong API files', () => {
    const gqlRequest = `
import { GraphQLClient } from 'graphql-request';
const client = new GraphQLClient('https://api.example.com/graphql');
`;
    expect(scoreApiContent(gqlRequest, 'gqlClient.ts')).toBeGreaterThanOrEqual(10);
  });

  it('scores urql usage as strong API files', () => {
    const urql = `
import { createClient } from 'urql';
const client = createClient({ url: '/graphql' });
`;
    expect(scoreApiContent(urql, 'urqlClient.ts')).toBeGreaterThanOrEqual(10);
  });

  it('scores generic POST-to-/graphql code as strong API files', () => {
    const raw = `client.send({ url: "https://api.example.com/graphql", method: "POST" })`;
    expect(scoreApiContent(raw, 'transport.ts')).toBeGreaterThanOrEqual(10);
  });

  it('extracts snippets around gql documents', () => {
    const apollo = `
const one = 1;
const GET_USERS = gql\`query GetUsers { users { id } }\`;
`;
    expect(extractApiSnippets(apollo)).toContain('GetUsers');
  });
});

describe('extractApiSnippets', () => {
  it('extracts regions around API markers', () => {
    const snippet = extractApiSnippets(RETROFIT_KOTLIN);
    expect(snippet).toContain('@GET("api/users/{id}")');
    expect(snippet).toContain('@POST("api/users")');
  });

  it('returns empty for files without markers', () => {
    expect(extractApiSnippets(PLAIN_UI)).toBe('');
  });

  it('merges overlapping regions instead of duplicating lines', () => {
    const snippet = extractApiSnippets(RETROFIT_KOTLIN);
    const occurrences = snippet.split('interface UserApi').length - 1;
    expect(occurrences).toBe(1);
  });

  it('respects the max character cap', () => {
    const big = Array.from({ length: 500 }, (_, i) => `await fetch("/api/thing/${i}")`).join('\n');
    expect(extractApiSnippets(big, 2000).length).toBeLessThanOrEqual(2000);
  });
});

describe('chunkScoredFiles', () => {
  it('packs files into chunks under the size limit, highest score first', () => {
    const files = [
      { path: 'low.ts', score: 12, snippet: 'x'.repeat(500) },
      { path: 'high.ts', score: 40, snippet: 'y'.repeat(500) },
    ];
    const chunks = chunkScoredFiles(files, 24000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].indexOf('high.ts')).toBeLessThan(chunks[0].indexOf('low.ts'));
  });

  it('splits into multiple chunks when content exceeds the per-chunk limit', () => {
    const files = Array.from({ length: 4 }, (_, i) => ({
      path: `f${i}.ts`,
      score: 20,
      snippet: 'z'.repeat(9000),
    }));
    const chunks = chunkScoredFiles(files, 20000, 96000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(20000);
    }
  });

  it('stops adding files at the total budget', () => {
    const files = Array.from({ length: 30 }, (_, i) => ({
      path: `f${i}.ts`,
      score: 20,
      snippet: 'z'.repeat(9000),
    }));
    const chunks = chunkScoredFiles(files, 24000, 30000);
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    expect(total).toBeLessThanOrEqual(30000);
  });
});

describe('extractModelReferences', () => {
  it('resolves relative TS imports and harvests PascalCase identifiers', () => {
    const tsClient = `
import axios from 'axios';
import { User, CreateUserRequest } from '../models/user.js';
import type { Order } from './order';

export async function getUser(id: string): Promise<User> {
  return axios.get(\`/api/users/\${id}\`);
}
`;
    const refs = extractModelReferences(tsClient, 'src/api/userClient.ts');
    expect(refs.typeNames).toEqual(expect.arrayContaining(['User', 'CreateUserRequest', 'Order']));
    expect(refs.importPaths).toContain('src/models/user.ts');
    expect(refs.importPaths).toContain('src/api/order.ts');
    expect(refs.importPaths).toContain('src/api/order/index.ts');
    expect(refs.importPaths.some((p) => p.includes('axios'))).toBe(false);
  });

  it('ignores non-model TS imports like lowercase helpers', () => {
    const tsClient = `
import { buildUrl } from './urlHelpers';
`;
    const refs = extractModelReferences(tsClient, 'src/api/client.ts');
    expect(refs.typeNames).toEqual([]);
    expect(refs.importPaths).toEqual([]);
  });

  it('resolves relative Dart imports and show clauses', () => {
    const dartClient = `
import 'package:http/http.dart' as http;
import '../models/user.dart' show User;
import 'order_model.dart';
`;
    const refs = extractModelReferences(dartClient, 'lib/api/client.dart');
    expect(refs.importPaths).toContain('lib/models/user.dart');
    expect(refs.importPaths).toContain('lib/api/order_model.dart');
    expect(refs.importPaths.some((p) => p.includes('package:'))).toBe(false);
    expect(refs.typeNames).toContain('User');
  });

  it('harvests type names from Kotlin API-call context without import paths', () => {
    const kotlinApi = `
interface UserApi {
    @GET("users/{id}")
    fun getUser(@Path("id") id: String): Call<User>

    @GET("orders")
    suspend fun listOrders(): List<OrderSummary>

    @POST("profile")
    suspend fun updateProfile(@Body body: ProfileUpdate): Profile
}
`;
    const refs = extractModelReferences(kotlinApi, 'app/src/main/UserApi.kt');
    expect(refs.importPaths).toEqual([]);
    expect(refs.typeNames).toEqual(expect.arrayContaining(['User', 'OrderSummary', 'Profile']));
    expect(refs.typeNames).not.toContain('String');
    expect(refs.typeNames).not.toContain('Call');
    expect(refs.typeNames).not.toContain('List');
  });

  it('harvests type names from Swift decode calls and return types', () => {
    const swiftApi = `
func fetchUser() async throws -> User {
    let (data, _) = try await URLSession.shared.data(from: url)
    return try JSONDecoder().decode(User.self, from: data)
}
let orders = try decoder.decode([OrderSummary].self, from: payload)
`;
    const refs = extractModelReferences(swiftApi, 'Sources/App/UserService.swift');
    expect(refs.importPaths).toEqual([]);
    expect(refs.typeNames).toEqual(expect.arrayContaining(['User', 'OrderSummary']));
    expect(refs.typeNames).not.toContain('JSONDecoder');
  });
});

describe('extractTypeDefinitions', () => {
  const MODELS_TS = `
export interface User {
  id: string;
  address: {
    street: string;
    city: string;
  };
}

export type Order = {
  id: string;
  items: string[];
};

export interface Unrelated {
  x: number;
}
`;

  it('extracts brace-balanced blocks for requested names only', () => {
    const result = extractTypeDefinitions(MODELS_TS, ['User', 'Order']);
    expect(result).toContain('interface User');
    expect(result).toContain('street: string');
    expect(result).toContain('type Order');
    expect(result).not.toContain('Unrelated');
  });

  it('balances nested braces so the block ends at the right place', () => {
    const result = extractTypeDefinitions(MODELS_TS, ['User']);
    expect(result).toContain('city: string');
    expect(result).not.toContain('Order');
    expect(result.trimEnd().endsWith('}')).toBe(true);
  });

  it('extracts Kotlin data classes across multiple lines', () => {
    const kotlinModels = `
data class User(
    val id: String,
    val tags: List<String>
)

data class Order(val id: String)
`;
    const result = extractTypeDefinitions(kotlinModels, ['User']);
    expect(result).toContain('data class User');
    expect(result).toContain('val tags');
    expect(result).not.toContain('Order');
  });

  it('returns empty string when no requested type is defined', () => {
    expect(extractTypeDefinitions('const x = 1;', ['User'])).toBe('');
    expect(extractTypeDefinitions(MODELS_TS, [])).toBe('');
  });

  it('respects the max character cap', () => {
    const big = `interface User {\n${'  field: string;\n'.repeat(500)}}`;
    expect(extractTypeDefinitions(big, ['User'], 300).length).toBeLessThanOrEqual(300);
  });
});

describe('dedupeRoutes', () => {
  const route = (
    method: RouteConfig['method'],
    path: string,
    statusCode: number
  ): Omit<RouteConfig, 'id'> => ({
    name: `${method} ${path} ${statusCode}`,
    enabled: true,
    method,
    path,
    response: { type: 'static', statusCode },
  });

  it('removes duplicates with same method, path, and status', () => {
    const result = dedupeRoutes([route('GET', '/api/users', 200), route('GET', '/api/users', 200)]);
    expect(result).toHaveLength(1);
  });

  it('keeps positive and negative variants of the same endpoint', () => {
    const result = dedupeRoutes([
      route('GET', '/api/users/:id', 200),
      route('GET', '/api/users/:id', 404),
      route('GET', '/api/users/:id', 401),
    ]);
    expect(result).toHaveLength(3);
  });

  it('treats paths case-insensitively and keeps the first occurrence', () => {
    const first = route('GET', '/API/Users', 200);
    const result = dedupeRoutes([first, route('GET', '/api/users', 200)]);
    expect(result).toEqual([first]);
  });

  it('distinguishes different methods on the same path', () => {
    const result = dedupeRoutes([route('GET', '/api/users', 200), route('POST', '/api/users', 200)]);
    expect(result).toHaveLength(2);
  });
});
