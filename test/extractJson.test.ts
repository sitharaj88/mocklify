import { describe, it, expect } from 'vitest';
import { extractJson } from '../src/ai/extractJson';

describe('extractJson', () => {
  it('parses a bare JSON object', () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it('parses a bare JSON array', () => {
    expect(extractJson('[1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('parses JSON inside a fenced code block', () => {
    const text = 'Here is your API:\n```json\n{"name": "Users API"}\n```\nEnjoy!';
    expect(extractJson(text)).toEqual({ name: 'Users API' });
  });

  it('parses JSON inside an unlabeled fence', () => {
    expect(extractJson('```\n[{"x": true}]\n```')).toEqual([{ x: true }]);
  });

  it('ignores prose before and after the JSON', () => {
    const text = 'Sure! The result is {"ok": true} — let me know if you need more.';
    expect(extractJson(text)).toEqual({ ok: true });
  });

  it('handles nested brackets and braces in strings', () => {
    const text = '{"template": "{ \\"id\\": \\"{{uuid}}\\" }", "path": "/a/[b]"}';
    expect(extractJson(text)).toEqual({
      template: '{ "id": "{{uuid}}" }',
      path: '/a/[b]',
    });
  });

  it('handles escaped quotes inside strings', () => {
    expect(extractJson('{"msg": "she said \\"hi\\""}')).toEqual({ msg: 'she said "hi"' });
  });

  it('throws when no JSON is present', () => {
    expect(() => extractJson('I could not generate anything.')).toThrow(/did not contain JSON/);
  });

  it('throws on unterminated JSON', () => {
    expect(() => extractJson('{"a": 1')).toThrow(/malformed JSON/);
  });
});
