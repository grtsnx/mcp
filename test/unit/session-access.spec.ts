import { beforeEach, describe, expect, it } from 'vitest';
import {
  sessionProfile as profile,
  setupSessions as setup,
} from '../helpers/session-fixture.js';

describe('SessionService access rules', () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    ctx = setup();
  });

  describe('withHousehold', () => {
    const callWithHousehold = (id: string) =>
      ctx.sessions.withHousehold(id, async (accessToken, householdId) => ({
        accessToken,
        householdId,
      }));

    it('hands the call the household id stored in the session', async () => {
      const id = ctx.signIn();

      const seen = await callWithHousehold(id);

      expect(seen.householdId).toBe('house-1');
      expect(seen.accessToken).toContain('access-');
    });

    it('refuses a session with no household, without calling the backend', async () => {
      const credentials = ctx.fake.createTestSessionCredentials();
      const id = ctx.sessions.create({
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        expiresIn: credentials.expiresIn,
        user: profile,
        householdId: null,
      });
      const before = ctx.fake.requests.length;

      await expect(callWithHousehold(id)).rejects.toMatchObject({
        kind: 'no_household',
      });
      expect(ctx.fake.requests.length).toBe(before);
    });

    it('gives the usual error for an unknown session', async () => {
      await expect(callWithHousehold('nope')).rejects.toMatchObject({
        kind: 'not_found',
      });
    });

    it('refreshes ahead of expiry, like withAccessToken', async () => {
      const id = ctx.signIn();
      ctx.clock.advance(7200_000 - 30_000);

      const seen = await callWithHousehold(id);

      expect(ctx.fake.refreshCalls).toBe(1);
      expect(seen.accessToken).not.toBe(ctx.fake.issuedRefreshTokens[0]);
      expect(seen.householdId).toBe('house-1');
    });
  });

  describe('assertRole', () => {
    const openAs = (role: string) => {
      const credentials = ctx.fake.createTestSessionCredentials();
      return ctx.sessions.create({
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        expiresIn: credentials.expiresIn,
        user: { ...profile, role },
        householdId: 'house-1',
      });
    };

    it.each(['guardian', 'delegate', 'admin'])(
      'lets the %s role through',
      (role) => {
        const id = openAs(role);

        expect(() =>
          ctx.sessions.assertRole(id, ['guardian', 'delegate', 'admin']),
        ).not.toThrow();
      },
    );

    it.each(['tutor', 'learner', ''])(
      'refuses the %j role like a backend 403, without calling the backend',
      (role) => {
        const id = openAs(role);
        const before = ctx.fake.requests.length;

        expect(() =>
          ctx.sessions.assertRole(id, ['guardian', 'delegate', 'admin']),
        ).toThrowError(
          expect.objectContaining({ name: 'BackendError', kind: 'forbidden' }),
        );
        expect(ctx.fake.requests.length).toBe(before);
      },
    );

    it('gives the usual error for an unknown session', () => {
      expect(() => ctx.sessions.assertRole('nope', ['guardian'])).toThrowError(
        expect.objectContaining({ kind: 'not_found' }),
      );
    });
  });
});
