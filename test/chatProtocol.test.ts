import { describe, it, expect } from 'vitest';
import {
  CHAT_CONFIRM_BODY_PREVIEW_MAX_CHARS,
  CHAT_CONFIRM_DETAIL_MAX_CHARS,
  CHAT_CONFIRM_DIFF_ROWS_MAX,
  CHAT_CONFIRM_DISCLOSURES_MAX,
  CHAT_CONFIRM_KINDS,
  CHAT_CONFIRM_LINE_MAX_CHARS,
  CHAT_CONFIRM_NAME_MAX_CHARS,
  CHAT_CONFIRM_ROUTES_MAX,
  CHAT_CONFIRM_TITLE_MAX_CHARS,
  CHAT_ID_MAX_CHARS,
  CHAT_INPUT_MAX_CHARS,
  CHAT_LINK_MAX_CHARS,
  CHAT_PREFILL_MAX_CHARS,
  CHAT_PROGRESS_MAX_LINES,
  CHAT_SESSION_DEFAULT_TITLE,
  CHAT_SESSION_TITLE_MAX_CHARS,
  CHAT_TRANSCRIPT_MAX_MESSAGES,
  buildChatPrefillMessage,
  parseChatMessageToExtension,
  sanitizeConfirmAction,
  sanitizeConfirmChange,
  toChatAction,
} from '../src/ai/chat/chatProtocol';
import { SERVER_AGENT_PROMPT_MAX_CHARS } from '../src/ai/agent/serverAgent';
import type {
  ConfirmChange,
  ExecutedAction,
  RouteChangeSnapshot,
} from '../src/ai/agent/serverTools';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('chat protocol constants', () => {
  it('keeps the input cap in lockstep with the agent prompt cap', () => {
    expect(CHAT_INPUT_MAX_CHARS).toBe(SERVER_AGENT_PROMPT_MAX_CHARS);
    expect(CHAT_INPUT_MAX_CHARS).toBe(4_000);
  });

  it('exposes the documented cap values', () => {
    expect(CHAT_PROGRESS_MAX_LINES).toBe(100);
    expect(CHAT_TRANSCRIPT_MAX_MESSAGES).toBe(200);
    expect(CHAT_CONFIRM_TITLE_MAX_CHARS).toBe(120);
    expect(CHAT_CONFIRM_DETAIL_MAX_CHARS).toBe(4_000);
    expect(CHAT_ID_MAX_CHARS).toBe(200);
  });

  it('keeps the prefill cap in lockstep with the input cap', () => {
    expect(CHAT_PREFILL_MAX_CHARS).toBe(CHAT_INPUT_MAX_CHARS);
    expect(CHAT_PREFILL_MAX_CHARS).toBe(4_000);
  });

  it('exposes the session/link constants', () => {
    expect(CHAT_SESSION_TITLE_MAX_CHARS).toBe(48);
    expect(CHAT_SESSION_DEFAULT_TITLE).toBe('New chat');
    expect(CHAT_LINK_MAX_CHARS).toBe(2_048);
  });
});

// ---------------------------------------------------------------------------
// buildChatPrefillMessage
// ---------------------------------------------------------------------------

describe('buildChatPrefillMessage', () => {
  it('builds a chatPrefill message with trimmed text', () => {
    expect(buildChatPrefillMessage('  fix the mocks  ')).toEqual({
      type: 'chatPrefill',
      text: 'fix the mocks',
    });
  });

  it('preserves interior newlines while trimming the edges', () => {
    expect(buildChatPrefillMessage('\n line one\nline two \n')).toEqual({
      type: 'chatPrefill',
      text: 'line one\nline two',
    });
  });

  it('slices to CHAT_PREFILL_MAX_CHARS after trimming', () => {
    const message = buildChatPrefillMessage(` ${'x'.repeat(CHAT_PREFILL_MAX_CHARS + 500)} `);
    expect(message).toEqual({ type: 'chatPrefill', text: 'x'.repeat(CHAT_PREFILL_MAX_CHARS) });
  });

  it('passes empty and whitespace-only input through as empty text', () => {
    expect(buildChatPrefillMessage('')).toEqual({ type: 'chatPrefill', text: '' });
    expect(buildChatPrefillMessage('   \n\t ')).toEqual({ type: 'chatPrefill', text: '' });
  });
});

// ---------------------------------------------------------------------------
// parseChatMessageToExtension — rejections
// ---------------------------------------------------------------------------

describe('parseChatMessageToExtension rejections', () => {
  it('rejects non-objects', () => {
    expect(parseChatMessageToExtension(null)).toBeUndefined();
    expect(parseChatMessageToExtension(undefined)).toBeUndefined();
    expect(parseChatMessageToExtension(42)).toBeUndefined();
    expect(parseChatMessageToExtension('chatSend')).toBeUndefined();
    expect(parseChatMessageToExtension(true)).toBeUndefined();
    expect(parseChatMessageToExtension([{ type: 'chatSync' }])).toBeUndefined();
  });

  it('rejects unknown or missing types', () => {
    expect(parseChatMessageToExtension({})).toBeUndefined();
    expect(parseChatMessageToExtension({ type: 'evil' })).toBeUndefined();
    expect(parseChatMessageToExtension({ type: 'chat' })).toBeUndefined();
    expect(parseChatMessageToExtension({ type: 'chatSendX' })).toBeUndefined();
    expect(parseChatMessageToExtension({ type: 42 })).toBeUndefined();
  });

  it('rejects inbound chatPrefill — the message is outbound-only (round-trip asymmetry)', () => {
    expect(parseChatMessageToExtension({ type: 'chatPrefill' })).toBeUndefined();
    expect(parseChatMessageToExtension({ type: 'chatPrefill', text: 'hi' })).toBeUndefined();
    expect(parseChatMessageToExtension(buildChatPrefillMessage('hi'))).toBeUndefined();
  });

  it('rejects chatSend without usable text', () => {
    expect(parseChatMessageToExtension({ type: 'chatSend' })).toBeUndefined();
    expect(parseChatMessageToExtension({ type: 'chatSend', data: null })).toBeUndefined();
    expect(parseChatMessageToExtension({ type: 'chatSend', data: {} })).toBeUndefined();
    expect(parseChatMessageToExtension({ type: 'chatSend', data: { text: 42 } })).toBeUndefined();
    expect(parseChatMessageToExtension({ type: 'chatSend', data: { text: '' } })).toBeUndefined();
    expect(
      parseChatMessageToExtension({ type: 'chatSend', data: { text: '   \n\t ' } })
    ).toBeUndefined();
  });

  it('rejects malformed chatConfirm payloads', () => {
    expect(parseChatMessageToExtension({ type: 'chatConfirm' })).toBeUndefined();
    expect(parseChatMessageToExtension({ type: 'chatConfirm', data: {} })).toBeUndefined();
    expect(
      parseChatMessageToExtension({ type: 'chatConfirm', data: { approved: true } })
    ).toBeUndefined();
    expect(
      parseChatMessageToExtension({ type: 'chatConfirm', data: { id: '', approved: true } })
    ).toBeUndefined();
    expect(
      parseChatMessageToExtension({ type: 'chatConfirm', data: { id: 42, approved: true } })
    ).toBeUndefined();
    expect(
      parseChatMessageToExtension({ type: 'chatConfirm', data: { id: 'c-1', approved: 'yes' } })
    ).toBeUndefined();
    expect(
      parseChatMessageToExtension({ type: 'chatConfirm', data: { id: 'c-1', approved: 1 } })
    ).toBeUndefined();
  });

  it('rejects chatUndo with empty, non-string, or oversized ids', () => {
    expect(parseChatMessageToExtension({ type: 'chatUndo' })).toBeUndefined();
    expect(parseChatMessageToExtension({ type: 'chatUndo', data: {} })).toBeUndefined();
    expect(parseChatMessageToExtension({ type: 'chatUndo', data: { undoId: '' } })).toBeUndefined();
    expect(parseChatMessageToExtension({ type: 'chatUndo', data: { undoId: 7 } })).toBeUndefined();
    expect(
      parseChatMessageToExtension({
        type: 'chatUndo',
        data: { undoId: 'u'.repeat(CHAT_ID_MAX_CHARS + 1) },
      })
    ).toBeUndefined();
  });

  it('rejects oversized chatConfirm ids', () => {
    expect(
      parseChatMessageToExtension({
        type: 'chatConfirm',
        data: { id: 'c'.repeat(CHAT_ID_MAX_CHARS + 1), approved: false },
      })
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseChatMessageToExtension — acceptance
// ---------------------------------------------------------------------------

describe('parseChatMessageToExtension acceptance', () => {
  it('accepts the payload-free messages and strips extra properties', () => {
    expect(parseChatMessageToExtension({ type: 'chatSync', junk: 1 })).toEqual({
      type: 'chatSync',
    });
    expect(parseChatMessageToExtension({ type: 'chatStop', data: { x: 1 } })).toEqual({
      type: 'chatStop',
    });
    expect(parseChatMessageToExtension({ type: 'chatClear', evil: '<script>' })).toEqual({
      type: 'chatClear',
    });
  });

  it('accepts chatSend, trims, and rebuilds field-by-field', () => {
    const parsed = parseChatMessageToExtension({
      type: 'chatSend',
      data: { text: '  add a route \n', extra: 'dropped' },
      extra: 'dropped',
    });
    expect(parsed).toEqual({ type: 'chatSend', data: { text: 'add a route' } });
  });

  it('slices chatSend text to CHAT_INPUT_MAX_CHARS', () => {
    const parsed = parseChatMessageToExtension({
      type: 'chatSend',
      data: { text: 'x'.repeat(CHAT_INPUT_MAX_CHARS + 500) },
    });
    expect(parsed).toBeDefined();
    if (parsed?.type === 'chatSend') {
      expect(parsed.data.text).toHaveLength(CHAT_INPUT_MAX_CHARS);
    }
  });

  it('accepts chatConfirm with both boolean answers', () => {
    expect(
      parseChatMessageToExtension({ type: 'chatConfirm', data: { id: 'c-1', approved: true } })
    ).toEqual({ type: 'chatConfirm', data: { id: 'c-1', approved: true } });
    expect(
      parseChatMessageToExtension({
        type: 'chatConfirm',
        data: { id: 'c-2', approved: false, junk: 9 },
      })
    ).toEqual({ type: 'chatConfirm', data: { id: 'c-2', approved: false } });
  });

  it('accepts chatUndo with an id at the cap', () => {
    const undoId = 'u'.repeat(CHAT_ID_MAX_CHARS);
    expect(parseChatMessageToExtension({ type: 'chatUndo', data: { undoId } })).toEqual({
      type: 'chatUndo',
      data: { undoId },
    });
  });

  it('accepts bare chatNewSession / chatRegenerate with ONLY the type field', () => {
    expect(parseChatMessageToExtension({ type: 'chatNewSession', junk: 1 })).toEqual({
      type: 'chatNewSession',
    });
    expect(parseChatMessageToExtension({ type: 'chatRegenerate', data: { x: 1 } })).toEqual({
      type: 'chatRegenerate',
    });
  });

  it('accepts chatSwitchSession / chatDeleteSession with a valid id and rejects bad ones', () => {
    expect(parseChatMessageToExtension({ type: 'chatSwitchSession', data: { id: 's-1' } })).toEqual({
      type: 'chatSwitchSession',
      data: { id: 's-1' },
    });
    expect(parseChatMessageToExtension({ type: 'chatDeleteSession', data: { id: 's-2', x: 1 } })).toEqual(
      { type: 'chatDeleteSession', data: { id: 's-2' } }
    );
    expect(parseChatMessageToExtension({ type: 'chatSwitchSession' })).toBeUndefined();
    expect(parseChatMessageToExtension({ type: 'chatSwitchSession', data: {} })).toBeUndefined();
    expect(parseChatMessageToExtension({ type: 'chatSwitchSession', data: { id: '' } })).toBeUndefined();
    expect(parseChatMessageToExtension({ type: 'chatSwitchSession', data: { id: 42 } })).toBeUndefined();
    expect(
      parseChatMessageToExtension({
        type: 'chatSwitchSession',
        data: { id: 's'.repeat(CHAT_ID_MAX_CHARS + 1) },
      })
    ).toBeUndefined();
    expect(parseChatMessageToExtension({ type: 'chatDeleteSession' })).toBeUndefined();
    expect(parseChatMessageToExtension({ type: 'chatDeleteSession', data: { id: '' } })).toBeUndefined();
  });

  it('accepts chatRenameSession, clamps the title to one 48-char line', () => {
    expect(
      parseChatMessageToExtension({ type: 'chatRenameSession', data: { id: 's-1', title: ' My chat ' } })
    ).toEqual({ type: 'chatRenameSession', data: { id: 's-1', title: 'My chat' } });

    const long = parseChatMessageToExtension({
      type: 'chatRenameSession',
      data: { id: 's-1', title: 't'.repeat(CHAT_SESSION_TITLE_MAX_CHARS + 20) },
    });
    expect(long).toEqual({
      type: 'chatRenameSession',
      data: { id: 's-1', title: `${'t'.repeat(CHAT_SESSION_TITLE_MAX_CHARS)}…` },
    });

    const multiline = parseChatMessageToExtension({
      type: 'chatRenameSession',
      data: { id: 's-1', title: 'line one\nline two' },
    });
    expect(multiline).toEqual({
      type: 'chatRenameSession',
      data: { id: 's-1', title: 'line one line two' },
    });
  });

  it('rejects chatRenameSession with empty/whitespace titles, bad ids, or non-string titles', () => {
    expect(parseChatMessageToExtension({ type: 'chatRenameSession' })).toBeUndefined();
    expect(
      parseChatMessageToExtension({ type: 'chatRenameSession', data: { id: 's-1' } })
    ).toBeUndefined();
    expect(
      parseChatMessageToExtension({ type: 'chatRenameSession', data: { id: 's-1', title: '' } })
    ).toBeUndefined();
    expect(
      parseChatMessageToExtension({ type: 'chatRenameSession', data: { id: 's-1', title: ' \n\t ' } })
    ).toBeUndefined();
    expect(
      parseChatMessageToExtension({ type: 'chatRenameSession', data: { id: 's-1', title: 42 } })
    ).toBeUndefined();
    expect(
      parseChatMessageToExtension({
        type: 'chatRenameSession',
        data: { id: 'i'.repeat(CHAT_ID_MAX_CHARS + 1), title: 'ok' },
      })
    ).toBeUndefined();
  });

  it('accepts chatOpenLink for http/https only', () => {
    expect(parseChatMessageToExtension({ type: 'chatOpenLink', data: { url: 'http://a.b' } })).toEqual({
      type: 'chatOpenLink',
      data: { url: 'http://a.b' },
    });
    expect(
      parseChatMessageToExtension({ type: 'chatOpenLink', data: { url: ' HTTPS://x.y/z?q=1 ' } })
    ).toEqual({ type: 'chatOpenLink', data: { url: 'HTTPS://x.y/z?q=1' } });
  });

  it('rejects chatOpenLink for non-http(s) schemes, oversized, and non-string URLs', () => {
    expect(parseChatMessageToExtension({ type: 'chatOpenLink' })).toBeUndefined();
    expect(parseChatMessageToExtension({ type: 'chatOpenLink', data: {} })).toBeUndefined();
    expect(
      parseChatMessageToExtension({ type: 'chatOpenLink', data: { url: 'javascript:alert(1)' } })
    ).toBeUndefined();
    expect(
      parseChatMessageToExtension({ type: 'chatOpenLink', data: { url: 'data:text/html,x' } })
    ).toBeUndefined();
    expect(
      parseChatMessageToExtension({ type: 'chatOpenLink', data: { url: 'ftp://x' } })
    ).toBeUndefined();
    expect(parseChatMessageToExtension({ type: 'chatOpenLink', data: { url: '//x' } })).toBeUndefined();
    expect(parseChatMessageToExtension({ type: 'chatOpenLink', data: { url: '' } })).toBeUndefined();
    expect(parseChatMessageToExtension({ type: 'chatOpenLink', data: { url: 42 } })).toBeUndefined();
    expect(
      parseChatMessageToExtension({
        type: 'chatOpenLink',
        data: { url: `https://x.y/${'a'.repeat(CHAT_LINK_MAX_CHARS)}` },
      })
    ).toBeUndefined();
  });

  it('never returns the raw object (prototype-pollution style extras are gone)', () => {
    const raw = { type: 'chatSend', data: { text: 'hello' }, __proto__: { evil: true } };
    const parsed = parseChatMessageToExtension(raw);
    expect(parsed).not.toBe(raw);
    expect(Object.keys(parsed!)).toEqual(['type', 'data']);
    if (parsed?.type === 'chatSend') {
      expect(Object.keys(parsed.data)).toEqual(['text']);
    }
  });
});

// ---------------------------------------------------------------------------
// toChatAction
// ---------------------------------------------------------------------------

describe('toChatAction', () => {
  it('picks kind/summary/serverName and drops serverId/routeIds', () => {
    const action: ExecutedAction = {
      kind: 'add_route',
      serverId: 'srv-1',
      serverName: 'Payments',
      summary: 'Added 1 route(s): GET /api/pay',
      routeIds: ['route-1'],
    };
    const chat = toChatAction(action);
    expect(chat).toEqual({
      kind: 'add_route',
      summary: 'Added 1 route(s): GET /api/pay',
      serverName: 'Payments',
    });
    expect(Object.keys(chat)).toEqual(['kind', 'summary', 'serverName']);
    expect(chat).not.toHaveProperty('serverId');
    expect(chat).not.toHaveProperty('routeIds');
  });
});

// ---------------------------------------------------------------------------
// sanitizeConfirmAction
// ---------------------------------------------------------------------------

describe('sanitizeConfirmAction', () => {
  it('leaves short titles and details untouched', () => {
    expect(sanitizeConfirmAction({ title: 'Create server "Pay"', detail: 'GET /pay → 200' })).toEqual(
      { title: 'Create server "Pay"', detail: 'GET /pay → 200' }
    );
  });

  it('clamps the title to one bounded line', () => {
    const { title } = sanitizeConfirmAction({
      title: `  ${'a'.repeat(200)}\nsecond line  `,
      detail: 'd',
    });
    expect(title).not.toContain('\n');
    expect(title).toBe(`${'a'.repeat(CHAT_CONFIRM_TITLE_MAX_CHARS)}…`);
  });

  it('keeps newlines in the detail and slices with a trailing ellipsis when cut', () => {
    const kept = sanitizeConfirmAction({ title: 't', detail: 'line1\nline2' });
    expect(kept.detail).toBe('line1\nline2');

    const long = 'd'.repeat(CHAT_CONFIRM_DETAIL_MAX_CHARS + 100);
    const cut = sanitizeConfirmAction({ title: 't', detail: long });
    expect(cut.detail).toBe(`${'d'.repeat(CHAT_CONFIRM_DETAIL_MAX_CHARS)}…`);
  });

  it('omits the change key entirely when the action has none', () => {
    const result = sanitizeConfirmAction({ title: 't', detail: 'd' });
    expect('change' in result).toBe(false);
  });

  it('passes a sanitized change through when the action carries one', () => {
    const result = sanitizeConfirmAction({
      title: 't',
      detail: 'd',
      change: { kind: 'start_server', serverName: 'Payments', port: 4100 },
    });
    expect(result.change).toEqual({ kind: 'start_server', serverName: 'Payments', port: 4100 });
  });
});

// ---------------------------------------------------------------------------
// sanitizeConfirmChange
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<RouteChangeSnapshot> = {}): RouteChangeSnapshot {
  return {
    method: 'GET',
    path: '/api/users',
    statusCode: 200,
    name: 'List users',
    enabled: true,
    responseType: 'static',
    headersCount: 1,
    bodyPreview: '[{"id":1}]',
    disclosures: [],
    ...overrides,
  };
}

describe('sanitizeConfirmChange', () => {
  it('exposes the documented cap values and kinds', () => {
    expect(CHAT_CONFIRM_NAME_MAX_CHARS).toBe(60);
    expect(CHAT_CONFIRM_ROUTES_MAX).toBe(20);
    expect(CHAT_CONFIRM_DIFF_ROWS_MAX).toBe(12);
    expect(CHAT_CONFIRM_LINE_MAX_CHARS).toBe(200);
    expect(CHAT_CONFIRM_BODY_PREVIEW_MAX_CHARS).toBe(400);
    expect(CHAT_CONFIRM_DISCLOSURES_MAX).toBe(8);
    expect(CHAT_CONFIRM_KINDS).toEqual([
      'create_server',
      'add_route',
      'update_route',
      'delete_route',
      'start_server',
      'stop_server',
    ]);
  });

  it('round-trips a well-formed update_route change unchanged', () => {
    const change: ConfirmChange = {
      kind: 'update_route',
      serverName: 'Payments API',
      before: makeSnapshot(),
      after: makeSnapshot({ path: '/api/members' }),
      fieldDiffs: [{ field: 'path', before: '"/api/users"', after: '"/api/members"' }],
    };
    expect(sanitizeConfirmChange(change)).toEqual(change);
  });

  it('round-trips a well-formed add_route change unchanged', () => {
    const change: ConfirmChange = {
      kind: 'add_route',
      serverName: 'Payments API',
      routes: [
        makeSnapshot(),
        makeSnapshot({
          method: 'POST',
          path: '/api/data',
          responseType: 'proxy',
          disclosures: ['PROXIES live requests to http://x.example/'],
        }),
      ],
    };
    expect(sanitizeConfirmChange(change)).toEqual(change);
  });

  it('re-clamps oversized strings and slices oversized arrays', () => {
    const change: ConfirmChange = {
      kind: 'update_route',
      serverName: 'n'.repeat(200),
      routes: Array.from({ length: 25 }, () =>
        makeSnapshot({
          path: `/${'p'.repeat(500)}`,
          disclosures: Array.from({ length: 12 }, () => 'x'.repeat(500)),
          bodyPreview: 'b'.repeat(CHAT_CONFIRM_BODY_PREVIEW_MAX_CHARS + 50),
        })
      ),
      fieldDiffs: Array.from({ length: 20 }, () => ({
        field: 'f'.repeat(100),
        before: 'v'.repeat(200),
        after: 'w'.repeat(200),
      })),
    };
    const sanitized = sanitizeConfirmChange(change)!;
    expect(sanitized.serverName).toBe(`${'n'.repeat(CHAT_CONFIRM_NAME_MAX_CHARS)}…`);
    expect(sanitized.routes).toHaveLength(CHAT_CONFIRM_ROUTES_MAX);
    const snap = sanitized.routes![0];
    expect(snap.path).toBe(`/${'p'.repeat(CHAT_CONFIRM_LINE_MAX_CHARS - 1)}…`);
    expect(snap.path.length).toBe(CHAT_CONFIRM_LINE_MAX_CHARS + 1);
    expect(snap.disclosures).toHaveLength(CHAT_CONFIRM_DISCLOSURES_MAX);
    expect(snap.disclosures[0]).toBe(`${'x'.repeat(CHAT_CONFIRM_LINE_MAX_CHARS)}…`);
    expect(snap.bodyPreview).toBe(`${'b'.repeat(CHAT_CONFIRM_BODY_PREVIEW_MAX_CHARS)}…`);
    expect(sanitized.fieldDiffs).toHaveLength(CHAT_CONFIRM_DIFF_ROWS_MAX);
    expect(sanitized.fieldDiffs![0].field).toBe(`${'f'.repeat(40)}…`);
    expect(sanitized.fieldDiffs![0].before).toBe(`${'v'.repeat(80)}…`);
    expect(sanitized.fieldDiffs![0].after).toBe(`${'w'.repeat(80)}…`);
  });

  it('clamps ports into the valid range and drops non-string protocols', () => {
    const sanitized = sanitizeConfirmChange({
      kind: 'create_server',
      serverName: 'S',
      port: 999_999,
      protocol: 'http',
    });
    expect(sanitized).toEqual({ kind: 'create_server', serverName: 'S', port: 65535, protocol: 'http' });
  });

  it('returns undefined for an unknown kind', () => {
    expect(
      sanitizeConfirmChange({ kind: 'drop_table' as never, serverName: 'S' })
    ).toBeUndefined();
  });
});
