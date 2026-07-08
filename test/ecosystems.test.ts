import { describe, it, expect } from 'vitest';
import {
  ECOSYSTEMS,
  EcosystemPack,
  STRONG_CLIENT_MARKER_VIEW,
  EXTRA_CLIENT_MARKER_VIEW,
  SERVER_MARKER_VIEW,
  getPacksForFile,
  describePack,
  registerEcosystem,
  manifestRulesForFile,
  matchesManifestFile,
} from '../src/ai/scan/ecosystems';
import {
  SERVER_MARKERS,
  CLIENT_MARKERS_EXTRA,
  scoreApiContent,
  scoreApiContentDirectional,
} from '../src/ai/scan/heuristics';
import { detectProjects } from '../src/ai/scan/projectProfile';

// Baselines captured at import time, before any registerEcosystem call in
// this file mutates the live views.
const BASELINE = {
  packs: ECOSYSTEMS.length,
  strong: STRONG_CLIENT_MARKER_VIEW.length,
  extra: EXTRA_CLIENT_MARKER_VIEW.length,
  server: SERVER_MARKER_VIEW.length,
};

/** Every marker that lived in heuristics.ts's STRONG_MARKERS before the registry. */
const LEGACY_STRONG_SOURCES = [
  /\bfetch\s*\(/,
  /\baxios\b/,
  /\bXMLHttpRequest\b/,
  /@(GET|POST|PUT|DELETE|PATCH|HEAD|Multipart|FormUrlEncoded)\b/,
  /\bRetrofit\b/,
  /\bOkHttpClient\b|\bokhttp3\b/,
  /\bHttpURLConnection\b/,
  /\bVolley\b|\bJsonObjectRequest\b/,
  /\bURLSession\b/,
  /\bAlamofire\b|\bAF\.request\b/,
  /\bDio\b|\bdio\.(get|post|put|delete|patch)\b/,
  /\bhttp\.(get|post|put|delete|patch)\s*\(/,
  /\bHttpClient\b/,
  /\bRestTemplate\b|\bWebClient\b|\bFeignClient\b/,
  /\brequests\.(get|post|put|delete|patch)\s*\(/,
  /\$\.(ajax|get|post)\s*\(/,
  /\bcreateApi\b|\bfetchBaseQuery\b/,
  /\buseSWR\b|\buseQuery\b|\buseMutation\b/,
  /\bky\.(get|post|put|delete|patch)\b|\bgot\.(get|post|put|delete|patch)\b/,
  /\bcurl_init\b|\bGuzzle\b/,
  /\bApolloClient\b|\bInMemoryCache\b|\buseLazyQuery\b/,
  /\bgql\s*(?:`|\()/,
  /\bGraphQLClient\b|['"`]graphql-request['"`]/,
  /['"`]@?urql(?:\/[\w-]+)?['"`]/,
  /["'`][^"'`\s]*\/graphql\b/,
].map((r) => r.source);

/** Every marker that lived in CLIENT_MARKERS_EXTRA before the registry. */
const LEGACY_EXTRA_SOURCES = [
  /\breqwest::(?:Client|get)\b|\bClient::new\s*\(\)\s*\.\s*(?:get|post|put|patch|delete)\b/,
  /\bHTTPoison\.(?:get|post|put|patch|delete)\b|\bTesla\.(?:get|post|put|patch|delete)\b|\bReq\.(?:get|post|put|patch|delete)!?\b|\bFinch\.build\b/,
  /\bbasicRequest\b|\bws\.url\s*\(/,
  /\bHttpClient\s*\(/,
  /\bio\.ktor\.client\b/,
  /\bclient\.(?:get|post|put|patch|delete)\s*[(<{]/,
  /\bCapacitorHttp\b/,
  /\bHttp\.(?:request|get|post|put|patch|del)\s*\(/,
  /\bthis\.http\.(?:get|post|put|patch|delete|request)\s*\(/,
  /\bhttp\.(?:get|post|put|patch|delete)\s*</,
  /\bcreateTRPC(?:ProxyClient|Client|React|Next)\b/,
  /\bhttpBatchLink\b|\bhttpLink\b/,
  /['"`]@trpc\/[\w-]+['"`]/,
  /(?<![\w$])[\w$]+\.[\w$]+\.(?:useQuery|useMutation|useInfiniteQuery)\s*\(/,
  /\bnew\s+Configuration\s*\(/,
  /\bBASE_PATH\s*[:=]/,
  /\bOpenAPI\.BASE\b/,
  /\bNSURLSession\b/,
  /\bdataTaskWithRequest\b|\bdataTaskWithURL\b/,
  /\bcreatePromiseClient\b|\bcreateConnectTransport\b|\bcreateGrpcWebTransport\b/,
  /\bGrpcWebClientBase\b/,
  /['"`](?:grpc-web|@connectrpc\/[\w-]+|@bufbuild\/connect[\w-]*)['"`]/,
].map((r) => r.source);

/** Every marker that lived in SERVER_MARKERS before the registry. */
const LEGACY_SERVER_SOURCES = [
  /\b(?:app|router|fastify|server)\.(?:get|post|put|patch|delete|options|head|all)\s*\(\s*["'`]\//,
  /\.route\s*\(\s*["'`]\/[^"'`\n]*["'`]\s*\)\s*\.(?:get|post|put|patch|delete)/,
  /@(?:Get|Post|Put|Patch|Delete|Head|Options|All)\s*\(/,
  /@Controller\s*\(/,
  /@(?:Get|Post|Put|Patch|Delete|Request)Mapping\b/,
  /@RestController\b/,
  /\b(?:javax|jakarta)\.ws\.rs\b/,
  /@Path\s*\(\s*["']\//,
  /\brouting\s*\{/,
  /(?<![.\w])(?:get|post|put|patch|delete)\s*\(\s*["']\/[^"'\n]*["']\s*\)\s*\{/,
  /@(?:app|router)\.(?:get|post|put|patch|delete)\s*\(/,
  /@\w+\.route\s*\(\s*["']\//,
  /\burlpatterns\s*=/,
  /\b(?:path|re_path)\s*\(\s*r?["'][^"'\n]*["']\s*,/,
  /\bresources\s+:\w+/,
  /(?<![.\w])(?:get|post|put|patch|delete)\s+["']\/[^"'\n]*["']\s*,/,
  /\broutes\.draw\b/,
  /\bscope\s+["']\//,
  /\bRoute::(?:get|post|put|patch|delete|any|match|resource|apiResource)\s*\(/,
  /\b\w+\.(?:GET|POST|PUT|PATCH|DELETE)\s*\(\s*"\//,
  /\b\w+\.(?:Get|Post|Put|Patch|Delete)\s*\(\s*"\//,
  /\bHandleFunc\s*\(\s*"\//,
  /\.Methods\s*\(\s*"(?:GET|POST|PUT|PATCH|DELETE)"/,
  /\[Http(?:Get|Post|Put|Patch|Delete|Head|Options)\b/,
  /\[ApiController\]/,
  /\bMap(?:Get|Post|Put|Patch|Delete|Methods)\s*\(\s*"/,
  /#\[(?:get|post|put|patch|delete)\s*\(\s*"\//,
  /\bRouter::new\s*\(\)|\.route\s*\(\s*"\/[^"]*"\s*,\s*(?:get|post|put|patch|delete)\s*\(/,
  /\bwarp::path\b|\brocket::routes!/,
  /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/\S*\s+controllers\./,
  /\bpathPrefix\s*\(\s*"|\bcomplete\s*\(\s*StatusCodes\./,
].map((r) => r.source);

describe('ECOSYSTEMS registry completeness', () => {
  it('snapshots the derived-view counts (every legacy marker, nothing lost)', () => {
    expect(BASELINE.strong).toBe(25);
    expect(BASELINE.extra).toBe(22);
    expect(BASELINE.server).toBe(31);
    expect(BASELINE.packs).toBe(39);
  });

  it('contains every legacy strong client marker', () => {
    const sources = new Set(STRONG_CLIENT_MARKER_VIEW.map((m) => m.source));
    for (const legacy of LEGACY_STRONG_SOURCES) {
      expect(sources.has(legacy), `missing strong marker: ${legacy}`).toBe(true);
    }
  });

  it('contains every legacy extra client marker', () => {
    const sources = new Set(EXTRA_CLIENT_MARKER_VIEW.map((m) => m.source));
    for (const legacy of LEGACY_EXTRA_SOURCES) {
      expect(sources.has(legacy), `missing extra client marker: ${legacy}`).toBe(true);
    }
  });

  it('contains every legacy server marker', () => {
    const sources = new Set(SERVER_MARKER_VIEW.map((m) => m.source));
    for (const legacy of LEGACY_SERVER_SOURCES) {
      expect(sources.has(legacy), `missing server marker: ${legacy}`).toBe(true);
    }
  });

  it('never duplicates a marker across packs (scoring counts distinct regexes)', () => {
    const client: string[] = [];
    const server: string[] = [];
    for (const pack of ECOSYSTEMS) {
      client.push(...pack.clientMarkers.map((m) => `${m.source} ${m.flags}`));
      server.push(...pack.serverMarkers.map((m) => `${m.source} ${m.flags}`));
    }
    expect(new Set(client).size).toBe(client.length);
    expect(new Set(server).size).toBe(server.length);
  });

  it('has well-formed packs: unique ids, languages, kind, direction', () => {
    const ids = ECOSYSTEMS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const pack of ECOSYSTEMS) {
      expect(pack.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(pack.languages.length).toBeGreaterThan(0);
      expect(['consumes', 'serves', 'both']).toContain(pack.direction);
    }
  });

  it('covers the expected ecosystem ids', () => {
    const ids = new Set(ECOSYSTEMS.map((p) => p.id));
    for (const id of [
      'web-fetch',
      'react',
      'angular',
      'graphql-client',
      'trpc',
      'openapi-client',
      'grpc-web',
      'capacitor',
      'retrofit',
      'ios-http',
      'ktor-client',
      'dio',
      'express',
      'nest',
      'spring',
      'jaxrs',
      'ktor-server',
      'fastapi',
      'flask',
      'django',
      'rails',
      'phoenix',
      'laravel',
      'go-http',
      'aspnet',
      'rust-server',
      'reqwest',
      'elixir-clients',
      'play',
      'sttp',
      'python-requests',
      'dotnet-httpclient',
      'java-http-clients',
      'guzzle',
      'jquery',
      'ky-got',
    ]) {
      expect(ids.has(id), `missing pack: ${id}`).toBe(true);
    }
  });
});

describe('derived views are the live heuristics arrays', () => {
  it('heuristics re-exports the registry view objects', () => {
    expect(SERVER_MARKERS).toBe(SERVER_MARKER_VIEW);
    expect(CLIENT_MARKERS_EXTRA).toBe(EXTRA_CLIENT_MARKER_VIEW);
  });

  it('client direction: Retrofit interface scores strongly client-side', () => {
    const code = `
interface UserApi {
    @GET("api/users/{id}")
    suspend fun getUser(@Path("id") id: String): User
}
`;
    const { clientScore, serverScore } = scoreApiContentDirectional(code, 'UserApi.kt');
    expect(clientScore).toBeGreaterThanOrEqual(10);
    expect(clientScore).toBeGreaterThan(serverScore);
  });

  it('server direction: Express routes score strongly server-side', () => {
    const code = `
const router = express.Router();
router.get('/api/users', listUsers);
router.post('/api/users', createUser);
`;
    const { serverScore } = scoreApiContentDirectional(code, 'routes.js');
    expect(serverScore).toBeGreaterThanOrEqual(10);
  });

  it('server direction: FastAPI decorators score strongly server-side', () => {
    const code = `
@app.get("/api/items")
def list_items():
    return items
`;
    expect(scoreApiContentDirectional(code, 'main.py').serverScore).toBeGreaterThanOrEqual(10);
  });

  it('extra client tier: Angular this.http calls score client-side', () => {
    const code = `
export class UserService {
  getUsers() { return this.http.get<User[]>('/api/users'); }
}
`;
    expect(scoreApiContentDirectional(code, 'user.service.ts').clientScore).toBeGreaterThanOrEqual(
      10
    );
  });
});

describe('manifest classification derives from the registry', () => {
  it('orders package.json backend rules like the legacy table', () => {
    const names = manifestRulesForFile('package.json', { direction: 'serves' }).map(
      (r) => r.framework
    );
    expect(names).toEqual(['Express', 'Koa', 'Fastify', 'NestJS', 'hapi']);
  });

  it('orders package.json web rules like the legacy table', () => {
    const names = manifestRulesForFile('package.json', {
      direction: 'consumes',
      kind: 'web',
    }).map((r) => r.framework);
    expect(names).toEqual(['React', 'Vue', 'Angular', 'Svelte']);
  });

  it('orders go.mod rules like the legacy table', () => {
    const names = manifestRulesForFile('go.mod').map((r) => r.framework);
    expect(names).toEqual(['Gin', 'Echo', 'Chi', 'Gorilla Mux', 'Fiber']);
  });

  it('orders python rules like the legacy table', () => {
    const names = manifestRulesForFile('requirements.txt').map((r) => r.framework);
    expect(names).toEqual(['Django', 'Flask', 'FastAPI']);
  });

  it('detectProjects still classifies via the registry-backed tables', () => {
    const pkg = JSON.stringify({ name: 'api', dependencies: { fastify: '^4.0.0' } });
    const profiles = detectProjects([{ path: 'package.json', content: pkg }]);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ kind: 'backend', direction: 'serves' });
    expect(profiles[0].frameworks).toEqual(['Fastify']);
  });

  it('matchesManifestFile handles strings, regexes, and paths', () => {
    expect(matchesManifestFile('package.json', 'apps/web/package.json')).toBe(true);
    expect(matchesManifestFile('package.json', 'package.json.bak')).toBe(false);
    expect(matchesManifestFile(/\.csproj$/, 'src/Api/Api.csproj')).toBe(true);
    expect(matchesManifestFile(/^(?:Podfile|Package\.swift)$/, 'ios/Podfile')).toBe(true);
  });
});

describe('getPacksForFile', () => {
  it('routes Kotlin files to Android/KMP/JVM packs', () => {
    const ids = getPacksForFile('app/src/main/java/ApiClient.kt').map((p) => p.id);
    expect(ids).toContain('retrofit');
    expect(ids).toContain('ktor-client');
    expect(ids).toContain('spring');
    expect(ids).not.toContain('dio');
  });

  it('routes Python files to both client and server packs', () => {
    const ids = getPacksForFile('backend/main.py').map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['python-requests', 'django', 'flask', 'fastapi']));
  });

  it('routes manifest files by manifest rule, not extension', () => {
    expect(getPacksForFile('services/orders/go.mod').map((p) => p.id)).toContain('go-http');
    expect(getPacksForFile('ios/Podfile').map((p) => p.id)).toContain('ios-http');
    expect(getPacksForFile('app/build.gradle.kts').map((p) => p.id)).toEqual(
      expect.arrayContaining(['retrofit', 'ktor-client', 'spring', 'ktor-server'])
    );
  });

  it('returns an empty list for files no pack concerns', () => {
    expect(getPacksForFile('README.md')).toEqual([]);
  });
});

describe('describePack', () => {
  it('summarizes a known pack', () => {
    const description = describePack('spring');
    expect(description).toBeDefined();
    expect(description).toContain('spring');
    expect(description).toContain('serves');
    expect(description).toContain('Spring Boot');
  });

  it('returns undefined for an unknown id', () => {
    expect(describePack('not-a-pack')).toBeUndefined();
  });
});

describe('registerEcosystem', () => {
  const goodPack: EcosystemPack = {
    id: 'zig-http-test',
    languages: ['zig'],
    kind: 'library',
    direction: 'consumes',
    manifestRules: [
      { file: 'build.zig.zon', contentPattern: /\bzig-fetch\b/, framework: 'zig-fetch' },
    ],
    clientMarkers: [/\bzigFetch\.(?:get|post|put|delete)\s*\(/],
    serverMarkers: [],
  };

  it('accepts a well-formed pack and feeds the live derived views', () => {
    const extraBefore = CLIENT_MARKERS_EXTRA.length;
    registerEcosystem(goodPack);
    expect(ECOSYSTEMS.some((p) => p.id === 'zig-http-test')).toBe(true);
    expect(CLIENT_MARKERS_EXTRA.length).toBe(extraBefore + 1);
    expect(getPacksForFile('src/client.zig').map((p) => p.id)).toContain('zig-http-test');
    expect(describePack('zig-http-test')).toContain('consumes');
    // The new marker immediately participates in scoring.
    expect(scoreApiContent('const user = zigFetch.get("/api/users");', 'client.zig')).toBeGreaterThanOrEqual(10);
  });

  it('rejects a duplicate id', () => {
    expect(() => registerEcosystem({ ...goodPack })).toThrow(/already registered/);
  });

  it('rejects a quadratic nested-quantifier marker', () => {
    expect(() =>
      registerEcosystem({
        ...goodPack,
        id: 'quadratic-test',
        clientMarkers: [/\b(\w+)*x/],
      })
    ).toThrow(/quadratic/);
    expect(() =>
      registerEcosystem({
        ...goodPack,
        id: 'quadratic-test-2',
        clientMarkers: [/\b(?:ab+)+c/],
      })
    ).toThrow(/quadratic/);
  });

  it('rejects an unanchored marker', () => {
    expect(() =>
      registerEcosystem({
        ...goodPack,
        id: 'unanchored-test',
        clientMarkers: [/myHttp\.get\(/],
      })
    ).toThrow(/must start with/);
  });

  it('accepts lookbehind-anchored markers', () => {
    expect(() =>
      registerEcosystem({
        ...goodPack,
        id: 'lookbehind-test',
        languages: ['lua'],
        clientMarkers: [/(?<![.\w])luaHttp\.request\s*\(/],
      })
    ).not.toThrow();
  });

  it('rejects an empty language list and a blank id', () => {
    expect(() => registerEcosystem({ ...goodPack, id: 'no-langs', languages: [] })).toThrow(
      /language/
    );
    expect(() => registerEcosystem({ ...goodPack, id: '  ' })).toThrow(/non-empty/);
  });

  it('rejects a quadratic manifest contentPattern', () => {
    expect(() =>
      registerEcosystem({
        ...goodPack,
        id: 'bad-manifest-test',
        clientMarkers: [],
        manifestRules: [{ file: 'x.toml', contentPattern: /(a+)+b/, framework: 'X' }],
      })
    ).toThrow(/quadratic/);
  });
});
