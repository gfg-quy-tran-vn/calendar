export type GoogleErrorKind = 'reauth' | 'conflict' | 'not_found' | 'other';

type MaybeGaxiosError = { message?: string; response?: { status?: number; data?: { error?: unknown } } };

export function classifyGoogleError(err: unknown): GoogleErrorKind {
  const e = (err ?? {}) as MaybeGaxiosError;
  const status = e.response?.status;
  const tokenError = e.response?.data?.error;
  if (tokenError === 'invalid_grant' || status === 401) return 'reauth';
  if (status === 412) return 'conflict';
  if (status === 404 || status === 410) return 'not_found';
  return 'other';
}
