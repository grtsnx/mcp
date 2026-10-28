import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCurrentUser } from '@/external/mssuize/auth-api.js';
import {
  BackendError,
  type BackendErrorKind,
} from '@/external/mssuize/backend-error.js';
import { SessionError } from '@/session/session-error.js';
import { setupSessions as setup } from '../helpers/session-fixture.js';

// sendWrite is the one place a write is sent. Its promise: sent once, resent only after a 401, and
// an outcome that cannot be known is reported as unknown instead of being tried again.
describe('SessionService.sendWrite', () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    ctx = setup();
  });

  it('returns what the write returned, and sends it once', async () => {
    const id = ctx.signIn();
    const send = vi.fn(async () => 'saved');

    const outcome = await ctx.sessions.sendWrite(id, send);

    expect(outcome).toEqual({ status: 'done', value: 'saved' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('gives the write an access token that is valid now', async () => {
    const id = ctx.signIn();

    await ctx.sessions.sendWrite(id, (accessToken) =>
      fetchCurrentUser(ctx.backend, accessToken),
    );

    expect(ctx.fake.requests.at(-1)?.headers.authorization).toMatch(
      /^Bearer access-/,
    );
    expect(ctx.fake.refreshCalls).toBe(0);
  });

  describe('a 401 from an expired token', () => {
    it('refreshes once and sends the write once more', async () => {
      const id = ctx.signIn();
      ctx.fake.expireAccessTokens();
      const send = vi.fn((accessToken: string) =>
        fetchCurrentUser(ctx.backend, accessToken),
      );

      const outcome = await ctx.sessions.sendWrite(id, send);

      expect(outcome.status).toBe('done');
      expect(send).toHaveBeenCalledTimes(2);
      expect(ctx.fake.refreshCalls).toBe(1);
    });

    it('stops after the retry: a second 401 ends the session and nothing is sent a third time', async () => {
      const id = ctx.signIn();
      ctx.fake.rejectAllAccessTokens = true;
      const send = vi.fn((accessToken: string) =>
        fetchCurrentUser(ctx.backend, accessToken),
      );

      await expect(ctx.sessions.sendWrite(id, send)).rejects.toMatchObject({
        kind: 'ended',
      });
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('is not "unknown" when the refresh is refused: the first request was rejected before it ran', async () => {
      const id = ctx.signIn();
      ctx.fake.expireAccessTokens();
      ctx.fake.revokeRefreshTokens();
      const send = vi.fn((accessToken: string) =>
        fetchCurrentUser(ctx.backend, accessToken),
      );

      await expect(ctx.sessions.sendWrite(id, send)).rejects.toBeInstanceOf(
        SessionError,
      );
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('is not "unknown" when the refresh fails with a 5xx either', async () => {
      const id = ctx.signIn();
      ctx.fake.expireAccessTokens();
      ctx.fake.refreshFailure = 503;
      const send = vi.fn((accessToken: string) =>
        fetchCurrentUser(ctx.backend, accessToken),
      );

      await expect(ctx.sessions.sendWrite(id, send)).rejects.toMatchObject({
        kind: 'unavailable',
      });
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('reports unknown when the resent write itself fails with a 5xx', async () => {
      const id = ctx.signIn();
      let calls = 0;
      const send = vi.fn(async () => {
        calls += 1;
        throw new BackendError(calls === 1 ? 'unauthorized' : 'unavailable');
      });

      const outcome = await ctx.sessions.sendWrite(id, send);

      expect(outcome.status).toBe('unknown');
      expect(send).toHaveBeenCalledTimes(2);
    });
  });

  describe('a write that was sent and may have been saved', () => {
    it.each([
      'timeout',
      'unreachable',
      'unavailable',
      'unexpected_response',
    ] as BackendErrorKind[])(
      'is reported as unknown after %s, and is sent exactly once',
      async (kind) => {
        const id = ctx.signIn();
        const send = vi.fn(async () => {
          throw new BackendError(kind);
        });

        const outcome = await ctx.sessions.sendWrite(id, send);

        expect(outcome).toMatchObject({ status: 'unknown', error: { kind } });
        expect(send).toHaveBeenCalledTimes(1);
      },
    );
  });

  describe('a write the backend refused', () => {
    it.each([
      'forbidden',
      'not_found',
      'invalid_request',
      'rate_limited',
      'rejected',
      'cannot_reschedule',
      'slot_unavailable',
      'outside_availability',
    ] as BackendErrorKind[])(
      'is thrown as %s, and is sent exactly once',
      async (kind) => {
        const id = ctx.signIn();
        const send = vi.fn(async () => {
          throw new BackendError(kind);
        });

        await expect(ctx.sessions.sendWrite(id, send)).rejects.toMatchObject({
          kind,
        });
        expect(send).toHaveBeenCalledTimes(1);
      },
    );

    it('throws an error that is not a backend error as it is', async () => {
      const id = ctx.signIn();
      const send = vi.fn(async () => {
        throw new Error('a bug');
      });

      await expect(ctx.sessions.sendWrite(id, send)).rejects.toThrow('a bug');
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  it('refuses an unknown session without sending anything', async () => {
    const send = vi.fn(async () => 'saved');

    await expect(ctx.sessions.sendWrite('nope', send)).rejects.toMatchObject({
      kind: 'not_found',
    });
    expect(send).not.toHaveBeenCalled();
  });
});
