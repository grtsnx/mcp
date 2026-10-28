// Copied from tool.template.spec.ts. This file covers what happens when a cancel fails or the
// access token has expired. A cancel is never sent twice: after a 500, a timeout or a network error
// the lesson is read back once and the person is told what was found, or that the result is unknown.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TOKEN_MARKER } from '../../helpers/fake-mssuize.js';
import { FAKE_LESSON_ID } from '../../helpers/fake-lessons-data.js';
import {
  NOT_CANCELLED,
  UNKNOWN_OUTCOME,
  cancelRequests,
  createCancelFixture,
} from '../../helpers/cancel-fixture.js';
import { openSession } from '../../helpers/household-fixtures.js';
import { textOf } from '../../helpers/tool-harness.js';

const BACKEND_TEXT = 'failed to cancel session';

describe('session_cancel tool, when a cancel fails', () => {
  let fx: Awaited<ReturnType<typeof createCancelFixture>>;

  beforeEach(async () => {
    fx = await createCancelFixture();
  });

  afterEach(async () => {
    await fx.close();
  });

  const lessonReads = () =>
    fx.fake.requests.filter(
      (request) =>
        request.method === 'GET' &&
        request.path === `/api/v1/sessions/${FAKE_LESSON_ID}`,
    ).length;

  describe('a 500 or a timeout: the outcome is ambiguous, so nothing is retried', () => {
    it.each([
      ['a 500', { status: 500, text: BACKEND_TEXT }],
      ['a timeout', 'timeout' as const],
    ])(
      'after %s that did not save: one cancel, a read-back, and "did not go through"',
      async (_label, outcome) => {
        const { sessionId, token } = await fx.proposed();
        fx.fake.scheduling.cancelOutcome = outcome;
        const readsBefore = lessonReads();

        const result = await fx.confirm(sessionId, token);

        expect(result.isError).toBe(true);
        expect(textOf(result)).toBe(NOT_CANCELLED);
        expect(JSON.stringify(result)).not.toContain(BACKEND_TEXT);
        expect(cancelRequests(fx.fake)).toHaveLength(1);
        expect(lessonReads()).toBe(readsBefore + 1);
      },
    );

    it.each([
      ['a 500', { status: 500, text: BACKEND_TEXT }],
      ['a timeout', 'timeout' as const],
    ])(
      'after %s that DID save: one cancel, and the read-back reports it cancelled',
      async (_label, outcome) => {
        const { sessionId, token } = await fx.proposed();
        fx.fake.scheduling.cancelOutcome = outcome;
        fx.fake.scheduling.cancelSavedDespiteFailure = true;

        const result = await fx.confirm(sessionId, token);

        expect(result.isError).toBeUndefined();
        expect(result.structuredContent).toEqual({
          status: 'cancelled',
          lessonId: FAKE_LESSON_ID,
        });
        expect(cancelRequests(fx.fake)).toHaveLength(1);
      },
    );

    it.each([
      ['a 500', { status: 500, text: BACKEND_TEXT }],
      ['a timeout', 'timeout' as const],
      ['a 502', { status: 502, text: 'bad gateway' }],
      ['a 503', { status: 503, text: 'unavailable' }],
      ['a 504', { status: 504, text: 'gateway timeout' }],
    ])(
      'after %s and a failed read-back: says the result is unknown, and never to retry',
      async (_label, outcome) => {
        const { sessionId, token } = await fx.proposed();
        fx.fake.scheduling.cancelOutcome = outcome;
        fx.state.failReadBack = true;

        const result = await fx.confirm(sessionId, token);

        expect(result.isError).toBe(true);
        expect(textOf(result)).toBe(UNKNOWN_OUTCOME);
        expect(textOf(result)).toMatch(/Do not try to cancel again/);
        expect(textOf(result)).toMatch(/session_get/);
        expect(cancelRequests(fx.fake)).toHaveLength(1);
      },
    );

    it('does not retry when the same token is used again after a failure', async () => {
      const { sessionId, token } = await fx.proposed();
      fx.fake.scheduling.cancelOutcome = 'timeout';
      await fx.confirm(sessionId, token);

      const again = await fx.confirm(sessionId, token);

      expect(again.isError).toBe(true);
      expect(textOf(again)).toMatch(/not valid any more/);
      expect(cancelRequests(fx.fake)).toHaveLength(1);
    });

    it('does not retry on its own after a 500 even when the backend would now succeed', async () => {
      const { sessionId, token } = await fx.proposed();
      fx.fake.scheduling.cancelOutcome = { status: 500, text: BACKEND_TEXT };
      await fx.confirm(sessionId, token);
      fx.fake.scheduling.cancelOutcome = 'success';

      expect(cancelRequests(fx.fake)).toHaveLength(1);
      expect(fx.fake.scheduling.statusOf(FAKE_LESSON_ID)).toBe('scheduled');
    });
  });

  describe('a reply that is a plain refusal, not an unknown outcome', () => {
    it('says Not allowed to change this lesson after a 403, with one cancel and no read-back', async () => {
      const { sessionId, token } = await fx.proposed();
      fx.fake.scheduling.forbidden = true;
      const readsBefore = lessonReads();

      const result = await fx.confirm(sessionId, token);

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe('Not allowed to change this lesson.');
      expect(cancelRequests(fx.fake)).toHaveLength(1);
      expect(lessonReads()).toBe(readsBefore);
    });

    it.each([400, 404, 409, 422, 429])(
      'reports a %i once, with no backend text and no read-back',
      async (status) => {
        const { sessionId, token } = await fx.proposed();
        fx.fake.scheduling.cancelOutcome = {
          status,
          text: `BACKEND-${status}-TEXT`,
        };
        const readsBefore = lessonReads();

        const result = await fx.confirm(sessionId, token);

        expect(result.isError).toBe(true);
        expect(textOf(result)).not.toContain(`BACKEND-${status}-TEXT`);
        expect(textOf(result)).not.toBe(UNKNOWN_OUTCOME);
        expect(cancelRequests(fx.fake)).toHaveLength(1);
        expect(lessonReads()).toBe(readsBefore);
      },
    );
  });

  describe('an expired access token', () => {
    it('refreshes once and sends the cancel once more after a 401, then reports cancelled', async () => {
      const { sessionId, token } = await fx.proposed();
      fx.fake.expireAccessTokens();

      const result = await fx.confirm(sessionId, token);

      expect(result.structuredContent).toEqual({
        status: 'cancelled',
        lessonId: FAKE_LESSON_ID,
      });
      expect(fx.fake.refreshCalls).toBe(1);
      // The first is rejected by the backend before it runs anything; the second is the only one that counts.
      expect(cancelRequests(fx.fake)).toHaveLength(2);
      expect(cancelRequests(fx.fake)[1]?.body).toEqual(
        cancelRequests(fx.fake)[0]?.body,
      );
    });

    it('refreshes before sending when the token is about to expire, and sends one cancel', async () => {
      const { sessionId, token } = await fx.proposed();
      fx.clock.advance(7200 * 1000 - 30_000);
      // The proposal lasts five minutes, so a fresh one is made after the jump.
      const fresh = (await fx.propose(sessionId)).structuredContent as {
        confirmationToken: string;
      };

      const result = await fx.confirm(sessionId, fresh.confirmationToken);

      expect(result.structuredContent).toMatchObject({ status: 'cancelled' });
      expect(fx.fake.refreshCalls).toBe(1);
      expect(cancelRequests(fx.fake)).toHaveLength(1);
      expect(token).not.toBe(fresh.confirmationToken);
    });

    it('ends the session and applies nothing when the refresh is refused', async () => {
      const { sessionId, token } = await fx.proposed();
      fx.fake.expireAccessTokens();
      fx.fake.refreshFailure = 401;

      const result = await fx.confirm(sessionId, token);

      expect(result.isError).toBe(true);
      expect(textOf(result)).not.toBe(UNKNOWN_OUTCOME);
      expect(textOf(result)).toMatch(/sign in again/i);
      expect(cancelRequests(fx.fake)).toHaveLength(1);
      expect(fx.fake.scheduling.statusOf(FAKE_LESSON_ID)).toBe('scheduled');
    });
  });

  it('keeps tokens, the backend’s text and the password out of every failure', async () => {
    const outputs: unknown[] = [];
    for (const outcome of [
      { status: 500, text: BACKEND_TEXT },
      'timeout' as const,
      { status: 400, text: 'secret-detail-SHOULD-NOT-LEAK' },
    ]) {
      const { sessionId, token } = await fx.proposed();
      fx.fake.scheduling.cancelOutcome = outcome;
      outputs.push(await fx.confirm(sessionId, token));
    }

    const text = JSON.stringify(outputs);
    expect(text).not.toContain(TOKEN_MARKER);
    expect(text).not.toContain('secret-detail');
    expect(text).not.toContain(BACKEND_TEXT);
    expect(text).not.toContain('refresh_token');
  });

  it('refuses a tutor’s session at confirm time with no backend call', async () => {
    const tutor = openSession(
      fx.fake,
      fx.connection.sessions,
      'house-1',
      'tutor',
    );
    const token = fx.connection.sessions.createProposal(tutor, {
      action: 'cancel',
      lessonId: FAKE_LESSON_ID,
      reason: 'x',
    }).confirmationToken;

    const result = await fx.confirm(tutor, token);

    expect(result.isError).toBe(true);
    expect(cancelRequests(fx.fake)).toHaveLength(0);
  });
});
