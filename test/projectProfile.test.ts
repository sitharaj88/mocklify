import { describe, it, expect } from 'vitest';
import {
  detectProjects,
  describeProfiles,
  findSpecFiles,
  ProfileInputFile,
} from '../src/ai/scan/projectProfile';

function pkg(deps: Record<string, string>, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: deps, ...extra });
}

describe('detectProjects — single-project workspaces', () => {
  it('detects a React web app from package.json', () => {
    const profiles = detectProjects([
      { path: 'package.json', content: pkg({ react: '^18.2.0', 'react-dom': '^18.2.0' }) },
      { path: 'src/App.tsx' },
    ]);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      rootPath: '',
      kind: 'web',
      direction: 'consumes',
      confidence: 'high',
    });
    expect(profiles[0].frameworks).toContain('React');
  });

  it('detects Next.js as web with direction both', () => {
    const profiles = detectProjects([
      { path: 'package.json', content: pkg({ next: '14.0.0', react: '18.0.0' }) },
    ]);
    expect(profiles[0].kind).toBe('web');
    expect(profiles[0].direction).toBe('both');
    expect(profiles[0].frameworks).toContain('Next.js');
  });

  it('detects an Express backend as serves', () => {
    const profiles = detectProjects([
      { path: 'package.json', content: pkg({ express: '^4.19.0' }) },
    ]);
    expect(profiles[0]).toMatchObject({ kind: 'backend', direction: 'serves', confidence: 'high' });
    expect(profiles[0].frameworks).toEqual(['Express']);
  });

  it('detects NestJS via scoped packages', () => {
    const profiles = detectProjects([
      { path: 'package.json', content: pkg({ '@nestjs/core': '^10.0.0', '@nestjs/common': '^10.0.0' }) },
    ]);
    expect(profiles[0].kind).toBe('backend');
    expect(profiles[0].frameworks).toEqual(['NestJS']);
  });

  it('classifies mixed client+server deps as web with direction both', () => {
    const profiles = detectProjects([
      { path: 'package.json', content: pkg({ react: '18.0.0', express: '^4.19.0' }) },
    ]);
    expect(profiles[0].kind).toBe('web');
    expect(profiles[0].direction).toBe('both');
    expect(profiles[0].frameworks).toEqual(expect.arrayContaining(['React', 'Express']));
  });

  it('detects an Ionic/Capacitor app', () => {
    const profiles = detectProjects([
      {
        path: 'package.json',
        content: pkg({
          '@ionic/react': '^8.0.0',
          '@capacitor/core': '^6.0.0',
          react: '^18.2.0',
        }),
      },
    ]);
    expect(profiles[0]).toMatchObject({
      kind: 'ionic-capacitor',
      direction: 'consumes',
      confidence: 'high',
    });
    expect(profiles[0].frameworks).toContain('React');
  });

  it('detects a package.json with no app frameworks as a library', () => {
    const profiles = detectProjects([
      { path: 'package.json', content: pkg({ lodash: '^4.17.0' }, { main: 'index.js' }) },
    ]);
    expect(profiles[0]).toMatchObject({ kind: 'library', direction: 'consumes', confidence: 'low' });
  });

  it('detects an Android app from gradle + AndroidManifest with Retrofit', () => {
    const profiles = detectProjects([
      { path: 'settings.gradle', content: "include ':app'" },
      {
        path: 'app/build.gradle',
        content:
          "plugins { id 'com.android.application' }\ndependencies { implementation 'com.squareup.retrofit2:retrofit:2.9.0' }",
      },
      { path: 'app/src/main/AndroidManifest.xml' },
    ]);
    expect(profiles).toHaveLength(1); // multi-module build folds into one project
    expect(profiles[0]).toMatchObject({
      rootPath: '',
      kind: 'mobile-android',
      direction: 'consumes',
      confidence: 'high',
    });
    expect(profiles[0].frameworks).toContain('Retrofit');
  });

  it('detects Kotlin Multiplatform from the multiplatform plugin', () => {
    const profiles = detectProjects([
      { path: 'settings.gradle.kts', content: 'include(":shared")\ninclude(":androidApp")' },
      {
        path: 'shared/build.gradle.kts',
        content: 'plugins { kotlin("multiplatform") }\ndependencies { implementation("io.ktor:ktor-client-core:2.3.0") }',
      },
      { path: 'shared/shared.podspec' },
      { path: 'shared/src/commonMain/kotlin/Api.kt' },
      { path: 'androidApp/build.gradle.kts', content: 'plugins { id("com.android.application") }' },
      { path: 'androidApp/src/main/AndroidManifest.xml' },
      { path: 'iosApp/iosApp.xcodeproj/project.pbxproj' },
    ]);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ kind: 'kmp', direction: 'consumes', confidence: 'high' });
    expect(profiles[0].frameworks).toContain('Ktor');
  });

  it('profiles a root-folded Gradle build mixing an Android app and a Spring server as BOTH', () => {
    const profiles = detectProjects([
      { path: 'settings.gradle', content: "include ':app'\ninclude ':server'" },
      {
        path: 'app/build.gradle',
        content:
          "apply plugin: 'com.android.application'\nimplementation 'com.squareup.retrofit2:retrofit'",
      },
      { path: 'app/src/main/AndroidManifest.xml' },
      { path: 'server/build.gradle', content: "plugins { id 'org.springframework.boot' }" },
    ]);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].rootPath).toBe('');
    // One direction would silently drop the other API surface.
    expect(profiles[0].direction).toBe('both');
    expect(profiles[0].frameworks).toContain('Spring Boot');
    expect(profiles[0].frameworks).toContain('Retrofit');
  });

  it('profiles a KMP build with a folded Ktor server module as BOTH', () => {
    const profiles = detectProjects([
      { path: 'settings.gradle.kts', content: 'include(":shared")\ninclude(":server")' },
      {
        path: 'shared/build.gradle.kts',
        content:
          'plugins { kotlin("multiplatform") }\ndependencies { implementation("io.ktor:ktor-client-core:2.3.0") }',
      },
      { path: 'shared/src/commonMain/kotlin/Api.kt' },
      {
        path: 'server/build.gradle.kts',
        content: 'dependencies { implementation("io.ktor:ktor-server-netty:2.3.0") }',
      },
    ]);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].kind).toBe('kmp');
    expect(profiles[0].direction).toBe('both');
  });

  it('detects KMP from podspec + commonMain source sets without plugin text', () => {
    const profiles = detectProjects([
      { path: 'shared/build.gradle.kts', content: 'kotlin { jvm() }' },
      { path: 'shared/shared.podspec' },
      { path: 'shared/src/commonMain/kotlin/Greeting.kt' },
    ]);
    expect(profiles[0].kind).toBe('kmp');
    expect(profiles[0].confidence).toBe('medium');
  });

  it('detects an iOS app from xcodeproj + Podfile with Alamofire', () => {
    const profiles = detectProjects([
      { path: 'MyApp.xcodeproj/project.pbxproj' },
      { path: 'Podfile', content: "target 'MyApp' do\n  pod 'Alamofire', '~> 5.8'\nend" },
    ]);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      rootPath: '',
      kind: 'mobile-ios',
      direction: 'consumes',
      confidence: 'high',
    });
    expect(profiles[0].frameworks).toContain('Alamofire');
  });

  it('detects Package.swift alone as iOS with medium confidence', () => {
    const profiles = detectProjects([
      { path: 'Package.swift', content: '// swift-tools-version:5.9\nimport PackageDescription' },
    ]);
    expect(profiles[0].kind).toBe('mobile-ios');
    expect(profiles[0].confidence).toBe('medium');
  });

  it('detects a Flutter app from pubspec.yaml with Dio', () => {
    const profiles = detectProjects([
      {
        path: 'pubspec.yaml',
        content: 'name: my_app\ndependencies:\n  flutter:\n    sdk: flutter\n  dio: ^5.4.0\n',
      },
      { path: 'lib/main.dart' },
    ]);
    expect(profiles[0]).toMatchObject({ kind: 'flutter', direction: 'consumes', confidence: 'high' });
    expect(profiles[0].frameworks).toContain('Dio');
  });

  it('detects a Go backend from gin in go.mod', () => {
    const profiles = detectProjects([
      {
        path: 'go.mod',
        content: 'module example.com/api\n\ngo 1.22\n\nrequire github.com/gin-gonic/gin v1.9.1\n',
      },
    ]);
    expect(profiles[0]).toMatchObject({ kind: 'backend', direction: 'serves', confidence: 'high' });
    expect(profiles[0].frameworks).toEqual(['Gin']);
  });

  it('falls back to unknown for a go.mod without a web framework', () => {
    const profiles = detectProjects([
      { path: 'go.mod', content: 'module example.com/tool\n\ngo 1.22\n' },
    ]);
    expect(profiles[0].kind).toBe('unknown');
    expect(profiles[0].confidence).toBe('low');
  });

  it('detects a Django backend from requirements.txt', () => {
    const profiles = detectProjects([
      { path: 'requirements.txt', content: 'Django==5.0.1\npsycopg2-binary==2.9.9\n' },
    ]);
    expect(profiles[0]).toMatchObject({ kind: 'backend', direction: 'serves' });
    expect(profiles[0].frameworks).toEqual(['Django']);
  });

  it('detects FastAPI from pyproject.toml', () => {
    const profiles = detectProjects([
      {
        path: 'pyproject.toml',
        content: '[project]\nname = "svc"\ndependencies = ["fastapi>=0.110", "uvicorn"]\n',
      },
    ]);
    expect(profiles[0].kind).toBe('backend');
    expect(profiles[0].frameworks).toEqual(['FastAPI']);
  });

  it('detects Spring Boot from pom.xml', () => {
    const profiles = detectProjects([
      {
        path: 'pom.xml',
        content:
          '<project><parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId></parent></project>',
      },
    ]);
    expect(profiles[0]).toMatchObject({ kind: 'backend', direction: 'serves' });
    expect(profiles[0].frameworks).toEqual(['Spring Boot']);
  });

  it('detects Spring Boot from build.gradle without an AndroidManifest', () => {
    const profiles = detectProjects([
      {
        path: 'build.gradle',
        content: "plugins { id 'org.springframework.boot' version '3.2.0' }",
      },
    ]);
    expect(profiles[0].kind).toBe('backend');
    expect(profiles[0].frameworks).toEqual(['Spring Boot']);
  });

  it('detects Rails from the Gemfile', () => {
    const profiles = detectProjects([
      { path: 'Gemfile', content: "source 'https://rubygems.org'\ngem 'rails', '~> 7.1'\n" },
    ]);
    expect(profiles[0]).toMatchObject({ kind: 'backend', direction: 'serves' });
    expect(profiles[0].frameworks).toEqual(['Rails']);
  });

  it('detects ASP.NET Core from a csproj', () => {
    const profiles = detectProjects([
      {
        path: 'Api/Api.csproj',
        content:
          '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Microsoft.AspNetCore.OpenApi" /></ItemGroup></Project>',
      },
    ]);
    expect(profiles[0]).toMatchObject({ rootPath: 'Api', kind: 'backend', direction: 'serves' });
    expect(profiles[0].frameworks).toEqual(['ASP.NET Core']);
  });

  it('detects Laravel from composer.json', () => {
    const profiles = detectProjects([
      {
        path: 'composer.json',
        content: JSON.stringify({ require: { php: '^8.2', 'laravel/framework': '^11.0' } }),
      },
    ]);
    expect(profiles[0]).toMatchObject({ kind: 'backend', direction: 'serves' });
    expect(profiles[0].frameworks).toEqual(['Laravel']);
  });
});

describe('detectProjects — react-native and native shells', () => {
  it('reports a react-native app with android/ and ios/ shells as ONE project', () => {
    const profiles = detectProjects([
      { path: 'package.json', content: pkg({ 'react-native': '0.74.0', react: '18.2.0' }) },
      { path: 'android/settings.gradle', content: "include ':app'" },
      { path: 'android/build.gradle', content: "classpath 'com.android.tools.build:gradle'" },
      {
        path: 'android/app/build.gradle',
        content: "apply plugin: 'com.android.application'",
      },
      { path: 'android/app/src/main/AndroidManifest.xml' },
      { path: 'ios/MyApp.xcodeproj/project.pbxproj' },
      { path: 'ios/Podfile', content: "require_relative '../node_modules/react-native/scripts/react_native_pods'" },
    ]);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      rootPath: '',
      kind: 'react-native',
      direction: 'consumes',
      confidence: 'high',
    });
  });

  it('folds native shells for a react-native app nested in a monorepo', () => {
    const profiles = detectProjects([
      { path: 'apps/mobile/package.json', content: pkg({ 'react-native': '0.74.0' }) },
      { path: 'apps/mobile/android/build.gradle', content: '' },
      { path: 'apps/mobile/android/app/src/main/AndroidManifest.xml' },
      { path: 'apps/mobile/ios/Mobile.xcodeproj/project.pbxproj' },
      { path: 'server/package.json', content: pkg({ fastify: '^4.0.0' }) },
    ]);
    expect(profiles).toHaveLength(2);
    const kinds = profiles.map((p) => `${p.rootPath}:${p.kind}`);
    expect(kinds).toContain('apps/mobile:react-native');
    expect(kinds).toContain('server:backend');
  });
});

describe('detectProjects — monorepos', () => {
  it('produces one profile per subproject and skips the workspaces aggregator root', () => {
    const profiles = detectProjects([
      { path: 'package.json', content: pkg({}, { workspaces: ['apps/*', 'packages/*'] }) },
      { path: 'apps/web/package.json', content: pkg({ react: '18.2.0', 'react-dom': '18.2.0' }) },
      { path: 'apps/api/package.json', content: pkg({ '@nestjs/core': '^10.0.0' }) },
      { path: 'packages/shared/package.json', content: pkg({ zod: '^3.22.0' }) },
    ]);
    expect(profiles).toHaveLength(3);
    const byRoot = new Map(profiles.map((p) => [p.rootPath, p]));
    expect(byRoot.get('apps/web')?.kind).toBe('web');
    expect(byRoot.get('apps/web')?.direction).toBe('consumes');
    expect(byRoot.get('apps/api')?.kind).toBe('backend');
    expect(byRoot.get('apps/api')?.direction).toBe('serves');
    expect(byRoot.get('packages/shared')?.kind).toBe('library');
  });

  it('detects mixed-language sibling projects (android/ client + server/ backend)', () => {
    const profiles = detectProjects([
      { path: 'android/settings.gradle', content: "include ':app'" },
      { path: 'android/app/build.gradle', content: "apply plugin: 'com.android.application'\nimplementation 'com.squareup.retrofit2:retrofit'" },
      { path: 'android/app/src/main/AndroidManifest.xml' },
      { path: 'server/build.gradle', content: "plugins { id 'org.springframework.boot' }" },
    ]);
    expect(profiles).toHaveLength(2);
    const byRoot = new Map(profiles.map((p) => [p.rootPath, p]));
    expect(byRoot.get('android')?.kind).toBe('mobile-android');
    expect(byRoot.get('server')?.kind).toBe('backend');
  });

  it('assigns spec files to the deepest enclosing project and shares orphans', () => {
    const profiles = detectProjects([
      { path: 'apps/web/package.json', content: pkg({ react: '18.2.0' }) },
      { path: 'server/package.json', content: pkg({ express: '^4.19.0' }) },
      { path: 'server/openapi.yaml' },
      { path: 'docs/swagger.json' },
    ]);
    const byRoot = new Map(profiles.map((p) => [p.rootPath, p]));
    expect(byRoot.get('server')?.specFiles).toContain('server/openapi.yaml');
    expect(byRoot.get('apps/web')?.specFiles).not.toContain('server/openapi.yaml');
    // docs/swagger.json is outside both roots — shared with every project
    expect(byRoot.get('server')?.specFiles).toContain('docs/swagger.json');
    expect(byRoot.get('apps/web')?.specFiles).toContain('docs/swagger.json');
  });
});

describe('detectProjects — fallbacks and hygiene', () => {
  it('returns a single low-confidence unknown profile when nothing is recognizable', () => {
    const profiles = detectProjects([{ path: 'main.c' }, { path: 'README.md' }]);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      rootPath: '',
      kind: 'unknown',
      direction: 'consumes',
      confidence: 'low',
    });
  });

  it('returns an empty list for an empty workspace', () => {
    expect(detectProjects([])).toEqual([]);
  });

  it('attaches spec files to the unknown fallback profile', () => {
    const profiles = detectProjects([{ path: 'docs/openapi.yaml' }, { path: 'notes.txt' }]);
    expect(profiles[0].kind).toBe('unknown');
    expect(profiles[0].specFiles).toEqual(['docs/openapi.yaml']);
  });

  it('ignores manifests inside excluded directories', () => {
    const profiles = detectProjects([
      { path: 'node_modules/express/package.json', content: pkg({}) },
      { path: 'app/build/intermediates/AndroidManifest.xml' },
      { path: 'main.c' },
    ]);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].kind).toBe('unknown');
  });

  it('treats an unreadable package.json as unknown, not a crash', () => {
    const profiles = detectProjects([{ path: 'package.json', content: '{not json' }]);
    expect(profiles[0].kind).toBe('unknown');
    expect(profiles[0].confidence).toBe('low');
  });
});

describe('findSpecFiles', () => {
  it('finds openapi, swagger, proto, graphql, and postman files', () => {
    const specs = findSpecFiles([
      'docs/openapi.yaml',
      'swagger.json',
      'api/openapi-v2.yml',
      'proto/user.proto',
      'schema.graphql',
      'schema.gql',
      'collections/orders.postman_collection.json',
      'src/index.ts',
      'package.json',
      'tsconfig.json',
    ]);
    expect(specs).toEqual([
      'docs/openapi.yaml',
      'swagger.json',
      'api/openapi-v2.yml',
      'proto/user.proto',
      'schema.graphql',
      'schema.gql',
      'collections/orders.postman_collection.json',
    ]);
  });

  it('finds json/yaml files inside openapi/swagger directories', () => {
    expect(findSpecFiles(['openapi/petstore.yaml', 'docs/swagger/api.json'])).toEqual([
      'openapi/petstore.yaml',
      'docs/swagger/api.json',
    ]);
  });

  it('excludes spec files under node_modules and build output', () => {
    expect(
      findSpecFiles(['node_modules/pkg/openapi.json', 'dist/swagger.json', 'build/api.proto'])
    ).toEqual([]);
  });
});

describe('describeProfiles', () => {
  it('renders a compact inventory line with frameworks, roots, direction, and specs', () => {
    const files: ProfileInputFile[] = [
      { path: 'android/settings.gradle', content: "include ':app'" },
      {
        path: 'android/app/build.gradle',
        content: "apply plugin: 'com.android.application'\nimplementation 'com.squareup.retrofit2:retrofit'",
      },
      { path: 'android/app/src/main/AndroidManifest.xml' },
      { path: 'server/build.gradle', content: "plugins { id 'org.springframework.boot' }" },
      { path: 'docs/openapi.yaml' },
    ];
    const text = describeProfiles(detectProjects(files));
    expect(text).toContain('Detected: ');
    expect(text).toContain('Android app (Retrofit) at android/ [consumes]');
    expect(text).toContain('Spring Boot backend at server/ [serves]');
    expect(text).toContain('openapi.yaml found at docs/openapi.yaml');
  });

  it('handles the empty case', () => {
    expect(describeProfiles([])).toBe('Detected: no recognizable projects.');
  });

  it('labels an unknown fallback without frameworks', () => {
    const text = describeProfiles(detectProjects([{ path: 'main.c' }]));
    expect(text).toContain('Unrecognized project at workspace root [consumes]');
  });
});
