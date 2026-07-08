import { describe, it, expect } from 'vitest';
import {
  detectUniversalSignals,
  isProbablyTextFile,
  shouldScanPath,
  pickScanCandidates,
  scoreFileUniversal,
  universalLean,
  UNIVERSAL_SEED_THRESHOLD,
} from '../src/ai/scan/universalSignals';
import { INCLUSIVE_SCAN_MODE } from '../src/ai/scan/heuristics';

// ---------------------------------------------------------------------------
// Snippets in languages the marker heuristics know NOTHING about
// ---------------------------------------------------------------------------

const LUA_HTTP = `
local http = require("socket.http")
local ltn12 = require("ltn12")
local BASE = "https://api.game.example/v1"

function M.fetchPlayer(id)
  return http.request(BASE .. "/players/" .. id)
end

function M.submitScore(id, token, payload)
  return http.request{
    url = BASE .. "/players/" .. id .. "/scores",
    method = "POST",
    headers = { ["Authorization"] = "Bearer " .. token },
    source = ltn12.source.string(payload),
  }
end
`;

const C_CURL = `
#include <curl/curl.h>

int delete_device(CURL *curl) {
  struct curl_slist *headers = NULL;
  curl_easy_setopt(curl, CURLOPT_URL, "https://api.iot.example/v2/devices/42");
  curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "DELETE");
  headers = curl_slist_append(headers, "Authorization: Bearer abc123");
  headers = curl_slist_append(headers, "x-api-key: secret");
  curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
  return curl_easy_perform(curl);
}
`;

const HASKELL_WREQ = `
module Api where

import Network.Wreq
import Control.Lens

opts token = defaults & header "Authorization" .~ ["Bearer " <> token]

listUsers token = getWith (opts token) "https://api.crm.example/v1/users"

createUser body = post "https://api.crm.example/v1/users" body

deleteAccount uid = delete ("https://api.crm.example/v1/accounts/" <> uid)
`;

const COBOL_ISH = `
       IDENTIFICATION DIVISION.
       PROGRAM-ID. INVOICE-SYNC.
       PROCEDURE DIVISION.
           MOVE "/api/v1/invoices" TO WS-API-PATH.
           MOVE "POST" TO WS-HTTP-METHOD.
           EXEC HTTP
               POST "/api/v1/invoices"
               HEADER "Authorization" WS-AUTH-BEARER
           END-EXEC.
           MOVE "/api/v1/invoices/{invoiceId}" TO WS-DETAIL-PATH.
`;

const TXT_NOTES = `
API notes — mobile team sync

Base URL: https://staging.api.example.com

GET /api/v1/orders            list orders (paginated)
POST /api/v1/orders           create order
GET /api/v1/orders/{orderId}  fetch one order
DELETE /api/v1/orders/{orderId}

All calls need "Authorization: Bearer <token>" plus the x-api-key header.
`;

const SHELL_CURL = `#!/usr/bin/env bash
set -euo pipefail

TOKEN="$(cat ~/.config/shop/token)"

curl -sS -X POST https://api.shop.example/v1/login \\
  -H "Authorization: Bearer $TOKEN" \\
  -d '{"user": "demo", "pass": "hunter2"}'

curl -sS https://api.shop.example/v1/items?limit=10 \\
  -H "x-api-key: $SHOP_KEY"
`;

const PLAIN_PROSE = `
Meeting notes: discussed the roadmap, hiring, and the offsite.
Nothing about networking here. Just words / more words.
`;

const UI_COMPONENT = `
export function Button({ label }: { label: string }) {
  return <button className="btn primary">{label}</button>;
}
`;

const CSS_ASSETS = `
.hero { background: url("/assets/img/hero.png"); }
.logo { background: url("/static/logo.svg"); }
`;

describe('detectUniversalSignals — unknown-language coverage', () => {
  it('detects API usage in Lua (no Lua markers exist)', () => {
    const signals = detectUniversalSignals(LUA_HTTP);
    expect(signals.urlPaths).toContain('/players');
    expect(signals.urlPaths).toContain('/scores');
    expect(signals.absoluteUrls).toContain('https://api.game.example/v1');
    expect(signals.methodHints).toBeGreaterThanOrEqual(1);
    expect(signals.authHints).toBeGreaterThanOrEqual(2);
    expect(signals.score).toBeGreaterThanOrEqual(UNIVERSAL_SEED_THRESHOLD);
  });

  it('detects API usage in C with libcurl', () => {
    const signals = detectUniversalSignals(C_CURL);
    expect(signals.absoluteUrls).toContain('https://api.iot.example/v2/devices/42');
    expect(signals.urlPaths).toContain('/v2/devices/42');
    expect(signals.methodHints).toBeGreaterThanOrEqual(1); // DELETE near the URL
    expect(signals.authHints).toBe(3); // Authorization, Bearer, x-api-key
    expect(signals.score).toBeGreaterThanOrEqual(UNIVERSAL_SEED_THRESHOLD);
  });

  it('detects API usage in Haskell (Wreq)', () => {
    const signals = detectUniversalSignals(HASKELL_WREQ);
    expect(signals.absoluteUrls.length).toBeGreaterThanOrEqual(2);
    expect(signals.urlPaths).toContain('/v1/users');
    expect(signals.score).toBeGreaterThanOrEqual(UNIVERSAL_SEED_THRESHOLD);
  });

  it('detects API usage in COBOL-ish pseudo code', () => {
    const signals = detectUniversalSignals(COBOL_ISH);
    expect(signals.urlPaths).toContain('/api/v1/invoices');
    expect(signals.urlPaths).toContain('/api/v1/invoices/{invoiceId}');
    expect(signals.methodHints).toBeGreaterThanOrEqual(1);
    expect(signals.score).toBeGreaterThanOrEqual(UNIVERSAL_SEED_THRESHOLD);
  });

  it('detects API surface in plain-text API notes', () => {
    const signals = detectUniversalSignals(TXT_NOTES);
    expect(signals.urlPaths).toContain('/api/v1/orders');
    expect(signals.urlPaths).toContain('/api/v1/orders/{orderId}');
    expect(signals.methodHints).toBeGreaterThanOrEqual(4);
    expect(signals.score).toBeGreaterThanOrEqual(UNIVERSAL_SEED_THRESHOLD);
  });

  it('detects API usage in a shell script with curl', () => {
    const signals = detectUniversalSignals(SHELL_CURL);
    expect(signals.absoluteUrls).toContain('https://api.shop.example/v1/login');
    expect(signals.urlPaths).toContain('/v1/items'); // query string stripped
    expect(signals.jsonShapes).toBeGreaterThanOrEqual(1);
    expect(signals.authHints).toBe(3);
    expect(signals.score).toBeGreaterThanOrEqual(UNIVERSAL_SEED_THRESHOLD);
  });
});

describe('detectUniversalSignals — negatives and noise', () => {
  it('scores plain prose at zero', () => {
    expect(detectUniversalSignals(PLAIN_PROSE).score).toBe(0);
  });

  it('scores a UI component below the seed threshold', () => {
    expect(detectUniversalSignals(UI_COMPONENT).score).toBeLessThan(UNIVERSAL_SEED_THRESHOLD);
  });

  it('rejects static asset paths in CSS', () => {
    const signals = detectUniversalSignals(CSS_ASSETS);
    expect(signals.urlPaths).toEqual([]);
    expect(signals.score).toBe(0);
  });

  it('rejects filesystem-looking paths and pathless division', () => {
    const signals = detectUniversalSignals('exec("/usr/local/bin/tool"); const half = a / b;');
    expect(signals.urlPaths).toEqual([]);
  });

  it('filters license/schema noise hosts', () => {
    const signals = detectUniversalSignals(
      '// Licensed under https://www.apache.org/licenses/LICENSE-2.0\n' +
        '<svg xmlns="http://www.w3.org/2000/svg">'
    );
    expect(signals.absoluteUrls).toEqual([]);
  });

  it('keeps a pure JSON config file well below the threshold', () => {
    const json = '{\n  "name": "demo",\n  "version": "1.0.0",\n  "private": true\n}';
    const signals = detectUniversalSignals(json);
    expect(signals.jsonShapes).toBeGreaterThanOrEqual(1);
    expect(signals.score).toBeLessThan(UNIVERSAL_SEED_THRESHOLD);
  });

  it('filters badge, CI, and code-hosting hyperlink hosts as noise', () => {
    const signals = detectUniversalSignals(
      '[![build](https://img.shields.io/github/actions/workflow/status/foo/bar/ci.yml)](https://github.com/foo/bar/actions)\n' +
        '[![npm](https://badge.fury.io/js/my-widget.svg)](https://www.npmjs.com/package/my-widget)\n' +
        'CI at https://travis-ci.org/foo/bar and coverage at https://codecov.io/gh/foo/bar\n' +
        'Adapted from https://www.contributor-covenant.org/version/2/faq'
    );
    expect(signals.absoluteUrls).toEqual([]);
    expect(signals.urlPaths).toEqual([]);
    expect(signals.score).toBe(0);
  });

  it('keeps API-looking subdomains of exact-match noise hosts', () => {
    const signals = detectUniversalSignals(
      'curl -X GET https://api.github.com/repos/foo/bar/issues'
    );
    expect(signals.absoluteUrls).toEqual(['https://api.github.com/repos/foo/bar/issues']);
    expect(signals.score).toBeGreaterThanOrEqual(UNIVERSAL_SEED_THRESHOLD);
  });
});

describe('scoreFileUniversal — repo-meta documentation noise (regression)', () => {
  const BADGE_README = `# My Widget Library

[![build](https://img.shields.io/github/actions/workflow/status/foo/bar/ci.yml)](https://github.com/foo/bar/actions)
[![npm](https://img.shields.io/npm/v/my-widget)](https://www.npmjs.com/package/my-widget)
[![license](https://img.shields.io/badge/license-MIT-blue)](https://opensource.org/licenses/MIT)

Get started by installing the package:

npm install my-widget

Head over to the docs at https://example.com/docs to learn more. Put simply,
this library renders widgets. Options are documented on the website.
`;

  it('keeps a badge-laden library README below the seed threshold', () => {
    const scored = scoreFileUniversal(BADGE_README, 'README.md');
    expect(scored.universalScore).toBeLessThan(UNIVERSAL_SEED_THRESHOLD);
  });

  it('keeps a typical package.json below the seed threshold', () => {
    const pkg = JSON.stringify(
      {
        name: 'my-widget',
        version: '1.2.0',
        description: 'Renders widgets',
        repository: { type: 'git', url: 'https://github.com/foo/my-widget.git' },
        bugs: { url: 'https://github.com/foo/my-widget/issues' },
        homepage: 'https://github.com/foo/my-widget#readme',
        scripts: { build: 'tsc', test: 'vitest run' },
        dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
      },
      null,
      2
    );
    const scored = scoreFileUniversal(pkg, 'package.json');
    expect(scored.universalScore).toBeLessThan(UNIVERSAL_SEED_THRESHOLD);
  });

  it('keeps a plain CHANGELOG and CODE_OF_CONDUCT below the seed threshold', () => {
    const changelog = `# Changelog
## 1.2.0
- Fixed crash, see https://github.com/foo/bar/issues/12
- Added feature https://github.com/foo/bar/pull/34
- Docs update https://github.com/foo/bar/pull/56 — you can now get options and set headers
`;
    expect(scoreFileUniversal(changelog, 'CHANGELOG.md').universalScore).toBeLessThan(
      UNIVERSAL_SEED_THRESHOLD
    );
    const conduct = `# Contributor Covenant Code of Conduct
This Code of Conduct is adapted from the [Contributor Covenant](https://www.contributor-covenant.org),
version 2.0, available at https://www.contributor-covenant.org/version/2/0/code_of_conduct.html.
For answers to common questions, see the FAQ at https://www.contributor-covenant.org/faq.
Translations are available at https://www.contributor-covenant.org/translations.
`;
    expect(scoreFileUniversal(conduct, 'CODE_OF_CONDUCT.md').universalScore).toBeLessThan(
      UNIVERSAL_SEED_THRESHOLD
    );
  });

  it('still lets a README that IS genuine API documentation seed the scan', () => {
    const apiDocReadme = `# Service API

All endpoints require the "Authorization: Bearer <token>" header.

GET /api/v1/orders            list orders
POST /api/v1/orders           create order
GET /api/v1/orders/{orderId}  fetch one order
DELETE /api/v1/orders/{orderId}
`;
    expect(scoreFileUniversal(apiDocReadme, 'README.md').universalScore).toBeGreaterThanOrEqual(
      UNIVERSAL_SEED_THRESHOLD
    );
  });
});

describe('universalLean', () => {
  const seed = (
    clientScore: number,
    serverScore: number,
    universalDirection?: 'serves' | 'consumes'
  ) => ({ clientScore, serverScore, universalDirection });

  it('returns undefined when any file has real marker confidence', () => {
    expect(universalLean([seed(0, 0, 'serves'), seed(25, 0, 'consumes')])).toBeUndefined();
    expect(universalLean([])).toBeUndefined();
  });

  it('leans serves only on a majority of serves-shaped universal-only files', () => {
    expect(universalLean([seed(0, 0, 'serves'), seed(2, 2, 'serves'), seed(0, 0, 'consumes')])).toBe(
      'serves'
    );
    expect(universalLean([seed(0, 0, 'serves'), seed(0, 0, 'consumes')])).toBe('consumes');
    expect(universalLean([seed(0, 0, 'consumes')])).toBe('consumes');
  });
});

describe('detectUniversalSignals — score formula', () => {
  it('matches the documented formula exactly on a known input', () => {
    const content =
      'Authorization: Bearer {"a": 1, "b": 2} "https://api.example.com/v1/users" GET /v1/orders';
    const signals = detectUniversalSignals(content);
    expect(signals.urlPaths.sort()).toEqual(['/v1/orders', '/v1/users']);
    expect(signals.absoluteUrls).toEqual(['https://api.example.com/v1/users']);
    expect(signals.methodHints).toBe(2); // bare "GET /v1/orders" + GET near the URL literal
    expect(signals.jsonShapes).toBe(1);
    expect(signals.authHints).toBe(2);
    const expected = 4 * 2 + 4 * 1 + 3 * 2 + 1 * 1 + 2 * 2;
    expect(signals.score).toBe(expected);
  });

  it('caps each component so a single signal type saturates', () => {
    const manyPaths = Array.from({ length: 12 }, (_, i) => `"/api/things${i}/list"`).join(' ');
    const signals = detectUniversalSignals(manyPaths);
    expect(signals.urlPaths.length).toBe(12);
    expect(signals.score).toBe(4 * 5); // path component capped at 5
  });

  it('deduplicates repeated paths and strips trailing slashes', () => {
    const signals = detectUniversalSignals('"/api/users/" "/api/users" \'/api/users\'');
    expect(signals.urlPaths).toEqual(['/api/users']);
  });
});

describe('isProbablyTextFile', () => {
  const encode = (s: string): Uint8Array => new TextEncoder().encode(s);

  it('accepts plain ASCII source', () => {
    expect(isProbablyTextFile(encode('local http = require("socket.http")\n'))).toBe(true);
  });

  it('accepts UTF-8 with multibyte characters', () => {
    expect(isProbablyTextFile(encode('// コメント — ünïcödé ✓\nconst x = 1;\n'))).toBe(true);
  });

  it('accepts empty files', () => {
    expect(isProbablyTextFile(new Uint8Array(0))).toBe(true);
  });

  it('accepts UTF-16 BOM files despite embedded NULs', () => {
    expect(isProbablyTextFile(Uint8Array.from([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]))).toBe(true);
    expect(isProbablyTextFile(Uint8Array.from([0xfe, 0xff, 0x00, 0x68, 0x00, 0x69]))).toBe(true);
  });

  it('rejects anything with a NUL byte', () => {
    expect(isProbablyTextFile(Uint8Array.from([0x68, 0x69, 0x00, 0x68]))).toBe(false);
  });

  it('rejects a PNG header', () => {
    expect(
      isProbablyTextFile(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ).toBe(false);
  });

  it('rejects high-nonprintable-ratio content without NULs', () => {
    const bytes = Uint8Array.from({ length: 64 }, (_, i) => (i % 3 === 0 ? 0x01 : 0x41));
    expect(isProbablyTextFile(bytes)).toBe(false);
  });
});

describe('shouldScanPath', () => {
  it.each([
    'src/net/api_client.lua',
    'Sources/App/Networking.hs',
    'legacy/INVOICE.CBL',
    'docs/api-notes.txt',
    'scripts/deploy.sh',
    'Makefile',
    'Dockerfile',
    'config/.env',
    'src/main.zig',
    'proto/service.proto',
  ])('scans %s', (path) => {
    expect(shouldScanPath(path)).toBe(true);
  });

  it.each([
    'assets/logo.png',
    'assets/icon.svg',
    'fonts/inter.woff2',
    'media/demo.mp4',
    'release/app.zip',
    'pkg/module.wasm',
    'Gemfile.lock',
    'package-lock.json',
    'pnpm-lock.yaml',
    'bun.lockb',
    'go.sum',
    'public/vendor.min.js',
    'dist-info/app.js.map',
    'model/weights.pb',
    'android/app.jar',
    'android/release.apk',
    'ios/App.ipa',
    'native/libfoo.dylib',
    'native/libfoo.so',
    'win/foo.dll',
    'docs/spec.pdf',
    'docs/notes.docx',
    'types/global.d.ts',
    'server.log',
  ])('skips %s', (path) => {
    expect(shouldScanPath(path)).toBe(false);
  });

  it.each([
    'node_modules/pkg/index.js',
    'app/build/gen/Api.kt',
    'ios/Pods/Alamofire/Source/AF.swift',
    'third/vendor/lib.rb',
    'web/dist/bundle.js',
    'py/__pycache__/mod.py',
    'infra/.terraform/main.tf',
  ])('skips vendored dir path %s', (path) => {
    expect(shouldScanPath(path)).toBe(false);
  });

  it('handles Windows separators', () => {
    expect(shouldScanPath('src\\node_modules\\pkg\\index.js')).toBe(false);
    expect(shouldScanPath('src\\api\\client.c')).toBe(true);
  });
});

describe('pickScanCandidates', () => {
  it('returns everything (deduped, sorted) under the cap', () => {
    const picked = pickScanCandidates(['b.lua', 'a.lua', 'b.lua'], 10);
    expect(picked).toEqual(['a.lua', 'b.lua']);
  });

  it('prefers API-hinting names when over the cap', () => {
    const picked = pickScanCandidates(['zz/util.lua', 'zz/api_client.lua', 'zz/math.lua'], 1);
    expect(picked).toEqual(['zz/api_client.lua']);
  });

  it('is breadth-fair: one giant folder cannot starve the others', () => {
    const giant = Array.from({ length: 50 }, (_, i) => `giant/f${String(i).padStart(2, '0')}.c`);
    const small = ['small/g0.c', 'small/g1.c', 'small/g2.c'];
    const picked = pickScanCandidates([...giant, ...small], 8);
    expect(picked).toHaveLength(8);
    for (const path of small) {
      expect(picked).toContain(path);
    }
  });

  it('is deterministic regardless of input order', () => {
    const paths = [
      'a/one.lua', 'a/two.lua', 'b/api.lua', 'b/three.lua', 'c/server.hs',
      'c/four.hs', 'root.txt', 'a/five.lua', 'b/six.lua', 'c/seven.hs',
    ];
    const shuffled = [...paths].reverse();
    const first = pickScanCandidates(paths, 5);
    const second = pickScanCandidates(shuffled, 5);
    expect(second).toEqual(first);
    expect(first).toHaveLength(5);
  });

  it('handles root-level files and a zero cap', () => {
    expect(pickScanCandidates(['a.txt'], 0)).toEqual([]);
    const picked = pickScanCandidates(['root1.c', 'root2.c', 'dir/x.c'], 2);
    expect(picked).toHaveLength(2);
  });
});

describe('scoreFileUniversal — integration contract', () => {
  it('lets unknown-language files reach the seed threshold on universal signals alone', () => {
    const scored = scoreFileUniversal(LUA_HTTP, 'net.lua');
    expect(scored.universalScore).toBeGreaterThanOrEqual(UNIVERSAL_SEED_THRESHOLD);
    expect(scored.clientScore).toBeLessThan(10);
    expect(scored.universalDirection).toBe('consumes');
  });

  it('keeps heuristic scores intact for known ecosystems', () => {
    const fetchTs = `
export async function loadOrders(token: string) {
  const res = await fetch("/api/orders", {
    headers: { Authorization: \`Bearer \${token}\` },
  });
  return res.json();
}
`;
    const scored = scoreFileUniversal(fetchTs, 'ApiService.ts');
    expect(scored.clientScore).toBeGreaterThanOrEqual(10);
    expect(scored.universalDirection).toBe('consumes');
  });

  it("pushes 'serves' for verb-at-line-start route tables", () => {
    const routes = `
get "/health", HealthHandler
post "/api/v1/widgets", WidgetHandler
`;
    expect(scoreFileUniversal(routes, 'routes.pl').universalDirection).toBe('serves');
  });

  it("pushes 'serves' for route-registration call shapes", () => {
    const nim = 'server.route("GET", "/api/v1/widgets", widgetHandler)';
    const scored = scoreFileUniversal(nim, 'server.nim');
    expect(scored.universalDirection).toBe('serves');
  });

  it("defaults to 'consumes' for client-shaped shell scripts", () => {
    expect(scoreFileUniversal(SHELL_CURL, 'smoke.sh').universalDirection).toBe('consumes');
  });
});

describe('ReDoS resistance — 256KB pathological inputs', () => {
  const SIZE = 256 * 1024;
  const repeatTo = (block: string): string =>
    block.repeat(Math.ceil(SIZE / block.length)).slice(0, SIZE);

  const inputs: Array<[string, string]> = [
    ['unterminated quoted paths', repeatTo('"' + '/a'.repeat(120))],
    ['dangling JSON keys', repeatTo('{"k":')],
    ['protocol soup', repeatTo('https://')],
    ['verb runs', repeatTo('GET  ')],
    ['many valid literals', repeatTo('"/api/x" ')],
    ['unterminated JSON values', repeatTo('{"a": ' + 'x'.repeat(200))],
    ['auth vocabulary runs', repeatTo('Authorization Bearer x-api-key ')],
    ['slash floods', repeatTo('/'.repeat(64) + '"')],
    ['quote floods', repeatTo('"\'`')],
  ];

  it('stays under 50ms per input', () => {
    // Warm up so JIT compilation is not billed to the first case.
    detectUniversalSignals('warm "/api/x" GET https://a.example/b {"a": 1, "b": 2}');
    for (const [name, input] of inputs) {
      expect(input.length).toBe(SIZE);
      const started = performance.now();
      detectUniversalSignals(input);
      const elapsed = performance.now() - started;
      expect(elapsed, `pathological input: ${name}`).toBeLessThan(50);
    }
  });
});

describe('heuristics back-compat marker', () => {
  it('exposes INCLUSIVE_SCAN_MODE additively', () => {
    expect(INCLUSIVE_SCAN_MODE).toBe(true);
  });
});
