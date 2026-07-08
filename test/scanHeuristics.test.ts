import { describe, it, expect } from 'vitest';
import {
  scoreApiContent,
  scoreApiContentDirectional,
  extractApiSnippets,
  chunkScoredFiles,
  dedupeRoutes,
  extractModelReferences,
  extractTypeDefinitions,
  SERVER_MARKERS,
  CLIENT_MARKERS_EXTRA,
  SPEC_FILE_GLOB,
  API_FILE_GLOB,
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

const EXPRESS_JS = `
const app = express();
app.get('/users', (req, res) => res.json(users));
router.post('/orders', createOrder);
app.route('/items/:id').get(getItem).delete(removeItem);
`;

const NEST_TS = `
@Controller('users')
export class UsersController {
  @Get(':id')
  findOne(@Param('id') id: string) { return this.service.find(id); }

  @Post()
  create(@Body() dto: CreateUserDto) { return this.service.create(dto); }
}
`;

const SPRING_JAVA = `
@RestController
@RequestMapping("/api/users")
public class UserController {
    @GetMapping("/{id}")
    public User getUser(@PathVariable String id) { return service.find(id); }

    @PostMapping
    public User create(@RequestBody CreateUserRequest request) { return service.create(request); }
}
`;

const KTOR_SERVER_KT = `
fun Application.configureRouting() {
    routing {
        get("/users") {
            call.respond(userRepository.all())
        }
        post("/users") {
            call.respond(HttpStatusCode.Created)
        }
    }
}
`;

const KTOR_CLIENT_KT = `
val client = HttpClient(CIO) {
    install(ContentNegotiation) { json() }
}
suspend fun fetchUser(id: String): User =
    client.get("https://api.example.com/users/" + id).body()
suspend fun createOrder(order: OrderRequest) {
    client.post("/api/orders") { setBody(order) }
}
`;

const FASTAPI_PY = `
app = FastAPI()

@app.get("/users/{user_id}")
async def read_user(user_id: int):
    return {"user_id": user_id}

@router.post("/orders")
async def create_order(order: Order):
    return order
`;

const FLASK_PY = `
app = Flask(__name__)

@app.route("/users", methods=["GET", "POST"])
def users():
    return jsonify(user_list)

@bp.route("/orders/<int:order_id>")
def order_detail(order_id):
    return jsonify(get_order(order_id))
`;

const DJANGO_PY = `
from django.urls import path, re_path

urlpatterns = [
    path("users/", views.user_list, name="user-list"),
    re_path(r"^orders/(?P<pk>[0-9]+)/$", views.order_detail),
]
`;

const RAILS_RB = `
Rails.application.routes.draw do
  resources :users
  get "/health", to: "health#check"
  post "/webhooks/stripe", to: "webhooks#stripe"
end
`;

const LARAVEL_PHP = `
use Illuminate\\Support\\Facades\\Route;

Route::get('/users', [UserController::class, 'index']);
Route::post('/users', [UserController::class, 'store']);
`;

const GIN_GO = `
r := gin.Default()
r.GET("/users", listUsers)
r.POST("/users", createUser)
r.DELETE("/users/:id", deleteUser)
`;

const CHI_GO = `
r := chi.NewRouter()
r.Get("/users", listUsers)
r.Post("/users", createUser)
`;

const ASPNET_CS = `
[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    [HttpGet("{id}")]
    public ActionResult<User> GetUser(string id) => Ok(_service.Find(id));

    [HttpPost]
    public ActionResult<User> Create(CreateUserRequest request) => Ok(_service.Create(request));
}
`;

const ASPNET_MINIMAL_CS = `
var app = builder.Build();
app.MapGet("/health", () => Results.Ok());
app.MapPost("/orders", (Order order) => Results.Created());
`;

const CAPACITOR_TS = `
import { CapacitorHttp } from '@capacitor/core';

const response = await CapacitorHttp.get({ url: 'https://api.example.com/users' });
await CapacitorHttp.post({ url: 'https://api.example.com/orders', data: order });
`;

const TRPC_TS = `
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';

const trpc = createTRPCProxyClient<AppRouter>({
  links: [httpBatchLink({ url: '/api/trpc' })],
});
const user = await trpc.user.byId.query('42');
`;

const ANGULAR_TS = `
@Injectable({ providedIn: 'root' })
export class UserService {
  constructor(private http: HttpClient) {}

  getUsers(): Observable<User[]> {
    return this.http.get<User[]>('/api/users');
  }

  createUser(user: CreateUserRequest): Observable<User> {
    return this.http.post<User>('/api/users', user);
  }
}
`;

describe('SERVER_MARKERS ecosystem coverage', () => {
  const serverCases: [string, string, string][] = [
    ['Express', EXPRESS_JS, 'routes.js'],
    ['NestJS', NEST_TS, 'users.controller.ts'],
    ['Spring', SPRING_JAVA, 'UserController.java'],
    ['Ktor server', KTOR_SERVER_KT, 'Routing.kt'],
    ['FastAPI', FASTAPI_PY, 'main.py'],
    ['Flask', FLASK_PY, 'app.py'],
    ['Django', DJANGO_PY, 'urls.py'],
    ['Rails', RAILS_RB, 'routes.rb'],
    ['Laravel', LARAVEL_PHP, 'web.php'],
    ['gin', GIN_GO, 'main.go'],
    ['chi', CHI_GO, 'router.go'],
    ['ASP.NET attributes', ASPNET_CS, 'UsersController.cs'],
    ['ASP.NET minimal API', ASPNET_MINIMAL_CS, 'Program.cs'],
  ];

  it.each(serverCases)('%s route declarations score as server files', (_name, code, file) => {
    const { serverScore } = scoreApiContentDirectional(code, file);
    expect(serverScore).toBeGreaterThanOrEqual(10);
  });

  it.each(serverCases)('%s files now pass the combined scoreApiContent threshold', (_n, code, file) => {
    expect(scoreApiContent(code, file)).toBeGreaterThanOrEqual(10);
  });

  it('exports a non-empty array of RegExps', () => {
    expect(SERVER_MARKERS.length).toBeGreaterThan(10);
    for (const marker of SERVER_MARKERS) {
      expect(marker).toBeInstanceOf(RegExp);
    }
  });

  it('does not match plain UI components', () => {
    expect(scoreApiContentDirectional(PLAIN_UI, 'Button.tsx').serverScore).toBe(0);
  });
});

describe('CLIENT_MARKERS_EXTRA ecosystem coverage', () => {
  const clientCases: [string, string, string][] = [
    ['Ktor HttpClient', KTOR_CLIENT_KT, 'ApiClient.kt'],
    ['Capacitor', CAPACITOR_TS, 'httpPlugin.ts'],
    ['tRPC', TRPC_TS, 'trpc.ts'],
    ['Angular HttpClient', ANGULAR_TS, 'user.service.ts'],
  ];

  it.each(clientCases)('%s calls score as client files', (_name, code, file) => {
    const { clientScore } = scoreApiContentDirectional(code, file);
    expect(clientScore).toBeGreaterThanOrEqual(10);
  });

  it('exports a non-empty array of RegExps', () => {
    expect(CLIENT_MARKERS_EXTRA.length).toBeGreaterThan(5);
    for (const marker of CLIENT_MARKERS_EXTRA) {
      expect(marker).toBeInstanceOf(RegExp);
    }
  });

  it('Ktor client member calls do not count as server routing DSL', () => {
    const { clientScore, serverScore } = scoreApiContentDirectional(KTOR_CLIENT_KT, 'ApiClient.kt');
    expect(clientScore).toBeGreaterThan(serverScore);
    expect(serverScore).toBeLessThan(10);
  });

  it('detects openapi-generator client signatures', () => {
    const generated = `
import { Configuration, DefaultApi } from './generated';
const api = new DefaultApi(new Configuration({ basePath: BASE_PATH }));
export const BASE_PATH = 'https://api.example.com'.replace(/\\/+$/, '');
`;
    expect(scoreApiContentDirectional(generated, 'apiClient.ts').clientScore).toBeGreaterThanOrEqual(10);
  });

  it('detects Objective-C NSURLSession usage', () => {
    const objc = `
NSURLSession *session = [NSURLSession sharedSession];
NSURLSessionDataTask *task = [session dataTaskWithRequest:request completionHandler:handler];
`;
    expect(scoreApiContentDirectional(objc, 'ApiManager.m').clientScore).toBeGreaterThanOrEqual(10);
  });

  it('detects grpc-web / Connect clients', () => {
    const connect = `
import { createPromiseClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
const client = createPromiseClient(UserService, createConnectTransport({ baseUrl: '/' }));
`;
    expect(scoreApiContentDirectional(connect, 'client.ts').clientScore).toBeGreaterThanOrEqual(10);
  });

  it('detects tRPC React hooks after the lookbehind fix', () => {
    const hooks = `
const users = trpc.users.useQuery({ limit: 10 });
const create = api.post.useMutation();
const feed = $api.feed.useInfiniteQuery({});
`;
    expect(scoreApiContentDirectional(hooks, 'Feed.tsx').clientScore).toBeGreaterThanOrEqual(10);
  });

  it('scans a 256KB $-delimited identifier run in linear time (no \\b backtracking)', () => {
    // '$' is a non-word char inside [\\w$]: with \\b this input was quadratic
    // (~108s at 256KB); with the lookbehind it must be near-instant.
    const pathological = '$a'.repeat(131_072);
    const start = Date.now();
    const { clientScore, serverScore } = scoreApiContentDirectional(pathological, 'gen.ts');
    expect(Date.now() - start).toBeLessThan(2_000);
    expect(clientScore).toBe(0);
    expect(serverScore).toBe(0);
  });
});

describe('scoreApiContentDirectional', () => {
  it('separates a Spring controller (server) from a Retrofit interface (client)', () => {
    const spring = scoreApiContentDirectional(SPRING_JAVA, 'UserController.java');
    expect(spring.serverScore).toBeGreaterThan(spring.clientScore);
    expect(spring.serverScore).toBeGreaterThanOrEqual(10);
    expect(spring.clientScore).toBeLessThan(10);

    const retrofit = scoreApiContentDirectional(RETROFIT_KOTLIN, 'UserApi.kt');
    expect(retrofit.clientScore).toBeGreaterThan(retrofit.serverScore);
    expect(retrofit.clientScore).toBeGreaterThanOrEqual(10);
    expect(retrofit.serverScore).toBeLessThan(10);
  });

  it('scoreApiContent delegates: combined score is the directional max', () => {
    for (const [code, file] of [
      [FETCH_TS, 'orders.ts'],
      [SPRING_JAVA, 'UserController.java'],
      [PLAIN_UI, 'Button.tsx'],
    ] as const) {
      const { clientScore, serverScore } = scoreApiContentDirectional(code, file);
      expect(scoreApiContent(code, file)).toBe(Math.max(clientScore, serverScore));
    }
  });

  it('keeps the original client-only scores unchanged when no new markers fire', () => {
    const { clientScore, serverScore } = scoreApiContentDirectional(FETCH_TS, 'orders.ts');
    expect(serverScore).toBeLessThan(clientScore);
    expect(scoreApiContent(FETCH_TS, 'orders.ts')).toBe(clientScore);
  });
});

describe('extractApiSnippets with ecosystem markers', () => {
  it('extracts regions around server route declarations', () => {
    const expressSnippet = extractApiSnippets(EXPRESS_JS);
    expect(expressSnippet).toContain("app.get('/users'");

    const springSnippet = extractApiSnippets(SPRING_JAVA);
    expect(springSnippet).toContain('@GetMapping("/{id}")');

    const railsSnippet = extractApiSnippets(RAILS_RB);
    expect(railsSnippet).toContain('resources :users');
  });

  it('extracts regions around new client markers', () => {
    const trpcSnippet = extractApiSnippets(TRPC_TS);
    expect(trpcSnippet).toContain('createTRPCProxyClient');

    const capacitorSnippet = extractApiSnippets(CAPACITOR_TS);
    expect(capacitorSnippet).toContain('CapacitorHttp');
  });

  it('still returns empty for files without any markers', () => {
    expect(extractApiSnippets(PLAIN_UI)).toBe('');
  });
});

describe('SPEC_FILE_GLOB', () => {
  it('covers openapi, swagger, proto, graphql, and postman spec files', () => {
    expect(SPEC_FILE_GLOB).toContain('openapi');
    expect(SPEC_FILE_GLOB).toContain('swagger');
    expect(SPEC_FILE_GLOB).toContain('*.proto');
    expect(SPEC_FILE_GLOB).toContain('*.graphql');
    expect(SPEC_FILE_GLOB).toContain('postman_collection');
    expect(SPEC_FILE_GLOB.startsWith('**/')).toBe(true);
  });
});

describe('marker performance (ReDoS sanity)', () => {
  it('scores and snippets a pathological 200KB input quickly', () => {
    const junk =
      'app.get("' + '/a'.repeat(20000) + '\n' +
      'get ("/' + 'b'.repeat(40000) + '\n' +
      'path("' + 'c'.repeat(40000) + ', \n' +
      '@GET @Get( Route:: MapGet( [HttpGet '.repeat(2000);
    const content = junk.slice(0, 200 * 1024).padEnd(200 * 1024, 'x');
    expect(content.length).toBeGreaterThanOrEqual(200 * 1024);

    const start = Date.now();
    scoreApiContentDirectional(content, 'pathological.ts');
    extractApiSnippets(content, 4000);
    expect(Date.now() - start).toBeLessThan(2000);
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

describe('rust / elixir / scala ecosystems', () => {
  it('scores actix-web attribute routes as server', () => {
    const code = '#[get("/api/users")]\nasync fn users() -> impl Responder { HttpResponse::Ok() }';
    const { serverScore } = scoreApiContentDirectional(code, 'src/handlers.rs');
    expect(serverScore).toBeGreaterThanOrEqual(10);
  });

  it('scores axum Router.route as server', () => {
    const code = 'let app = Router::new().route("/api/items", get(list_items));';
    const { serverScore } = scoreApiContentDirectional(code, 'src/main.rs');
    expect(serverScore).toBeGreaterThanOrEqual(10);
  });

  it('scores reqwest client calls as client', () => {
    const code = 'let resp = reqwest::Client::new().get("https://api.example.com/users").send().await?;';
    const { clientScore } = scoreApiContentDirectional(code, 'src/api.rs');
    expect(clientScore).toBeGreaterThanOrEqual(10);
  });

  it('scores Phoenix router scope as server in .ex files', () => {
    const code = 'scope "/api", MyAppWeb do\n  pipe_through :api\n  get "/users", UserController, :index\nend';
    const { serverScore } = scoreApiContentDirectional(code, 'lib/my_app_web/router.ex');
    expect(serverScore).toBeGreaterThanOrEqual(10);
  });

  it('scores HTTPoison/Tesla calls as client', () => {
    const code = '{:ok, resp} = HTTPoison.get("https://api.example.com/users", headers)';
    const { clientScore } = scoreApiContentDirectional(code, 'lib/client.ex');
    expect(clientScore).toBeGreaterThanOrEqual(10);
  });

  it('scores Play routes DSL as server', () => {
    const code = 'GET /api/users controllers.UserController.list()';
    const { serverScore } = scoreApiContentDirectional(code, 'conf/routes.scala');
    expect(serverScore).toBeGreaterThanOrEqual(10);
  });

  it('includes ex/rs/scala in API_FILE_GLOB', () => {
    expect(API_FILE_GLOB).toContain('ex,exs,rs,scala');
  });
});
