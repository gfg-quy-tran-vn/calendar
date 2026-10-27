import { describe, expect, it } from 'vitest';
import { classifyGoogleError } from '@/lib/errors';

const gaxiosError = (status: number, error?: unknown) =>
  Object.assign(new Error('boom'), { response: { status, data: { error } } });

describe('classifyGoogleError', () => {
  it.each([
    [gaxiosError(400, 'invalid_grant'), 'reauth'],
    [gaxiosError(401), 'reauth'],
    [gaxiosError(412), 'conflict'],
    [gaxiosError(404), 'not_found'],
    [gaxiosError(410), 'not_found'],
    [gaxiosError(500), 'other'],
    [new Error('network down'), 'other'],
  ])('%#', (err, kind) => {
    expect(classifyGoogleError(err)).toBe(kind);
  });
});
