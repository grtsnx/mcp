import { createHash, randomBytes } from 'node:crypto';
import type { BackendApi } from '@/external/mssuize/backend-client.js';
import {
  BackendError,
  type BackendErrorKind,
} from '@/external/mssuize/backend-error.js';
import {
  fetchCurrentUser,
  logoutOnBackend,
  refreshTokens,
} from '@/external/mssuize/auth-api.js';
import { SessionError } from './session-error.js';
import { SessionStore } from './session-store.js';
import type {
  Proposal,
  ProposalAction,
  ProposalDetails,
  Session,
  SessionProfile,
} from './session.types.js';

// Refresh before the access token is this close to expiring.
const REFRESH_LEEWAY_MS = 60_000;
// A checked access token is trusted this long before ms-backend is asked again.
const VERIFIED_MS = 60_000;
// How long an access token is used when it does not say when it expires.
const DEFAULT_ACCESS_MS = 5 * 60_000;
// At most this many checked tokens are remembered.
const MAX_VERIFIED = 10_000;

// After a write that was sent, these leave it unknown whether it happened: the backend may have
// saved the change before it timed out, the connection broke, or it answered with a 5xx.
const UNKNOWN_OUTCOME_KINDS: ReadonlySet<BackendErrorKind> = new Set([
  'timeout',
  'unreachable',
  'unavailable',
  'unexpected_response',
]);

/** What became of a write that was sent. */
export type WriteOutcome<T> =
  { status: 'done'; value: T } | { status: 'unknown'; error: BackendError };

const PROPOSAL_TTL_MS = 5 * 60_000;
const MAX_PROPOSALS_PER_SESSION = 10;

export interface SessionServiceOptions {
  backend: BackendApi;
  maxSessions: number;
  idleTtlMs: number;
  /** How long ms-backend keeps a refresh token valid; its reply does not say. */
  refreshTtlMs: number;
  now?: () => number;
}

export interface NewSession {
  accessToken: string;
  refreshToken: string;
  /** Seconds, from the backend's reply. */
  expiresIn: number;
  user: SessionProfile;
  householdId?: string | null;
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof BackendError && error.kind === 'unauthorized';
}

async function settled(promise: Promise<unknown>): Promise<boolean> {
  try {
    await promise;
    return true;
  } catch {
    return false;
  }
}

// All token handling lives here: tools get an access token that is valid right now and never see a refresh.
export class SessionService {
  private readonly backend: BackendApi;
  private readonly refreshTtlMs: number;
  private readonly now: () => number;
  private readonly store: SessionStore;
  // Checked access tokens, by hash, and each person's current session.
  private readonly verified = new Map<
    string,
    { sessionId: string; until: number }
  >();
  private readonly byUser = new Map<string, string>();

  constructor(options: SessionServiceOptions) {
    this.backend = options.backend;
    this.refreshTtlMs = options.refreshTtlMs;
    this.now = options.now ?? Date.now;
    this.store = new SessionStore({
      maxSessions: options.maxSessions,
      idleTtlMs: options.idleTtlMs,
      now: this.now,
    });
  }

  //1. A signed-in parent's own access token, sent by any MCP client as its bearer token, becomes
  //   the session for that request. Undefined when ms-backend does not accept the token.
  //2. The token is checked with ms-backend (/auth/me); a check is reused for a minute.
  //3. One session per person: a newer token replaces the older one, and pending proposals stay.
  //4. No refresh token is held. The client keeps its token fresh, as with any MCP server.
  async signIn(accessToken: string): Promise<string | undefined> {
    const now = this.now();
    const key = createHash('sha256').update(accessToken).digest('base64url');
    const checked = this.verified.get(key);
    if (checked && checked.until > now && this.store.get(checked.sessionId))
      return checked.sessionId;
    let user: Awaited<ReturnType<typeof fetchCurrentUser>>;
    try {
      user = await fetchCurrentUser(this.backend, accessToken);
    } catch (error) {
      if (isUnauthorized(error)) return undefined;
      throw error;
    }
    const expiresAt = tokenExpiry(accessToken) ?? now + DEFAULT_ACCESS_MS;
    const tokens = {
      accessToken,
      refreshToken: '',
      accessExpiresAt: expiresAt,
      refreshExpiresAt: now + this.refreshTtlMs,
    };
    const knownId = this.byUser.get(user.id);
    const known = knownId ? this.store.get(knownId) : undefined;
    let sessionId: string;
    if (known && !known.closing) {
      known.tokens = tokens;
      known.generation += 1;
      sessionId = known.id;
    } else {
      sessionId = this.create({
        accessToken,
        refreshToken: '',
        expiresIn: Math.max(0, (expiresAt - now) / 1000),
        user,
        householdId: user.householdId ?? null,
      });
      this.byUser.set(user.id, sessionId);
    }
    if (this.verified.size >= MAX_VERIFIED) this.verified.clear();
    this.verified.set(key, {
      sessionId,
      until: Math.min(now + VERIFIED_MS, expiresAt),
    });
    return sessionId;
  }

  /** Returns an opaque id (256 random bits). It is the only thing that leaves this service. */
  create(input: NewSession): string {
    const now = this.now();
    const id = randomBytes(32).toString('base64url');
    this.store.add({
      id,
      profile: {
        id: input.user.id,
        email: input.user.email,
        role: input.user.role,
        firstName: input.user.firstName,
        lastName: input.user.lastName,
      },
      householdId: input.householdId ?? null,
      tokens: {
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        accessExpiresAt: now + input.expiresIn * 1000,
        refreshExpiresAt: now + this.refreshTtlMs,
      },
      proposals: new Map(),
      generation: 0,
      lastUsedAt: now,
      closing: false,
      activeOperations: 0,
    });
    return id;
  }

  /**
   * Remembers a change for the person to approve and returns an opaque token to confirm it. The
   * token works once, only for this sign-in session, and only for five minutes.
   */
  createProposal(
    sessionId: string,
    change: ProposalDetails,
  ): { confirmationToken: string; expiresInSeconds: number } {
    const session = this.require(sessionId);
    const now = this.now();
    for (const [token, proposal] of session.proposals) {
      if (proposal.expiresAt <= now) session.proposals.delete(token);
    }
    for (const token of session.proposals.keys()) {
      if (session.proposals.size < MAX_PROPOSALS_PER_SESSION) break;
      session.proposals.delete(token);
    }
    const confirmationToken = randomBytes(32).toString('base64url');
    session.proposals.set(confirmationToken, {
      ...change,
      expiresAt: now + PROPOSAL_TTL_MS,
    });
    return { confirmationToken, expiresInSeconds: PROPOSAL_TTL_MS / 1000 };
  }

  /**
   * Uses a confirmation token up. It is removed before this returns, so the caller can never act
   * on the same proposal twice, whatever happens next. A token made for a different action is
   * refused like an unknown one, and is left alone for the action it belongs to.
   */
  takeProposal<A extends ProposalAction>(
    sessionId: string,
    confirmationToken: string,
    action: A,
  ): Extract<Proposal, { action: A }> {
    const session = this.require(sessionId);
    const proposal = session.proposals.get(confirmationToken);
    if (proposal === undefined || proposal.action !== action) {
      throw new SessionError('proposal_invalid');
    }
    session.proposals.delete(confirmationToken);
    if (proposal.expiresAt <= this.now()) {
      throw new SessionError('proposal_invalid');
    }
    return proposal as Extract<Proposal, { action: A }>;
  }

  /** The service's own clock in milliseconds, so a tool and its tests share one notion of now. */
  nowMs(): number {
    return this.now();
  }

  /**
   * Sends a write once. The access token is refreshed first when it is about to expire, and after
   * a 401 (which the backend answers before it runs anything) it is refreshed and the write is sent
   * once more. Nothing else is ever sent again: not after a timeout, a network error, a 5xx or
   * any other reply.
   *
   * A write that was sent and then timed out, broke the connection, answered with a 5xx or could
   * not be read comes back as `unknown`, because the backend may have saved it first. Every
   * other failure, including one while refreshing the token before anything was sent, is thrown.
   */
  async sendWrite<T>(
    sessionId: string,
    send: (accessToken: string) => Promise<T>,
  ): Promise<WriteOutcome<T>> {
    let writeError: unknown;
    try {
      const value = await this.withAccessToken(
        sessionId,
        async (accessToken) => {
          try {
            return await send(accessToken);
          } catch (error) {
            writeError = error;
            throw error;
          }
        },
      );
      return { status: 'done', value };
    } catch (error) {
      if (
        error === writeError &&
        error instanceof BackendError &&
        UNKNOWN_OUTCOME_KINDS.has(error.kind)
      ) {
        return { status: 'unknown', error };
      }
      throw error;
    }
  }

  /**
   * Runs `call` with an access token that is valid now: refreshes first when it is about to
   * expire, and on a 401 refreshes once and retries once.
   */
  async withAccessToken<T>(
    sessionId: string,
    call: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    const session = this.require(sessionId);
    session.activeOperations += 1;

    try {
      if (session.tokens.accessExpiresAt - this.now() < REFRESH_LEEWAY_MS) {
        await this.refresh(session, session.generation);
      }

      const generation = session.generation;
      try {
        return await call(session.tokens.accessToken);
      } catch (error) {
        if (!isUnauthorized(error)) throw error;
      }

      await this.refresh(session, generation);
      try {
        return await call(session.tokens.accessToken);
      } catch (error) {
        if (!isUnauthorized(error)) throw error;
        this.store.delete(session.id);
        throw new SessionError('ended');
      }
    } finally {
      session.activeOperations -= 1;
      if (session.activeOperations === 0) {
        session.operationsDrained?.();
        session.operationsDrained = undefined;
      }
    }
  }

  /**
   * Like withAccessToken, for calls about the signed-in person's own household. The household id
   * comes from the stored session, never from the caller, so a call can only reach that household.
   */
  async withHousehold<T>(
    sessionId: string,
    call: (accessToken: string, householdId: string) => Promise<T>,
  ): Promise<T> {
    const householdId = this.require(sessionId).householdId;
    if (householdId === null) throw new SessionError('no_household');
    return this.withAccessToken(sessionId, (accessToken) =>
      call(accessToken, householdId),
    );
  }

  /**
   * Refuses, as a backend 403 would, unless the signed-in person has one of these roles. Checking
   * the stored role first keeps the answer the same for every role the backend would turn away,
   * including routes the backend itself leaves open to tutors.
   */
  assertRole(sessionId: string, allowed: readonly string[]): void {
    const { profile } = this.require(sessionId);
    if (!allowed.includes(profile.role)) throw new BackendError('forbidden');
  }

  /** Always forgets the session; says whether the backend confirmed the sign-out. */
  async logout(sessionId: string): Promise<{ backendRevoked: boolean }> {
    const session = this.require(sessionId);
    session.closing = true;
    this.store.delete(session.id);
    if (session.activeOperations > 0) {
      await new Promise<void>((resolve) => {
        session.operationsDrained = resolve;
      });
    }
    // A refresh in flight replaces the refresh token, so the sign-out must use the new one.
    if (session.refreshing) await settled(session.refreshing);

    const refreshToken = session.tokens.refreshToken;
    try {
      await logoutOnBackend(this.backend, refreshToken);
      return { backendRevoked: true };
    } catch {
      return { backendRevoked: false };
    }
  }

  private require(sessionId: string): Session {
    const session = this.store.get(sessionId);
    if (session === undefined) throw new SessionError('not_found');
    return session;
  }

  // One refresh at a time per session. A caller whose token was already replaced does nothing,
  // because the old refresh token no longer works.
  private refresh(session: Session, observedGeneration: number): Promise<void> {
    if (session.closing) {
      return Promise.reject(new SessionError('ended'));
    }
    // A session made from a client's access token cannot refresh: the client sends a new one.
    if (
      !session.tokens.refreshToken &&
      session.generation === observedGeneration
    ) {
      this.store.delete(session.id);
      return Promise.reject(new SessionError('ended'));
    }
    if (session.refreshing) return session.refreshing;
    if (session.generation !== observedGeneration) return Promise.resolve();

    const running = this.runRefresh(session).finally(() => {
      session.refreshing = undefined;
    });
    session.refreshing = running;
    return running;
  }

  private async runRefresh(session: Session): Promise<void> {
    try {
      const next = await refreshTokens(
        this.backend,
        session.tokens.refreshToken,
      );
      const now = this.now();
      session.tokens = {
        accessToken: next.accessToken,
        refreshToken: next.refreshToken,
        accessExpiresAt: now + next.expiresIn * 1000,
        refreshExpiresAt: now + this.refreshTtlMs,
      };
      session.generation += 1;
    } catch (error) {
      if (!isUnauthorized(error)) throw error;
      this.store.delete(session.id);
      throw new SessionError('ended');
    }
  }
}

// When a JWT access token expires, or undefined when the token does not say.
function tokenExpiry(accessToken: string): number | undefined {
  const payload = accessToken.split('.')[1];
  if (!payload) return undefined;
  try {
    const { exp } = JSON.parse(
      Buffer.from(payload, 'base64url').toString(),
    ) as {
      exp?: unknown;
    };
    return typeof exp === 'number' ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}
