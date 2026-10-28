// Copied from tool.template.spec.ts. This file covers what happens when a save fails or the access
// token has expired. A save is never sent twice: after a 500, a timeout or a network error the
// outcome is reported as unknown, and nothing is read back or retried on its own.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FAKE_LEARNER_ID } from '../../helpers/fake-lessons-data.js';
import { TOKEN_MARKER } from '../../helpers/fake-mssuize.js';
import { NOTES_MARKER } from '../../helpers/fake-weekly.js';
import { openSession } from '../../helpers/household-fixtures.js';
import { textOf } from '../../helpers/tool-harness.js';
import {
  createUpdateFixture,
  putRequests,
} from '../../helpers/weekly-update-fixture.js';

const UNKNOWN_OUTCOME =
  'The result is unknown: the schedule may or may not have been saved, and lessons may or may not have been moved. Do not try the save again. Call learner_weekly_schedule_get to see the saved schedule first, then learner_sessions_list to check the lessons, before telling the parent anything.';
const BACKEND_TEXT =
  'update learner weekly schedule v2: pq: deadlock detected SECRET-DB-DETAIL';

describe('learner_weekly_schedule_update tool, when a save fails', () => {
  let fx: Awaited<ReturnType<typeof createUpdateFixture>>;

  beforeEach(async () => {
    fx = await createUpdateFixture();
  });

  afterEach(async () => {
    await fx.close();
  });

  const weeklyReads = () =>
    fx.fake.requests.filter(
      (request) =>
        request.method === 'GET' &&
        request.path ===
          `/api/v1/learners/${FAKE_LEARNER_ID}/weekly-schedule-v2`,
    ).length;

  describe('a 5xx, a timeout or a network error: the outcome is unknown, so nothing is retried', () => {
    it.each([
      ['a 500', { status: 500, text: BACKEND_TEXT }],
      ['a timeout', 'timeout' as const],
      ['a 502', { status: 502, text: 'bad gateway' }],
      ['a 503', { status: 503, text: 'unavailable' }],
      ['a 504', { status: 504, text: 'gateway timeout' }],
    ])(
      'after %s: one save, the unknown-outcome error, and no backend text',
      async (_label, outcome) => {
        const { sessionId, token } = await fx.proposed();
        fx.fake.weekly.putOutcome = outcome;

        const result = await fx.confirm(sessionId, token);

        expect(result.isError).toBe(true);
        expect(textOf(result)).toBe(UNKNOWN_OUTCOME);
        expect(textOf(result)).toMatch(/Do not try the save again/);
        expect(textOf(result)).toMatch(/learner_weekly_schedule_get/);
        expect(textOf(result)).toMatch(/learner_sessions_list/);
        expect(JSON.stringify(result)).not.toContain('SECRET-DB-DETAIL');
        expect(putRequests(fx.fake)).toHaveLength(1);
      },
    );

    it('does not read the schedule back on its own after an unknown outcome', async () => {
      const { sessionId, token } = await fx.proposed();
      fx.fake.weekly.putOutcome = { status: 500, text: BACKEND_TEXT };
      const readsBefore = weeklyReads();

      await fx.confirm(sessionId, token);

      // Only the re-check before the save read it; nothing was read after.
      expect(weeklyReads()).toBe(readsBefore + 1);
    });

    it('says unknown even when the save did go through, because it cannot tell', async () => {
      const { sessionId, token } = await fx.proposed();
      fx.fake.weekly.putOutcome = 'timeout';
      fx.fake.weekly.putSavedDespiteFailure = true;

      const result = await fx.confirm(sessionId, token);

      expect(textOf(result)).toBe(UNKNOWN_OUTCOME);
      expect(putRequests(fx.fake)).toHaveLength(1);
    });

    it('does not retry when the same token is used again after a failure', async () => {
      const { sessionId, token } = await fx.proposed();
      fx.fake.weekly.putOutcome = 'timeout';
      await fx.confirm(sessionId, token);

      const again = await fx.confirm(sessionId, token);

      expect(again.isError).toBe(true);
      expect(textOf(again)).toMatch(/not valid any more/);
      expect(putRequests(fx.fake)).toHaveLength(1);
    });

    it('does not retry on its own even when the backend would now succeed', async () => {
      const { sessionId, token } = await fx.proposed();
      fx.fake.weekly.putOutcome = { status: 500, text: BACKEND_TEXT };
      await fx.confirm(sessionId, token);
      fx.fake.weekly.putOutcome = 'success';

      expect(putRequests(fx.fake)).toHaveLength(1);
      expect(
        JSON.stringify(fx.fake.weekly.current(FAKE_LEARNER_ID)),
      ).not.toContain('17:00:00');
    });
  });

  describe('a reply that is a plain refusal, not an unknown outcome', () => {
    it.each([
      [400, 'The schedule was not accepted.'],
      [403, 'Not allowed to change this learner’s schedule.'],
      [404, 'Learner not found.'],
    ])(
      'reports a %i with fixed wording, no backend text and one save',
      async (status, wording) => {
        const { sessionId, token } = await fx.proposed();
        fx.fake.weekly.putOutcome = {
          status,
          text: `your plan allows a maximum of 1 subject(s) SECRET-${status}`,
        };

        const result = await fx.confirm(sessionId, token);

        expect(result.isError).toBe(true);
        expect(textOf(result)).toBe(wording);
        expect(JSON.stringify(result)).not.toContain('SECRET');
        expect(putRequests(fx.fake)).toHaveLength(1);
      },
    );

    it.each([409, 422, 429])(
      'reports a %i once, with no backend text and no read-back',
      async (status) => {
        const { sessionId, token } = await fx.proposed();
        fx.fake.weekly.putOutcome = { status, text: `BACKEND-${status}-TEXT` };
        const readsBefore = weeklyReads();

        const result = await fx.confirm(sessionId, token);

        expect(result.isError).toBe(true);
        expect(textOf(result)).not.toContain(`BACKEND-${status}-TEXT`);
        expect(textOf(result)).not.toBe(UNKNOWN_OUTCOME);
        expect(putRequests(fx.fake)).toHaveLength(1);
        expect(weeklyReads()).toBe(readsBefore + 1);
      },
    );
  });

  describe('an expired access token', () => {
    it('refreshes once and sends the save once more after a 401 on the save, then reports updated', async () => {
      const { sessionId, token } = await fx.proposed();
      fx.state.expireBeforePut = true;

      const result = await fx.confirm(sessionId, token);

      expect(result.structuredContent).toMatchObject({ status: 'updated' });
      expect(fx.fake.refreshCalls).toBe(1);
      // The first is rejected by the backend before it runs anything; the second is the only one that counts.
      expect(putRequests(fx.fake)).toHaveLength(2);
      expect(putRequests(fx.fake)[1]?.body).toEqual(
        putRequests(fx.fake)[0]?.body,
      );
    });

    it('refreshes once during the re-check and then sends one save', async () => {
      const { sessionId, token } = await fx.proposed();
      fx.fake.expireAccessTokens();

      const result = await fx.confirm(sessionId, token);

      expect(result.structuredContent).toMatchObject({ status: 'updated' });
      expect(fx.fake.refreshCalls).toBe(1);
      expect(putRequests(fx.fake)).toHaveLength(1);
    });

    it('ends the session and saves nothing when the refresh is refused', async () => {
      const { sessionId, token } = await fx.proposed();
      fx.fake.expireAccessTokens();
      fx.fake.refreshFailure = 401;

      const result = await fx.confirm(sessionId, token);

      expect(result.isError).toBe(true);
      expect(textOf(result)).not.toBe(UNKNOWN_OUTCOME);
      expect(textOf(result)).toMatch(/sign in again/i);
      expect(putRequests(fx.fake)).toHaveLength(0);
    });
  });

  it('keeps tokens, the backend’s text, notes and the password out of every failure', async () => {
    const outputs: unknown[] = [];
    for (const outcome of [
      { status: 500, text: BACKEND_TEXT },
      'timeout' as const,
      { status: 400, text: 'secret-detail-SHOULD-NOT-LEAK' },
    ]) {
      const { sessionId, token } = await fx.proposed();
      fx.fake.weekly.putOutcome = outcome;
      outputs.push(await fx.confirm(sessionId, token));
    }

    const text = JSON.stringify(outputs);
    expect(text).not.toContain(TOKEN_MARKER);
    expect(text).not.toContain('secret-detail');
    expect(text).not.toContain('SECRET-DB-DETAIL');
    expect(text).not.toContain(NOTES_MARKER);
    expect(text).not.toContain('refresh_token');
  });

  it('refuses a tutor’s session at confirm time with no backend call', async () => {
    const tutor = openSession(
      fx.fake,
      fx.connection.sessions,
      'house-1',
      'tutor',
    );
    const { confirmationToken } = fx.connection.sessions.createProposal(tutor, {
      action: 'cancel',
      lessonId: FAKE_LEARNER_ID,
      reason: 'x',
    });
    const before = fx.fake.requests.length;

    const result = await fx.confirm(tutor, confirmationToken);

    expect(result.isError).toBe(true);
    expect(fx.fake.requests).toHaveLength(before);
  });
});
