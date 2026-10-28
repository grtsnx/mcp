export type SessionErrorKind =
  'not_found' | 'ended' | 'no_household' | 'proposal_invalid';

const messages: Record<SessionErrorKind, string> = {
  // Unknown, idle-dropped and expired ids all look the same on purpose.
  not_found: 'Session not found, sign in again.',
  ended: 'The session has ended. Ask the user to sign in again.',
  no_household: 'No household is linked to this session.',
  // Unknown, used, expired and another session's token all look the same on purpose.
  proposal_invalid:
    'That confirmation is not valid any more. Make a new proposal and ask the parent to confirm it.',
};

// The message is safe to show: it never carries a token, an id or a backend detail.
export class SessionError extends Error {
  constructor(readonly kind: SessionErrorKind) {
    super(messages[kind]);
    this.name = 'SessionError';
  }
}
