import { describe, it, expect } from 'vitest';
import { isSchemaRejection } from '../src/ai/providers/types';

describe('isSchemaRejection', () => {
  it('matches a 400 whose message names a structured-output field', () => {
    expect(
      isSchemaRejection(400, 'Unknown parameter: response_format', ['response_format'])
    ).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(
      isSchemaRejection(400, 'Invalid value for OUTPUT_CONFIG.format', ['output_config'])
    ).toBe(true);
  });

  it('checks any of the given fields', () => {
    expect(
      isSchemaRejection(400, 'json_schema is not supported by this model', [
        'response_format',
        'json_schema',
      ])
    ).toBe(true);
  });

  it('rejects non-400 statuses', () => {
    expect(isSchemaRejection(422, 'response_format invalid', ['response_format'])).toBe(false);
    expect(isSchemaRejection(undefined, 'response_format invalid', ['response_format'])).toBe(
      false
    );
  });

  it('rejects a 400 that does not mention any field', () => {
    expect(isSchemaRejection(400, 'API key not valid', ['response_format'])).toBe(false);
  });

  it('rejects a missing message', () => {
    expect(isSchemaRejection(400, undefined, ['response_format'])).toBe(false);
  });
});
