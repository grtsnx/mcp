export type BackendErrorKind =
  | 'invalid_request'
  | 'cannot_reschedule'
  | 'slot_unavailable'
  | 'outside_availability'
  | 'already_pending'
  | 'household_not_found'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'rejected'
  | 'unavailable'
  | 'timeout'
  | 'unreachable'
  | 'unexpected_response';

// Carries only a category, never the backend body, so nothing sensitive can leak through it.
export class BackendError extends Error {
  constructor(readonly kind: BackendErrorKind) {
    super(`Backend request failed: ${kind}`);
    this.name = 'BackendError';
  }
}

export function errorKindForStatus(status: number): BackendErrorKind {
  if (status === 400) return 'invalid_request';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable';
  return 'rejected';
}
