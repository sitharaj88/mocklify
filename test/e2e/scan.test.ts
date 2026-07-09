import * as assert from 'node:assert';
import { ScanOrchestrator } from '../../src/ai/ScanOrchestrator.js';
import {
  CodebaseMockGenerator,
  CENSUS_NO_ROUTES_MESSAGE,
} from '../../src/ai/CodebaseMockGenerator.js';
import type { WorkspaceRecon } from '../../src/ai/CodebaseMockGenerator.js';
import { FakeAiProvider } from '../../src/testing/FakeAiProvider.js';
import type { AiToolCall } from '../../src/ai/providers/types.js';
import { fakeAiService, SCAN_ROUTES_RESPONSE } from './helpers.js';

// Fully offline: a FakeAiProvider replaces every real provider, so no network,
// no API key, and no Copilot. supportsToolLoop is false in the scan cases so
// the orchestrator stays on the deterministic fast path.
suite('Codebase scan (FakeAiProvider, offline)', () => {
  test('fast scan of the fixture workspace yields routes', async function () {
    this.timeout(20000);
    const fake = new FakeAiProvider({
      supportsToolLoop: false,
      streamResponses: [{ response: SCAN_ROUTES_RESPONSE }],
      defaultResponse: SCAN_ROUTES_RESPONSE,
    });
    const ai = fakeAiService(fake);

    const summary = await new ScanOrchestrator(ai).generate({ scanMode: 'fast' });

    assert.ok(
      summary.routes.length > 0,
      `fast scan should produce routes; got ${summary.routes.length}`
    );
    assert.ok(
      fake.calls.some((c) => c.kind === 'stream'),
      'the fake provider should have been asked to generate routes'
    );
  });

  test('empty surface yields the no-API-surface message, not an error', async function () {
    this.timeout(20000);
    const fake = new FakeAiProvider({
      supportsToolLoop: false,
      defaultResponse: JSON.stringify({ routes: [] }),
    });
    const ai = fakeAiService(fake);
    const emptyRecon: WorkspaceRecon = {
      appName: 'empty',
      profiles: [],
      files: [],
      scannedFileCount: 0,
    };

    // A fast/census scan over an empty surface throws the *informational*
    // CENSUS_NO_ROUTES_MESSAGE. The command layer maps exactly this to
    // showInformationMessage (never showErrorMessage) — the "no API surface,
    // not an error toast" contract.
    await assert.rejects(
      new CodebaseMockGenerator(ai).generate({ recon: emptyRecon }),
      (err: Error) => err.message === CENSUS_NO_ROUTES_MESSAGE
    );
  });

  test('agentic tool loop drives submit_routes with no network', async () => {
    const submitted: AiToolCall[] = [];
    const fake = new FakeAiProvider({
      toolLoops: [
        {
          toolCalls: [{ name: 'submit_routes', input: { routes: [{ path: '/api/x' }] } }],
          final: 'submitted',
        },
      ],
    });

    const final = await fake.runToolLoop!(
      'Explore the codebase and submit routes',
      [{ name: 'submit_routes', description: 'submit', inputSchema: {} }],
      async (call) => {
        submitted.push(call);
        return 'ok';
      }
    );

    assert.strictEqual(final, 'submitted');
    assert.strictEqual(submitted.length, 1);
    assert.strictEqual(submitted[0].name, 'submit_routes');
    assert.ok(fake.calls.some((c) => c.kind === 'toolLoop'));
  });
});
