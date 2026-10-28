import { beforeEach, describe, expect, it } from 'vitest';
import { SessionError } from '@/session/session-error.js';
import {
  sessionProfile as profile,
  setupSessions as setup,
} from '../helpers/session-fixture.js';

const change = {
  action: 'reschedule' as const,
  lessonId: '8a1f6e52-2c4b-4f0e-bd51-7c9e0a1b2c3d',
  newStart: '2026-06-02T10:00:00-04:00',
  newEnd: '2026-06-02T11:00:00-04:00',
  reason: 'Soccer practice moved',
  currentStart: '2026-06-01T10:00:00-04:00',
  currentEnd: '2026-06-01T11:00:00-04:00',
};

describe('SessionService proposals', () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    ctx = setup();
  });

  it('gives an opaque token of at least 128 random bits and a five minute lifetime', () => {
    const id = ctx.signIn();

    const { confirmationToken, expiresInSeconds } = ctx.sessions.createProposal(
      id,
      change,
    );

    expect(
      Buffer.from(confirmationToken, 'base64url').length,
    ).toBeGreaterThanOrEqual(16);
    expect(confirmationToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(confirmationToken).not.toContain(id);
    expect(expiresInSeconds).toBe(300);
  });

  it('gives every proposal its own token', () => {
    const id = ctx.signIn();

    const tokens = new Set(
      Array.from(
        { length: 30 },
        () => ctx.sessions.createProposal(id, change).confirmationToken,
      ),
    );

    expect(tokens.size).toBe(30);
  });

  it('hands back exactly what was proposed', () => {
    const id = ctx.signIn();
    const { confirmationToken } = ctx.sessions.createProposal(id, change);

    const proposal = ctx.sessions.takeProposal(
      id,
      confirmationToken,
      'reschedule',
    );

    expect(proposal).toMatchObject(change);
  });

  it('works once: the second take fails', () => {
    const id = ctx.signIn();
    const { confirmationToken } = ctx.sessions.createProposal(id, change);
    ctx.sessions.takeProposal(id, confirmationToken, 'reschedule');

    expect(() =>
      ctx.sessions.takeProposal(id, confirmationToken, 'reschedule'),
    ).toThrowError(
      expect.objectContaining({
        name: 'SessionError',
        kind: 'proposal_invalid',
      }),
    );
  });

  it('is used up before anything else happens, even by an expired take', () => {
    const id = ctx.signIn();
    const { confirmationToken } = ctx.sessions.createProposal(id, change);
    ctx.clock.advance(300_000);

    expect(() =>
      ctx.sessions.takeProposal(id, confirmationToken, 'reschedule'),
    ).toThrowError(SessionError);
    ctx.clock.advance(-300_000);
    expect(() =>
      ctx.sessions.takeProposal(id, confirmationToken, 'reschedule'),
    ).toThrowError(SessionError);
  });

  it('is valid just before five minutes and expired at five minutes', () => {
    const id = ctx.signIn();
    const early = ctx.sessions.createProposal(id, change).confirmationToken;
    const late = ctx.sessions.createProposal(id, change).confirmationToken;

    ctx.clock.advance(299_999);
    expect(ctx.sessions.takeProposal(id, early, 'reschedule')).toMatchObject(
      change,
    );
    ctx.clock.advance(1);
    expect(() =>
      ctx.sessions.takeProposal(id, late, 'reschedule'),
    ).toThrowError(SessionError);
  });

  it('cannot be used from another sign-in session, and that attempt does not use it up', () => {
    const owner = ctx.signIn();
    const other = ctx.signIn();
    const { confirmationToken } = ctx.sessions.createProposal(owner, change);

    expect(() =>
      ctx.sessions.takeProposal(other, confirmationToken, 'reschedule'),
    ).toThrowError(expect.objectContaining({ kind: 'proposal_invalid' }));
    expect(
      ctx.sessions.takeProposal(owner, confirmationToken, 'reschedule'),
    ).toMatchObject(change);
  });

  it('gives the same error for an unknown, a used and an expired token', () => {
    const id = ctx.signIn();
    const used = ctx.sessions.createProposal(id, change).confirmationToken;
    ctx.sessions.takeProposal(id, used, 'reschedule');
    const expired = ctx.sessions.createProposal(id, change).confirmationToken;
    ctx.clock.advance(300_000);

    const messages = [
      () => ctx.sessions.takeProposal(id, 'never-issued', 'reschedule'),
      () => ctx.sessions.takeProposal(id, used, 'reschedule'),
      () => ctx.sessions.takeProposal(id, expired, 'reschedule'),
    ].map((take) => {
      try {
        take();
        return 'no error';
      } catch (error) {
        return (error as Error).message;
      }
    });

    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).toMatch(/not valid any more/);
  });

  it('keeps at most ten proposals per session, dropping the oldest', () => {
    const id = ctx.signIn();
    const tokens = Array.from(
      { length: 12 },
      () => ctx.sessions.createProposal(id, change).confirmationToken,
    );

    expect(() =>
      ctx.sessions.takeProposal(id, tokens[0]!, 'reschedule'),
    ).toThrowError(SessionError);
    expect(() =>
      ctx.sessions.takeProposal(id, tokens[1]!, 'reschedule'),
    ).toThrowError(SessionError);
    expect(
      ctx.sessions.takeProposal(id, tokens[2]!, 'reschedule'),
    ).toMatchObject(change);
    expect(
      ctx.sessions.takeProposal(id, tokens[11]!, 'reschedule'),
    ).toMatchObject(change);
  });

  describe('which action a token is for', () => {
    const cancelChange = {
      action: 'cancel' as const,
      lessonId: change.lessonId,
      reason: 'Family trip',
    };

    it('hands back a cancel proposal for a cancel confirm', () => {
      const id = ctx.signIn();
      const { confirmationToken } = ctx.sessions.createProposal(
        id,
        cancelChange,
      );

      expect(
        ctx.sessions.takeProposal(id, confirmationToken, 'cancel'),
      ).toMatchObject(cancelChange);
    });

    it('refuses a reschedule token for a cancel, and a cancel token for a reschedule', () => {
      const id = ctx.signIn();
      const reschedule = ctx.sessions.createProposal(
        id,
        change,
      ).confirmationToken;
      const cancel = ctx.sessions.createProposal(
        id,
        cancelChange,
      ).confirmationToken;

      expect(() =>
        ctx.sessions.takeProposal(id, reschedule, 'cancel'),
      ).toThrowError(expect.objectContaining({ kind: 'proposal_invalid' }));
      expect(() =>
        ctx.sessions.takeProposal(id, cancel, 'reschedule'),
      ).toThrowError(expect.objectContaining({ kind: 'proposal_invalid' }));
    });

    it('leaves a token alone when it is asked for the wrong action, so the right one still works', () => {
      const id = ctx.signIn();
      const cancel = ctx.sessions.createProposal(
        id,
        cancelChange,
      ).confirmationToken;

      expect(() =>
        ctx.sessions.takeProposal(id, cancel, 'reschedule'),
      ).toThrowError(SessionError);
      expect(ctx.sessions.takeProposal(id, cancel, 'cancel')).toMatchObject(
        cancelChange,
      );
    });

    it('gives the same error for a wrong action as for an unknown token', () => {
      const id = ctx.signIn();
      const cancel = ctx.sessions.createProposal(
        id,
        cancelChange,
      ).confirmationToken;
      const message = (take: () => unknown) => {
        try {
          take();
          return 'no error';
        } catch (error) {
          return (error as Error).message;
        }
      };

      expect(
        message(() => ctx.sessions.takeProposal(id, cancel, 'reschedule')),
      ).toBe(
        message(() =>
          ctx.sessions.takeProposal(id, 'never-issued', 'reschedule'),
        ),
      );
    });

    it('still works once: a cancel token cannot be used twice', () => {
      const id = ctx.signIn();
      const cancel = ctx.sessions.createProposal(
        id,
        cancelChange,
      ).confirmationToken;
      ctx.sessions.takeProposal(id, cancel, 'cancel');

      expect(() =>
        ctx.sessions.takeProposal(id, cancel, 'cancel'),
      ).toThrowError(SessionError);
    });
  });

  it('reads the clock the service was given', () => {
    expect(ctx.sessions.nowMs()).toBe(ctx.clock.now());
    ctx.clock.advance(5_000);
    expect(ctx.sessions.nowMs()).toBe(ctx.clock.now());
  });

  it('is gone with the session', async () => {
    const id = ctx.signIn();
    const { confirmationToken } = ctx.sessions.createProposal(id, change);
    await ctx.sessions.logout(id);

    expect(() =>
      ctx.sessions.takeProposal(id, confirmationToken, 'reschedule'),
    ).toThrowError(expect.objectContaining({ kind: 'not_found' }));
  });

  it('reports an unknown session like any other', () => {
    expect(() => ctx.sessions.createProposal('nope', change)).toThrowError(
      expect.objectContaining({ kind: 'not_found' }),
    );
    expect(() =>
      ctx.sessions.takeProposal('nope', 'x', 'reschedule'),
    ).toThrowError(expect.objectContaining({ kind: 'not_found' }));
  });

  it('never carries a token or a person’s details in its error', () => {
    const id = ctx.signIn();
    const error = (() => {
      try {
        ctx.sessions.takeProposal(id, 'x', 'reschedule');
      } catch (caught) {
        return caught as Error;
      }
      return undefined;
    })();

    expect(error?.message).not.toContain(profile.email);
    expect(JSON.stringify(error)).not.toMatch(/SHOULD-NOT-LEAK/);
  });
});
