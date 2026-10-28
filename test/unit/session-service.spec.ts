import { beforeEach, describe, expect, it } from 'vitest';
import { fetchCurrentUser } from '@/external/mssuize/auth-api.js';
import { BackendError } from '@/external/mssuize/backend-error.js';
import { SessionError } from '@/session/session-error.js';
import { TOKEN_MARKER } from '../helpers/fake-mssuize.js';
import {
  sessionProfile as profile,
  setupSessions as setup,
} from '../helpers/session-fixture.js';

const HOUR = 3_600_000;
describe('SessionService', () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    ctx = setup();
  });

  describe('create', () => {
    it('returns an opaque id of at least 128 random bits and no token', () => {
      const id = ctx.signIn();

      expect(Buffer.from(id, 'base64url').length).toBeGreaterThanOrEqual(16);
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(id).not.toContain(TOKEN_MARKER);
    });

    it('gives every session a different id', () => {
      const ids = new Set(Array.from({ length: 50 }, () => ctx.signIn()));

      expect(ids.size).toBe(50);
    });
  });

  describe('withAccessToken', () => {
    it('uses the stored token without refreshing while it is fresh', async () => {
      const id = ctx.signIn();

      const me = await ctx.whoAmI(id);

      expect(me.email).toBe('guardian@example.com');
      expect(ctx.fake.refreshCalls).toBe(0);
    });

    it('refreshes first when the access token expires in under 60 seconds', async () => {
      const id = ctx.signIn();
      ctx.clock.advance(7200_000 - 59_000);

      await ctx.whoAmI(id);

      expect(ctx.fake.refreshCalls).toBe(1);
      expect(ctx.fake.requests.map((request) => request.path)).toEqual([
        '/api/v1/auth/refresh',
        '/api/v1/auth/me',
      ]);
    });

    it('does not refresh when 60 seconds or more are left', async () => {
      const id = ctx.signIn();
      ctx.clock.advance(7200_000 - 61_000);

      await ctx.whoAmI(id);

      expect(ctx.fake.refreshCalls).toBe(0);
    });

    it('takes the new lifetime from the refresh reply, not a fixed two hours', async () => {
      ctx.fake.refreshExpiresIn = 600;
      const id = ctx.signIn();
      ctx.clock.advance(7200_000 - 30_000);
      await ctx.whoAmI(id);
      expect(ctx.fake.refreshCalls).toBe(1);

      ctx.clock.advance(400_000);
      await ctx.whoAmI(id);
      expect(ctx.fake.refreshCalls).toBe(1);

      ctx.clock.advance(150_000);
      await ctx.whoAmI(id);
      expect(ctx.fake.refreshCalls).toBe(2);
    });

    it('refreshes once and retries once after a 401', async () => {
      const id = ctx.signIn();
      ctx.fake.expireAccessTokens();

      const me = await ctx.whoAmI(id);

      expect(me.email).toBe(profile.email);
      expect(ctx.fake.refreshCalls).toBe(1);
      expect(
        ctx.fake.requests.map((request) => `${request.method} ${request.path}`),
      ).toEqual([
        'GET /api/v1/auth/me',
        'POST /api/v1/auth/refresh',
        'GET /api/v1/auth/me',
      ]);
    });

    it('sends the refresh token as the refresh_token cookie', async () => {
      const id = ctx.signIn();
      const [first] = ctx.fake.issuedRefreshTokens;
      ctx.fake.expireAccessTokens();

      await ctx.whoAmI(id);

      expect(ctx.lastCookie('/api/v1/auth/refresh')).toBe(
        `refresh_token=${first}`,
      );
    });

    it('uses the rotated refresh token next time, never the old one', async () => {
      const id = ctx.signIn();
      const [first] = ctx.fake.issuedRefreshTokens;
      ctx.fake.expireAccessTokens();
      await ctx.whoAmI(id);
      const second = ctx.fake.issuedRefreshTokens.at(-1);
      expect(ctx.fake.isRefreshTokenValid(first!)).toBe(false);

      ctx.fake.expireAccessTokens();
      await ctx.whoAmI(id);

      expect(ctx.fake.refreshCalls).toBe(2);
      expect(ctx.lastCookie('/api/v1/auth/refresh')).toBe(
        `refresh_token=${second}`,
      );
      expect(second).not.toBe(first);
    });

    it('makes exactly one refresh for two parallel calls near expiry', async () => {
      ctx = setup({ latencyMs: 20 });
      const id = ctx.signIn();
      ctx.clock.advance(7200_000 - 10_000);

      const [a, b] = await Promise.all([ctx.whoAmI(id), ctx.whoAmI(id)]);

      expect(a.email).toBe(profile.email);
      expect(b.email).toBe(profile.email);
      expect(ctx.fake.refreshCalls).toBe(1);
    });

    it('makes exactly one refresh for parallel calls that all get a 401', async () => {
      ctx = setup({ latencyMs: 20 });
      const id = ctx.signIn();
      ctx.fake.expireAccessTokens();

      const results = await Promise.all([
        ctx.whoAmI(id),
        ctx.whoAmI(id),
        ctx.whoAmI(id),
      ]);

      expect(results.every((me) => me.email === profile.email)).toBe(true);
      expect(ctx.fake.refreshCalls).toBe(1);
    });

    it('does not refresh again when a late 401 belongs to a token that was already replaced', async () => {
      const id = ctx.signIn();
      ctx.fake.expireAccessTokens();
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      // This call has already taken the old token when another call refreshes.
      const slow = ctx.sessions.withAccessToken(id, async (accessToken) => {
        await gate;
        return fetchCurrentUser(ctx.backend, accessToken);
      });

      await ctx.whoAmI(id);
      expect(ctx.fake.refreshCalls).toBe(1);
      release();

      await expect(slow).resolves.toMatchObject({ email: profile.email });
      expect(ctx.fake.refreshCalls).toBe(1);
    });

    it('deletes the session and asks to sign in again when the refresh is refused', async () => {
      const id = ctx.signIn();
      ctx.fake.expireAccessTokens();
      ctx.fake.revokeRefreshTokens();

      const error = await ctx.whoAmI(id).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(SessionError);
      expect((error as SessionError).message).toMatch(/sign in again/i);
      await expect(ctx.whoAmI(id)).rejects.toMatchObject({
        kind: 'not_found',
      });
    });

    it('keeps the session when the refresh fails for another reason', async () => {
      const id = ctx.signIn();
      ctx.fake.expireAccessTokens();
      ctx.fake.refreshFailure = 503;

      await expect(ctx.whoAmI(id)).rejects.toMatchObject({
        name: 'BackendError',
        kind: 'unavailable',
      });

      ctx.fake.refreshFailure = undefined;
      await expect(ctx.whoAmI(id)).resolves.toMatchObject({
        email: profile.email,
      });
    });

    it('ends the session when the retry after a refresh is still refused', async () => {
      const id = ctx.signIn();
      ctx.fake.rejectAllAccessTokens = true;

      await expect(ctx.whoAmI(id)).rejects.toMatchObject({ kind: 'ended' });
      expect(ctx.fake.refreshCalls).toBe(1);
      ctx.fake.rejectAllAccessTokens = false;
      await expect(ctx.whoAmI(id)).rejects.toMatchObject({
        kind: 'not_found',
      });
    });

    it('passes other backend errors through without refreshing', async () => {
      const id = ctx.signIn();

      const error = await ctx.sessions
        .withAccessToken(id, async () => {
          throw new BackendError('unavailable');
        })
        .catch((caught: unknown) => caught);

      expect(error).toMatchObject({ kind: 'unavailable' });
      expect(ctx.fake.refreshCalls).toBe(0);
    });
  });

  describe('unknown and expired sessions', () => {
    it('gives the same error for an unknown id', async () => {
      const error = await ctx.whoAmI('does-not-exist').catch((c: unknown) => c);

      expect(error).toBeInstanceOf(SessionError);
      expect((error as SessionError).message).toBe(
        'Session not found, sign in again.',
      );
    });

    it('gives that same error once a session has been idle too long', async () => {
      ctx = setup({ limits: { idleTtlMs: HOUR } });
      const id = ctx.signIn();
      ctx.clock.advance(HOUR + 1);

      const error = await ctx.whoAmI(id).catch((caught: unknown) => caught);

      expect((error as SessionError).message).toBe(
        'Session not found, sign in again.',
      );
    });

    it('gives that same error once the refresh token has expired', async () => {
      ctx = setup({ limits: { refreshTtlMs: 2 * HOUR } });
      const id = ctx.signIn();
      ctx.clock.advance(HOUR);
      await ctx.whoAmI(id);
      ctx.clock.advance(HOUR + 1);

      const error = await ctx.whoAmI(id).catch((caught: unknown) => caught);

      expect((error as SessionError).message).toBe(
        'Session not found, sign in again.',
      );
    });

    it('drops the oldest session when the cap is reached', async () => {
      ctx = setup({ limits: { maxSessions: 2 } });
      const first = ctx.signIn();
      const second = ctx.signIn();
      const third = ctx.signIn();

      await expect(ctx.whoAmI(first)).rejects.toMatchObject({
        kind: 'not_found',
      });
      await expect(ctx.whoAmI(second)).resolves.toBeDefined();
      await expect(ctx.whoAmI(third)).resolves.toBeDefined();
    });
  });

  describe('logout', () => {
    it('signs out with the refresh cookie and forgets the session', async () => {
      const id = ctx.signIn();
      const [token] = ctx.fake.issuedRefreshTokens;

      const outcome = await ctx.sessions.logout(id);

      expect(outcome).toEqual({ backendRevoked: true });
      expect(ctx.lastCookie('/api/v1/auth/logout')).toBe(
        `refresh_token=${token}`,
      );
      expect(ctx.fake.isRefreshTokenValid(token!)).toBe(false);
      await expect(ctx.whoAmI(id)).rejects.toMatchObject({
        kind: 'not_found',
      });
    });

    it('forgets the session even when the backend call fails', async () => {
      const id = ctx.signIn();
      ctx.fake.logoutFailure = 500;

      const outcome = await ctx.sessions.logout(id);

      expect(outcome).toEqual({ backendRevoked: false });
      await expect(ctx.whoAmI(id)).rejects.toMatchObject({
        kind: 'not_found',
      });
    });

    it('signs out with the newest refresh token when a refresh is running', async () => {
      ctx = setup({ latencyMs: 20 });
      const id = ctx.signIn();
      ctx.clock.advance(7200_000 - 10_000);

      const refreshing = ctx.whoAmI(id);
      const outcome = await ctx.sessions.logout(id);
      await refreshing;

      const newest = ctx.fake.issuedRefreshTokens.at(-1);
      expect(outcome).toEqual({ backendRevoked: true });
      expect(ctx.lastCookie('/api/v1/auth/logout')).toBe(
        `refresh_token=${newest}`,
      );
      expect(ctx.fake.isRefreshTokenValid(newest!)).toBe(false);
    });

    it('rejects new calls as soon as logout starts while refresh is in flight', async () => {
      ctx = setup({ latencyMs: 20 });
      const id = ctx.signIn();
      ctx.clock.advance(7200_000 - 10_000);

      const refreshing = ctx.whoAmI(id);
      const loggingOut = ctx.sessions.logout(id);
      await expect(ctx.whoAmI(id)).rejects.toMatchObject({ kind: 'not_found' });
      await expect(refreshing).resolves.toBeDefined();
      await expect(loggingOut).resolves.toEqual({ backendRevoked: true });
    });

    it('waits for an active backend call before revoking the session', async () => {
      const id = ctx.signIn();
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const active = ctx.sessions.withAccessToken(id, async () => gate);

      const loggingOut = ctx.sessions.logout(id);

      expect(
        ctx.fake.requests.some(
          (request) => request.path === '/api/v1/auth/logout',
        ),
      ).toBe(false);
      release();
      await active;
      await expect(loggingOut).resolves.toEqual({ backendRevoked: true });
      expect(
        ctx.fake.requests.some(
          (request) => request.path === '/api/v1/auth/logout',
        ),
      ).toBe(true);
    });

    it('reports an unknown session like any other', async () => {
      await expect(ctx.sessions.logout('does-not-exist')).rejects.toMatchObject(
        { kind: 'not_found' },
      );
    });
  });

  describe('secrets', () => {
    it('never puts a token in an error', async () => {
      const id = ctx.signIn();
      ctx.fake.expireAccessTokens();
      ctx.fake.revokeRefreshTokens();

      const errors = await Promise.all([
        ctx.whoAmI(id).catch((caught: unknown) => caught),
        ctx.whoAmI('nope').catch((caught: unknown) => caught),
      ]);

      for (const error of errors) {
        const text = `${String(error)} ${JSON.stringify(error)} ${(error as Error).stack}`;
        expect(text).not.toContain(TOKEN_MARKER);
      }
    });
  });
});
