// Copied from tool.template.spec.ts. session_reschedule is a write tool: this file covers what
// happens when a move fails or the access token has expired. Nothing is ever sent twice, and an
// unknown outcome is reported as unknown.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TOKEN_MARKER, type FakeMssuize } from '../../helpers/fake-mssuize.js';
import {
  FAKE_LESSON_ID,
  FAKE_TUTOR_ID,
} from '../../helpers/fake-scheduling.js';
import { moveRequests, openSession } from '../../helpers/household-fixtures.js';
import {
  UNKNOWN_OUTCOME,
  createRescheduleFixture,
} from '../../helpers/reschedule-fixture.js';
import { textOf, type createClock } from '../../helpers/tool-harness.js';

describe('session_reschedule tool, when a move fails', () => {
  let fx: Awaited<ReturnType<typeof createRescheduleFixture>>;
  let fake: FakeMssuize;
  let clock: ReturnType<typeof createClock>;
  let propose: typeof fx.propose;
  let confirm: typeof fx.confirm;
  let proposed: typeof fx.proposed;

  beforeEach(async () => {
    fx = await createRescheduleFixture();
    ({ fake, clock, propose, confirm, proposed } = fx);
  });

  afterEach(async () => {
    await fx.close();
  });

  describe('the outcome is unknown, so nothing is retried', () => {
    it('sends one move and says the result is unknown after a 500, with no backend text', async () => {
      const { sessionId, token } = await proposed();
      fake.scheduling.rescheduleOutcome = {
        status: 500,
        text: 'failed to reschedule session',
      };

      const result = await confirm(sessionId, token);

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(UNKNOWN_OUTCOME);
      expect(textOf(result)).toMatch(/Do not try the move again/);
      expect(textOf(result)).toMatch(/session_get/);
      expect(JSON.stringify(result)).not.toContain(
        'failed to reschedule session',
      );
      expect(moveRequests(fake)).toHaveLength(1);
    });

    it('sends one move and says the result is unknown after a timeout', async () => {
      const { sessionId, token } = await proposed();
      fake.scheduling.rescheduleOutcome = 'timeout';

      const result = await confirm(sessionId, token);

      expect(textOf(result)).toBe(UNKNOWN_OUTCOME);
      expect(moveRequests(fake)).toHaveLength(1);
    });

    it.each([502, 503, 504])(
      'says the result is unknown after a %i, and sends one move',
      async (status) => {
        const { sessionId, token } = await proposed();
        fake.scheduling.rescheduleOutcome = {
          status,
          text: 'upstream trouble',
        };

        const result = await confirm(sessionId, token);

        expect(textOf(result)).toBe(UNKNOWN_OUTCOME);
        expect(moveRequests(fake)).toHaveLength(1);
      },
    );

    it('does not retry on its own even when asked again with the same token', async () => {
      const { sessionId, token } = await proposed();
      fake.scheduling.rescheduleOutcome = {
        status: 500,
        text: 'failed to reschedule session',
      };
      await confirm(sessionId, token);

      const again = await confirm(sessionId, token);

      expect(textOf(again)).toMatch(/not valid any more/);
      expect(moveRequests(fake)).toHaveLength(1);
    });
  });

  describe('an expired access token', () => {
    it('refreshes once and sends the move once more after a 401', async () => {
      const { sessionId, token } = await proposed();
      fake.expireAccessTokens();
      const refreshesBefore = fake.refreshCalls;

      const result = await confirm(sessionId, token);

      expect(result.structuredContent).toMatchObject({ status: 'rescheduled' });
      expect(fake.refreshCalls - refreshesBefore).toBe(1);
      // One attempt the backend rejected with a 401 before running anything, then one that worked.
      expect(moveRequests(fake)).toHaveLength(2);
      expect(fake.scheduling.timesOf(FAKE_LESSON_ID).start).toBe(
        '2026-06-02T14:00:00Z',
      );
    });

    it('stops, without a second move, when the refresh is refused, and does not claim an unknown outcome', async () => {
      const { sessionId, token } = await proposed();
      fake.expireAccessTokens();
      fake.revokeRefreshTokens();

      const result = await confirm(sessionId, token);

      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/ask the user to sign in again/i);
      expect(textOf(result)).not.toMatch(/unknown/i);
      expect(moveRequests(fake)).toHaveLength(1);
    });

    it('stops, without a second move, when the refresh fails with a 5xx, and does not claim an unknown outcome', async () => {
      const { sessionId, token } = await proposed();
      fake.expireAccessTokens();
      fake.refreshFailure = 503;

      const result = await confirm(sessionId, token);

      expect(result.isError).toBe(true);
      expect(textOf(result)).not.toMatch(/may or may not/i);
      expect(moveRequests(fake)).toHaveLength(1);
    });

    it('does not send a move at all when the refresh before it fails', async () => {
      // A session whose access token is nearly out, so confirm must refresh before sending.
      const sessionId = openSession(
        fake,
        fx.connection.sessions,
        'house-1',
        'guardian',
        90,
      );
      const proposal = (await propose(sessionId)).structuredContent as {
        confirmationToken: string;
      };
      clock.advance(40_000);
      fake.refreshFailure = 503;

      const result = await confirm(sessionId, proposal.confirmationToken);

      expect(result.isError).toBe(true);
      expect(textOf(result)).not.toMatch(/may or may not/i);
      expect(moveRequests(fake)).toHaveLength(0);
    });
  });

  it('never puts a token, an email or backend text in any output or error', async () => {
    const outputs: object[] = [];
    for (const outcome of [
      'success',
      { status: 400, text: 'cannot reschedule this session' },
      { status: 500, text: 'failed to reschedule session' },
      'timeout',
    ] as const) {
      const { sessionId, token } = await proposed();
      fake.scheduling.rescheduleOutcome = outcome;
      outputs.push(await confirm(sessionId, token));
      outputs.push(await confirm(sessionId, token));
    }

    for (const output of outputs) {
      const text = JSON.stringify(output);
      for (const secret of [
        TOKEN_MARKER,
        FAKE_TUTOR_ID,
        'cannot reschedule this session',
        'failed to reschedule session',
      ]) {
        expect(text).not.toContain(secret);
      }
      expect(text).not.toMatch(/@/);
    }
  });
});
