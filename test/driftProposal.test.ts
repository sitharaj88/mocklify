import { describe, it, expect } from 'vitest';
import {
  CHAT_PREFILL_MAX_CHARS,
  DRIFT_FINGERPRINT_MAX_CHARS,
  DRIFT_NOTIFY_MAX_LISTED,
  DRIFT_PROMPT_MAX_ENDPOINTS,
  buildDriftProposal,
  driftFingerprint,
  type DriftReport,
  type DriftServerInfo,
} from '../src/ai/proactive/driftProposal';
import { CHAT_INPUT_MAX_CHARS } from '../src/ai/chat/chatProtocol';

function report(missingEndpoints: string[]): DriftReport {
  return {
    relativePath: 'src/api/client.ts',
    fileName: 'client.ts',
    missingEndpoints,
    detectedAt: 1_700_000_000_000,
  };
}

describe('driftFingerprint', () => {
  it('is order-insensitive and deduped over the endpoint set', () => {
    expect(driftFingerprint(['/b', '/a'])).toBe(driftFingerprint(['/a', '/b']));
    expect(driftFingerprint(['/a', '/a', '/b'])).toBe(driftFingerprint(['/a', '/b']));
    expect(driftFingerprint(['/a', '/b'])).toBe('drift:/a|/b');
  });

  it('is set-sensitive', () => {
    expect(driftFingerprint(['/a'])).not.toBe(driftFingerprint(['/a', '/b']));
    expect(driftFingerprint(['/a'])).not.toBe(driftFingerprint(['/c']));
  });

  it('is sliced to DRIFT_FINGERPRINT_MAX_CHARS', () => {
    const many = Array.from({ length: 100 }, (_, i) => `/very/long/endpoint/path/${i}`);
    expect(driftFingerprint(many).length).toBe(DRIFT_FINGERPRINT_MAX_CHARS);
  });
});

describe('buildDriftProposal', () => {
  it('returns undefined for an empty endpoint set', () => {
    expect(buildDriftProposal(report([]), [])).toBeUndefined();
  });

  it('lists at most 3 endpoints in the notification with an overflow count', () => {
    const p = buildDriftProposal(report(['/d', '/a', '/c', '/b', '/e']), []);
    expect(p).toBeDefined();
    expect(p!.notificationText).toBe(
      "Mocklify: 5 API call(s) in client.ts aren't covered by your mocks: /a, /b, /c and 2 more"
    );
  });

  it('omits the overflow suffix at or under the listing cap', () => {
    const p = buildDriftProposal(report(['/a', '/b']), []);
    expect(p!.notificationText).toContain(': /a, /b');
    expect(p!.notificationText).not.toContain('more');
  });

  it('caps the prompt endpoint list at DRIFT_PROMPT_MAX_ENDPOINTS with an overflow line', () => {
    const endpoints = Array.from({ length: 15 }, (_, i) =>
      `/api/e${String(i).padStart(2, '0')}`
    );
    const p = buildDriftProposal(report(endpoints), []);
    const bulletLines = p!.chatPrompt.split('\n').filter((l) => l.startsWith('- '));
    expect(bulletLines.length).toBe(DRIFT_PROMPT_MAX_ENDPOINTS + 1);
    expect(bulletLines[bulletLines.length - 1]).toBe('- …and 3 more');
    expect(p!.missingEndpoints.length).toBe(DRIFT_PROMPT_MAX_ENDPOINTS);
  });

  it('keeps the chat prompt within CHAT_PREFILL_MAX_CHARS', () => {
    expect(CHAT_PREFILL_MAX_CHARS).toBe(CHAT_INPUT_MAX_CHARS);
    const endpoints = Array.from(
      { length: 12 },
      (_, i) => `/${'x'.repeat(400)}/${i}`
    );
    const p = buildDriftProposal(report(endpoints), []);
    expect(p!.chatPrompt.length).toBeLessThanOrEqual(CHAT_PREFILL_MAX_CHARS);
  });

  it('includes the file path, count, and the endpoint lines in the prompt', () => {
    const p = buildDriftProposal(report(['/api/users']), []);
    expect(p!.chatPrompt).toContain(
      'My code changed and the mocks may be out of date. src/api/client.ts now calls 1 endpoint(s) that no mock route covers:'
    );
    expect(p!.chatPrompt).toContain('- /api/users');
  });

  it('suggests the server with the best first-segment overlap (first wins ties)', () => {
    const servers: DriftServerInfo[] = [
      { name: 'Billing', routePaths: ['/billing/invoices'] },
      { name: 'Users API', routePaths: ['/api/users', '/api/orders'] },
    ];
    const p = buildDriftProposal(report(['/api/users/1', '/api/things']), servers);
    expect(p!.suggestedServerName).toBe('Users API');
    expect(p!.chatPrompt).toContain(
      'Please add mock routes for these to the "Users API" server (or another server if it fits better), with realistic success responses and sensible error cases.'
    );
  });

  it('matches first segments case-insensitively and ties go to the first server', () => {
    const servers: DriftServerInfo[] = [
      { name: 'First', routePaths: ['/API/x'] },
      { name: 'Second', routePaths: ['/api/y'] },
    ];
    const p = buildDriftProposal(report(['/api/users']), servers);
    expect(p!.suggestedServerName).toBe('First');
  });

  it('omits suggestedServerName (spread-omitted) with no servers or no overlap', () => {
    const none = buildDriftProposal(report(['/api/users']), []);
    expect('suggestedServerName' in none!).toBe(false);
    const noOverlap = buildDriftProposal(report(['/api/users']), [
      { name: 'Other', routePaths: ['/billing/x'] },
    ]);
    expect('suggestedServerName' in noOverlap!).toBe(false);
    expect(noOverlap!.chatPrompt).toContain(
      'Please create or extend a mock server with routes for these, with realistic success responses and sensible error cases.'
    );
  });

  it('exposes the notification listing cap', () => {
    expect(DRIFT_NOTIFY_MAX_LISTED).toBe(3);
  });

  it('endpointKeys covers the FULL sorted set (one clamped key per endpoint), beyond the display cap', () => {
    const endpoints = Array.from({ length: 12 }, (_, i) => `GET /api/e${String(i).padStart(2, '0')}`);
    const proposal = buildDriftProposal(
      { fileName: 'api.ts', relativePath: 'src/api.ts', missingEndpoints: [...endpoints, endpoints[0]] },
      []
    );
    expect(proposal!.endpointKeys).toHaveLength(12); // deduped, NOT capped at the display limit
    expect(proposal!.endpointKeys[0]).toBe('drift:GET /api/e00');
    expect(new Set(proposal!.endpointKeys).size).toBe(12);
    const long = buildDriftProposal(
      { fileName: 'a.ts', relativePath: 'a.ts', missingEndpoints: [`GET /${'x'.repeat(400)}`] },
      []
    );
    expect(long!.endpointKeys[0].length).toBeLessThanOrEqual(200);
  });
});
