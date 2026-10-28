// Copied from tool.template.spec.ts. session_reschedule is a write tool: this file covers the
// confirm step. The guarantees here are that one confirmed proposal sends exactly one move, that a
// token works once, and that known refusals use fixed wording. What happens when a move fails or the
// access token has expired is in session-reschedule.failures.spec.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FakeMssuize } from '../../helpers/fake-mssuize.js';
import { FAKE_LESSON_ID } from '../../helpers/fake-scheduling.js';
import {
  moveRequests,
  signInViaTool,
} from '../../helpers/household-fixtures.js';
import {
  END,
  REASON,
  START,
  createRescheduleFixture,
} from '../../helpers/reschedule-fixture.js';
import { textOf, type createClock } from '../../helpers/tool-harness.js';

describe('session_reschedule tool, step confirm', () => {
  let fx: Awaited<ReturnType<typeof createRescheduleFixture>>;
  let fake: FakeMssuize;
  let clock: ReturnType<typeof createClock>;
  let reschedule: typeof fx.reschedule;
  let confirm: typeof fx.confirm;
  let proposed: typeof fx.proposed;

  beforeEach(async () => {
    fx = await createRescheduleFixture();
    ({ fake, clock, reschedule, confirm, proposed } = fx);
  });

  afterEach(async () => {
    await fx.close();
  });

  it('sends exactly one move with exactly new_start, new_end and reason, and never force', async () => {
    const { sessionId, token } = await proposed();

    const result = await confirm(sessionId, token);

    expect(result.isError).toBeUndefined();
    const moves = moveRequests(fake);
    expect(moves).toHaveLength(1);
    expect(moves[0]?.path).toBe(
      `/api/v1/sessions/${FAKE_LESSON_ID}/reschedule`,
    );
    expect(moves[0]?.body).toEqual({
      new_start: START,
      new_end: END,
      reason: REASON,
    });
    expect(Object.keys(moves[0]?.body as object).sort()).toEqual([
      'new_end',
      'new_start',
      'reason',
    ]);
    expect(JSON.stringify(moves[0]?.body)).not.toContain('force');
  });

  it('reads the lesson back and returns the times it shows', async () => {
    const { sessionId, token } = await proposed();

    const result = await confirm(sessionId, token);

    expect(result.structuredContent).toEqual({
      status: 'rescheduled',
      lessonId: FAKE_LESSON_ID,
      learnerName: 'Byron Lovelace',
      subjects: ['Math', 'Science'],
      timezone: 'America/New_York',
      currentStart: '2026-06-01T10:00:00-04:00',
      currentEnd: '2026-06-01T11:00:00-04:00',
      currentWhenLocal: 'Monday 1 June 2026, 10:00 AM to 11:00 AM',
      newStart: '2026-06-02T14:00:00Z',
      newEnd: '2026-06-02T15:00:00Z',
      newWhenLocal: 'Tuesday 2 June 2026, 10:00 AM to 11:00 AM',
    });
    const afterMove = fake.requests.slice(
      fake.requests.findIndex((request) =>
        request.path.endsWith('/reschedule'),
      ),
    );
    expect(
      afterMove.map((request) => `${request.method} ${request.path}`),
    ).toEqual([
      `POST /api/v1/sessions/${FAKE_LESSON_ID}/reschedule`,
      `GET /api/v1/sessions/${FAKE_LESSON_ID}`,
      'GET /api/v1/households/me',
    ]);
  });

  it('reports unconfirmed, and says to check with session_get, when the lesson does not show the new time', async () => {
    const { sessionId, token } = await proposed();
    fake.scheduling.applyReschedule = false;

    const result = await confirm(sessionId, token);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      status: 'unconfirmed',
      lessonId: FAKE_LESSON_ID,
    });
    expect(JSON.stringify(result.structuredContent)).toMatch(/session_get/);
    expect(moveRequests(fake)).toHaveLength(1);
  });

  it('reports unconfirmed, not a failure, when the read-back itself fails after an accepted move', async () => {
    const { sessionId, token } = await proposed();
    fx.state.failReadBack = true;

    const result = await confirm(sessionId, token);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ status: 'unconfirmed' });
    expect(moveRequests(fake)).toHaveLength(1);
  });

  describe('the token works once', () => {
    it('refuses a second confirm without calling the backend', async () => {
      const { sessionId, token } = await proposed();
      await confirm(sessionId, token);
      const before = fake.requests.length;

      const again = await confirm(sessionId, token);

      expect(again.isError).toBe(true);
      expect(textOf(again)).toMatch(/not valid any more/);
      expect(fake.requests.length).toBe(before);
      expect(moveRequests(fake)).toHaveLength(1);
    });

    it('sends one move when two confirms arrive at the same moment', async () => {
      const { sessionId, token } = await proposed();

      const results = await Promise.all([
        confirm(sessionId, token),
        confirm(sessionId, token),
      ]);

      expect(results.filter((result) => result.isError !== true)).toHaveLength(
        1,
      );
      expect(results.filter((result) => result.isError === true)).toHaveLength(
        1,
      );
      expect(moveRequests(fake)).toHaveLength(1);
    });

    it('is used up even when the move fails, so it can never send a second one', async () => {
      const { sessionId, token } = await proposed();
      fake.scheduling.rescheduleOutcome = {
        status: 400,
        text: 'selected time slot is no longer available',
      };
      await confirm(sessionId, token);
      fake.scheduling.rescheduleOutcome = 'success';
      const before = moveRequests(fake).length;

      const again = await confirm(sessionId, token);

      expect(again.isError).toBe(true);
      expect(moveRequests(fake)).toHaveLength(before);
    });

    it('works for a proposal that is nearly five minutes old', async () => {
      const { sessionId, token } = await proposed();
      clock.advance(299_000);

      const result = await confirm(sessionId, token);

      expect(result.structuredContent).toMatchObject({ status: 'rescheduled' });
    });

    it('is refused once five minutes have passed, without calling the backend', async () => {
      const { sessionId, token } = await proposed();
      clock.advance(300_000);
      const before = fake.requests.length;

      const result = await confirm(sessionId, token);

      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/not valid any more/);
      expect(fake.requests.length).toBe(before);
      expect(moveRequests(fake)).toHaveLength(0);
    });

    it('is refused for another sign-in session, which does not use it up', async () => {
      const { sessionId, token } = await proposed();
      const other = await signInViaTool(fx.connection.client);
      const before = fake.requests.length;

      const stolen = await confirm(other, token);
      const own = await confirm(sessionId, token);

      expect(stolen.isError).toBe(true);
      expect(textOf(stolen)).toMatch(/not valid any more/);
      expect(own.structuredContent).toMatchObject({ status: 'rescheduled' });
      expect(moveRequests(fake)).toHaveLength(1);
      expect(fake.requests.length).toBeGreaterThan(before);
    });

    it.each([
      ['a token that was never issued', 'x'.repeat(43)],
      ['a one-character token', 'x'],
    ])('is refused for %s', async (_name, token) => {
      const sessionId = await signInViaTool(fx.connection.client);
      const before = fake.requests.length;

      const result = await confirm(sessionId, token);

      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/not valid any more/);
      expect(fake.requests.length).toBe(before);
    });
  });

  it.each([
    ['no token', () => ({ confirmationToken: undefined })],
    ['an empty token', () => ({ confirmationToken: '' })],
    ['a lessonId', () => ({ lessonId: FAKE_LESSON_ID })],
    ['a newStart', () => ({ newStart: START })],
    ['a reason', () => ({ reason: REASON })],
    ['a force field', () => ({ force: true })],
    ['an unknown field', () => ({ retries: 3 })],
  ])('rejects %s before any backend call', async (_name, change) => {
    // A real session and a real token, so the rejection can only come from the input check.
    const { sessionId, token } = await proposed();
    const before = fake.requests.length;

    const outcome = await reschedule({
      step: 'confirm',
      sessionId,
      confirmationToken: token,
      ...change(),
    })
      .then((result) => result.isError === true)
      .catch(() => true);

    expect(outcome).toBe(true);
    expect(fake.requests.length).toBe(before);
    // The token was not used up by the rejected call.
    expect((await confirm(sessionId, token)).structuredContent).toMatchObject({
      status: 'rescheduled',
    });
  });

  it('gives one short error for an unknown sign-in session', async () => {
    const result = await confirm('not-a-real-session', 'x'.repeat(43));

    expect(textOf(result)).toBe('Session not found, sign in again.');
    expect(fake.requests).toHaveLength(0);
  });

  describe('the backend refuses the move', () => {
    it.each([
      [
        'cannot reschedule this session',
        'This lesson cannot be rescheduled (its status or timing does not allow it).',
      ],
      [
        'Cannot Reschedule: lesson is in progress',
        'This lesson cannot be rescheduled (its status or timing does not allow it).',
      ],
      [
        'selected time slot is no longer available',
        'That time is not available.',
      ],
      [
        'selected time slot is outside allowed reschedule support windows',
        'That time is not available.',
      ],
      [
        'time is outside the learner availability',
        "That time is outside the learner's availability.",
      ],
      ['invalid request body', 'The request was not accepted.'],
      ['something nobody planned for', 'The request was not accepted.'],
    ])(
      'maps the 400 text "%s" to a fixed message, sends it once, and shows no backend text',
      async (text, message) => {
        const { sessionId, token } = await proposed();
        fake.scheduling.rescheduleOutcome = { status: 400, text };

        const result = await confirm(sessionId, token);

        expect(result.isError).toBe(true);
        expect(textOf(result)).toBe(message);
        expect(JSON.stringify(result)).not.toContain(text);
        expect(moveRequests(fake)).toHaveLength(1);
      },
    );

    it('maps a 403 to a fixed message and sends it once', async () => {
      const { sessionId, token } = await proposed();
      fake.scheduling.rescheduleOutcome = {
        status: 403,
        text: 'access denied',
      };

      const result = await confirm(sessionId, token);

      expect(textOf(result)).toBe('Not allowed to change this lesson.');
      expect(JSON.stringify(result)).not.toContain('access denied');
      expect(moveRequests(fake)).toHaveLength(1);
    });
  });
});
