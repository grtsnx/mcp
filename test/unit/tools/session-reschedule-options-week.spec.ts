// Copied from tool.template.spec.ts: listing, a happy path, bad input, errors, no secrets.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sessionRescheduleOptionsWeekTool } from '@/tools/session-reschedule-options-week/index.js';
import {
  FakeMssuize,
  TOKEN_MARKER,
  createFakeMssuizeApi,
} from '../../helpers/fake-mssuize.js';
import {
  FAKE_COMPLETED_LESSON_ID,
  FAKE_LESSON_ID,
  FAKE_LOCKED_LESSON_ID,
  FAKE_OTHER_LESSON_ID,
  FAKE_TUTOR_ID,
  FAKE_UNKNOWN_LESSON_ID,
  TUTOR_EMAIL_MARKER,
} from '../../helpers/fake-scheduling.js';
import {
  lessonRequests,
  openSession,
  signInViaTool,
} from '../../helpers/household-fixtures.js';
import {
  connectTools,
  createClock,
  textOf,
} from '../../helpers/tool-harness.js';

const WEEK = `GET /api/v1/sessions/${FAKE_LESSON_ID}/reschedule-week-preview`;

describe('session_reschedule_options_week tool', () => {
  let connection: Awaited<ReturnType<typeof connectTools>>;
  let fake: FakeMssuize;
  let clock: ReturnType<typeof createClock>;

  beforeEach(async () => {
    fake = new FakeMssuize();
    clock = createClock();
    connection = await connectTools([sessionRescheduleOptionsWeekTool], {
      backend: createFakeMssuizeApi(fake),
      now: clock.now,
    });
  });

  afterEach(async () => {
    await connection.close();
  });

  const week = (arguments_: Record<string, unknown>) =>
    connection.client.callTool({
      name: 'session_reschedule_options_week',
      arguments: arguments_,
    });

  it('is listed read-only, says it only previews, and has strict inputs', async () => {
    const { tools } = await connection.client.listTools();
    const tool = tools.find(
      (candidate) => candidate.name === 'session_reschedule_options_week',
    );

    expect(tool?.inputSchema).toMatchObject({
      type: 'object',
      required: ['lessonId'],
      additionalProperties: false,
    });
    expect(Object.keys(tool?.inputSchema.properties ?? {}).sort()).toEqual([
      'lessonId',
      'timezone',
    ]);
    expect(tool?.outputSchema?.type).toBe('object');
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(tool?.description).toMatch(/only previews and does not move/);
    expect(tool?.description).toMatch(/comes from the request’s sign-in/);
  });

  it('returns six days of free slots with the current time and length, and sends no timezone when none is given', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await week({ sessionId, lessonId: FAKE_LESSON_ID });
    const body = result.structuredContent as {
      days: { date: string; slots: unknown[]; count: number }[];
    };

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      lessonId: FAKE_LESSON_ID,
      timezone: 'America/New_York',
      durationMinutes: 60,
      currentStart: '2026-06-01T10:00:00-04:00',
      currentEnd: '2026-06-01T11:00:00-04:00',
      currentWhenLocal: 'Monday 1 June 2026, 10:00 AM to 11:00 AM',
      totalSlots: 12,
    });
    expect(body.days.map((day) => day.date)).toEqual([
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
      '2026-06-05',
      '2026-06-06',
      '2026-06-07',
    ]);
    expect(body.days[0]).toEqual({
      date: '2026-06-02',
      dateLocal: 'Tuesday 2 June 2026',
      slots: [
        {
          start: '2026-06-02T10:00:00-04:00',
          end: '2026-06-02T11:00:00-04:00',
          whenLocal: 'Tuesday 2 June 2026, 10:00 AM to 11:00 AM',
        },
        {
          start: '2026-06-02T15:00:00-04:00',
          end: '2026-06-02T16:00:00-04:00',
          whenLocal: 'Tuesday 2 June 2026, 3:00 PM to 4:00 PM',
        },
      ],
      count: 2,
    });
    expect(lessonRequests(fake)).toEqual([WEEK]);
  });

  it('sends the timezone it was given and shows the slots in that zone', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await week({
      sessionId,
      lessonId: FAKE_LESSON_ID,
      timezone: 'Africa/Lagos',
    });

    expect(lessonRequests(fake)).toEqual([`${WEEK}?timezone=Africa%2FLagos`]);
    expect(result.structuredContent).toMatchObject({
      timezone: 'Africa/Lagos',
      currentStart: '2026-06-01T15:00:00+01:00',
    });
  });

  it('works out the length from the current times when the backend reports 0', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.scheduling.previewDurationMinutes = 0;

    const result = await week({ sessionId, lessonId: FAKE_LESSON_ID });

    expect(result.structuredContent).toMatchObject({ durationMinutes: 60 });
  });

  it('never returns tutor or learner ids or names, or the tutor email', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await week({ sessionId, lessonId: FAKE_LESSON_ID });
    const text = JSON.stringify(result);

    for (const secret of [
      FAKE_TUTOR_ID,
      TUTOR_EMAIL_MARKER,
      TOKEN_MARKER,
      'Grace',
      'Hopper',
      'Byron',
      'Lovelace',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toMatch(
      /tutor_id|tutor_name|learner_name|learner_id|session_id|total_slots/,
    );
    expect(text).not.toMatch(/@/);
  });

  it.each([
    ['a lessonId that is not a UUID', () => ({ lessonId: 'not-a-uuid' })],
    [
      'a lessonId that is the sign-in handle',
      (sessionId: string) => ({ lessonId: sessionId }),
    ],
    ['a time zone that does not exist', () => ({ timezone: 'Mars/Phobos' })],
    ['a UTC offset instead of a zone name', () => ({ timezone: '+01:00' })],
    ['a zone name in lowercase', () => ({ timezone: 'america/new_york' })],
    ['an empty time zone', () => ({ timezone: '' })],
    [
      'a time zone with extra text',
      () => ({ timezone: 'America/New_York; DROP' }),
    ],
    ['a householdId', () => ({ householdId: 'house-1' })],
    ['an unknown field', () => ({ days: 30 })],
  ])('rejects %s before any backend call', async (_name, extra) => {
    // A real session, so the rejection can only come from the input check.
    const sessionId = await signInViaTool(connection.client);
    const before = fake.requests.length;

    const outcome = await week({
      sessionId,
      lessonId: FAKE_LESSON_ID,
      ...extra(sessionId),
    })
      .then((result) => result.isError === true)
      .catch(() => true);

    expect(outcome).toBe(true);
    expect(fake.requests.length).toBe(before);
  });

  it('gives one short error for an unknown sign-in session, without calling the backend', async () => {
    const result = await week({
      sessionId: 'not-a-real-session',
      lessonId: FAKE_LESSON_ID,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Session not found, sign in again.');
    expect(fake.requests).toHaveLength(0);
  });

  it('refuses a role the backend would turn away, with the same message and no backend call', async () => {
    const sessionId = openSession(fake, connection.sessions, null, 'tutor');

    const result = await week({ sessionId, lessonId: FAKE_LESSON_ID });

    expect(textOf(result)).toBe(
      'Not allowed to access this learner or lesson.',
    );
    expect(lessonRequests(fake)).toEqual([]);
  });

  it("turns a backend 403 for someone else's lesson into the short message", async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await week({ sessionId, lessonId: FAKE_OTHER_LESSON_ID });

    expect(textOf(result)).toBe(
      'Not allowed to access this learner or lesson.',
    );
    expect(JSON.stringify(result)).not.toContain('access denied');
  });

  it('turns a backend 404 into a short message', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await week({ sessionId, lessonId: FAKE_UNKNOWN_LESSON_ID });

    expect(textOf(result)).toBe('Lesson not found.');
  });

  it.each([
    ['a lesson that is not scheduled', FAKE_COMPLETED_LESSON_ID],
    [
      'a scheduled lesson that is too close to its start',
      FAKE_LOCKED_LESSON_ID,
    ],
  ])(
    'says %s cannot be rescheduled, without backend text',
    async (_name, lessonId) => {
      const sessionId = await signInViaTool(connection.client);

      const result = await week({ sessionId, lessonId });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(
        'This lesson cannot be rescheduled (its status or timing does not allow it).',
      );
      expect(JSON.stringify(result)).not.toContain(
        'cannot reschedule this session',
      );
    },
  );

  it('refreshes through the call: 401, one refresh, then success', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.expireAccessTokens();

    const result = await week({ sessionId, lessonId: FAKE_LESSON_ID });

    expect(result.isError).toBeUndefined();
    expect(fake.refreshCalls).toBe(1);
    expect(
      fake.requests.map((request) => `${request.method} ${request.path}`),
    ).toEqual([WEEK, 'POST /api/v1/auth/refresh', WEEK]);
  });

  it('asks the user to sign in again when the refresh is refused', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.expireAccessTokens();
    fake.revokeRefreshTokens();

    const result = await week({ sessionId, lessonId: FAKE_LESSON_ID });

    expect(textOf(result)).toMatch(/ask the user to sign in again/i);
  });

  it('never puts a token or an email in any output or error', async () => {
    const sessionId = await signInViaTool(connection.client);
    const outputs = [
      await week({ sessionId, lessonId: FAKE_LESSON_ID }),
      await week({ sessionId: 'unknown', lessonId: FAKE_LESSON_ID }),
      await week({ sessionId, lessonId: FAKE_OTHER_LESSON_ID }),
    ];
    fake.expireAccessTokens();
    fake.revokeRefreshTokens();
    outputs.push(await week({ sessionId, lessonId: FAKE_LESSON_ID }));

    for (const output of outputs) {
      const text = JSON.stringify(output);
      expect(text).not.toContain(TOKEN_MARKER);
      expect(text).not.toContain(TUTOR_EMAIL_MARKER);
      expect(text).not.toMatch(/@/);
    }
  });
});
