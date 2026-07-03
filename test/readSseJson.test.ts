import { describe, it, expect } from 'vitest';
import { readSseJson } from '../src/ai/providers/types';

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const results: unknown[] = [];
  for await (const item of readSseJson(stream)) {
    results.push(item);
  }
  return results;
}

describe('readSseJson', () => {
  it('parses data lines into JSON payloads', async () => {
    const results = await collect(streamOf('data: {"a":1}\n\ndata: {"b":2}\n\n'));
    expect(results).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('handles a JSON payload split across network chunks', async () => {
    const results = await collect(streamOf('data: {"text":"hel', 'lo world"}\n\n'));
    expect(results).toEqual([{ text: 'hello world' }]);
  });

  it('handles multiple events arriving in one chunk', async () => {
    const results = await collect(
      streamOf('data: {"i":1}\ndata: {"i":2}\ndata: {"i":3}\n')
    );
    expect(results).toEqual([{ i: 1 }, { i: 2 }, { i: 3 }]);
  });

  it('ignores the [DONE] sentinel (OpenAI)', async () => {
    const results = await collect(streamOf('data: {"i":1}\n\ndata: [DONE]\n\n'));
    expect(results).toEqual([{ i: 1 }]);
  });

  it('ignores SSE comments, event names, and blank lines', async () => {
    const results = await collect(
      streamOf(': keep-alive\n\nevent: message\ndata: {"ok":true}\n\n')
    );
    expect(results).toEqual([{ ok: true }]);
  });

  it('handles CRLF line endings', async () => {
    const results = await collect(streamOf('data: {"crlf":true}\r\n\r\n'));
    expect(results).toEqual([{ crlf: true }]);
  });

  it('handles data lines without a space after the colon', async () => {
    const results = await collect(streamOf('data:{"tight":1}\n'));
    expect(results).toEqual([{ tight: 1 }]);
  });

  it('skips malformed JSON payloads without aborting the stream', async () => {
    const results = await collect(
      streamOf('data: {broken\n\ndata: {"fine":1}\n\n')
    );
    expect(results).toEqual([{ fine: 1 }]);
  });

  it('handles multibyte characters split across chunk boundaries', async () => {
    const encoder = new TextEncoder();
    const full = encoder.encode('data: {"emoji":"🎉"}\n\n');
    // Split in the middle of the 4-byte emoji sequence
    const splitAt = full.indexOf(0xf0) + 2;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(full.slice(0, splitAt));
        controller.enqueue(full.slice(splitAt));
        controller.close();
      },
    });
    expect(await collect(stream)).toEqual([{ emoji: '🎉' }]);
  });

  it('yields nothing for an empty stream', async () => {
    expect(await collect(streamOf(''))).toEqual([]);
  });
});
