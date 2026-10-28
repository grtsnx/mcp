// Copied from tool.template.spec.ts: listing, a happy path, bad input, errors, no secrets.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sessionRescheduleOptionsDayTool } from '@/tools/session-reschedule-options-day/index.js';
import {
  FakeMssuize,
  TOKEN_MARKER,
  createFakeMssuizeApi,
} from '../../helpers/fake-mssuize.js';
import {
  FAKE_COMPLETED_LESSON_ID,
  FAKE_LESSON_ID,
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

const PREVIEW = `POST /api/v1/sessions/${FAKE_LESSON_ID}/reschedule-preview`;

describe('session_reschedule_options_day tool', () => {
  let connection: Awaited<ReturnType<typeof connectTools>>;
  let fake: FakeMssuize;
  let clock: ReturnType<typeof createClock>;

  beforeEach(async () => {
    fake = new FakeMssuize();
    clock = createClock();
    connection = await connectTools([sessionRescheduleOptionsDayTool], {
      backend: createFakeMssuizeApi(fake),
      now: clock.now,
    });
  });

  afterEach(async () => {
    await connection.close();
  });

  const options = (arguments_: Record<string, unknown>) =>
    connection.client.callTool({
      name: 'session_reschedule_options_day',
      arguments: arguments_,
    });

  const previewBody = () =>
    fake.requests
      .filter((request) => request.path.endsWith('/reschedule-preview'))
      .at(-1)?.body;

  it('is listed read-only, says it only previews, and has strict inputs', async () => {
    const { tools } = await connection.client.listTools();
    const tool = tools.find(
      (candidate) => candidate.name === 'session_reschedule_options_day',
    );

    expect(tool?.inputSchema).toMatchObject({
      type: 'object',
      required: ['lessonId', 'targetDate'],
      additionalProperties: false,
    });
    expect(Object.keys(tool?.inputSchema.properties ?? {}).sort()).toEqual([
      'lessonId',
      'targetDate',
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

  it('returns the free slots, the current time and the length, and sends no timezone when none is given', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await options({
      sessionId,
      lessonId: FAKE_LESSON_ID,
      targetDate: '2026-06-02',
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      lessonId: FAKE_LESSON_ID,
      targetDate: '2026-06-02',
      targetDateLocal: 'Tuesday 2 June 2026',
      timezone: 'America/New_York',
      durationMinutes: 60,
      currentStart: '2026-06-01T10:00:00-04:00',
      currentEnd: '2026-06-01T11:00:00-04:00',
      currentWhenLocal: 'Monday 1 June 2026, 10:00 AM to 11:00 AM',
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
    expect(lessonRequests(fake)).toEqual([PREVIEW]);
    // The backend then picks the family's own zone.
    expect(previewBody()).toEqual({ target_date: '2026-06-02' });
  });

  it('sends the timezone it was given and shows the slots in that zone', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await options({
      sessionId,
      lessonId: FAKE_LESSON_ID,
      targetDate: '2026-06-02',
      timezone: 'Africa/Lagos',
    });

    expect(previewBody()).toEqual({
      target_date: '2026-06-02',
      timezone: 'Africa/Lagos',
    });
    expect(result.structuredContent).toMatchObject({
      timezone: 'Africa/Lagos',
      currentStart: '2026-06-01T15:00:00+01:00',
      currentWhenLocal: 'Monday 1 June 2026, 3:00 PM to 4:00 PM',
      slots: [
        {
          start: '2026-06-02T10:00:00+01:00',
          whenLocal: 'Tuesday 2 June 2026, 10:00 AM to 11:00 AM',
        },
        {
          start: '2026-06-02T15:00:00+01:00',
          whenLocal: 'Tuesday 2 June 2026, 3:00 PM to 4:00 PM',
        },
      ],
    });
  });

  it('works out the length from the current times when the backend reports 0', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.scheduling.previewDurationMinutes = 0;

    const result = await options({
      sessionId,
      lessonId: FAKE_LESSON_ID,
      targetDate: '2026-06-02',
    });

    expect(result.structuredContent).toMatchObject({ durationMinutes: 60 });
  });

  it('never returns the tutor id or name, or the learner name', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await options({
      sessionId,
      lessonId: FAKE_LESSON_ID,
      targetDate: '2026-06-02',
    });
    const text = JSON.stringify(result);

    expect(text).not.toContain(FAKE_TUTOR_ID);
    expect(text).not.toContain('Grace');
    expect(text).not.toContain('Hopper');
    expect(text).not.toContain('Byron');
    expect(text).not.toMatch(
      /tutor_id|tutor_name|learner_name|learner_id|session_id/,
    );
    expect(text).not.toContain(TOKEN_MARKER);
  });

  it.each([
    ['a leap day in a leap year', { targetDate: '2028-02-29' }],
    ['the UTC time zone', { targetDate: '2026-06-02', timezone: 'UTC' }],
    [
      'an Area/Location time zone',
      { targetDate: '2026-06-02', timezone: 'America/New_York' },
    ],
    [
      'a three-part time zone',
      { targetDate: '2026-06-02', timezone: 'America/Argentina/Buenos_Aires' },
    ],
  ])('accepts %s', async (_name, extra) => {
    const sessionId = await signInViaTool(connection.client);

    const result = await options({
      sessionId,
      lessonId: FAKE_LESSON_ID,
      ...extra,
    });

    expect(result.isError).toBeUndefined();
  });

  it.each([
    [
      'a date that does not exist (30 February)',
      () => ({ targetDate: '2026-02-30' }),
    ],
    [
      '29 February in a year that is not a leap year',
      () => ({ targetDate: '2026-02-29' }),
    ],
    ['month 13', () => ({ targetDate: '2026-13-01' })],
    ['a date written with slashes', () => ({ targetDate: '06/02/2026' })],
    ['a date without zero padding', () => ({ targetDate: '2026-6-2' })],
    [
      'a date with a time on it',
      () => ({ targetDate: '2026-06-02T10:00:00Z' }),
    ],
    ['a date in words', () => ({ targetDate: 'tomorrow' })],
    ['an empty date', () => ({ targetDate: '' })],
    ['no date', () => ({ targetDate: undefined })],
    ['a time zone that does not exist', () => ({ timezone: 'Mars/Phobos' })],
    ['a UTC offset instead of a zone name', () => ({ timezone: '+01:00' })],
    ['a zone name in lowercase', () => ({ timezone: 'america/new_york' })],
    ['an empty time zone', () => ({ timezone: '' })],
    [
      'a time zone with extra text',
      () => ({ timezone: 'America/New_York; DROP TABLE' }),
    ],
    [
      'a time zone that is far too long',
      () => ({ timezone: `America/${'A'.repeat(70)}` }),
    ],
    ['a time zone that is not a string', () => ({ timezone: 5 })],
    ['a lessonId that is not a UUID', () => ({ lessonId: 'not-a-uuid' })],
    [
      'a lessonId that is the sign-in handle',
      (sessionId: string) => ({ lessonId: sessionId }),
    ],
    ['a householdId', () => ({ householdId: 'house-1' })],
    ['an unknown field', () => ({ moveIt: true })],
  ])('rejects %s before any backend call', async (_name, extra) => {
    // A real session, so the rejection can only come from the input check.
    const sessionId = await signInViaTool(connection.client);
    const before = fake.requests.length;

    const outcome = await options({
      sessionId,
      lessonId: FAKE_LESSON_ID,
      targetDate: '2026-06-02',
      ...extra(sessionId),
    })
      .then((result) => result.isError === true)
      .catch(() => true);

    expect(outcome).toBe(true);
    expect(fake.requests.length).toBe(before);
  });

  it('gives one short error for an unknown sign-in session, without calling the backend', async () => {
    const result = await options({
      sessionId: 'not-a-real-session',
      lessonId: FAKE_LESSON_ID,
      targetDate: '2026-06-02',
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Session not found, sign in again.');
    expect(fake.requests).toHaveLength(0);
  });

  it('refuses a role the backend would turn away, with the same message and no backend call', async () => {
    const sessionId = openSession(fake, connection.sessions, null, 'tutor');

    const result = await options({
      sessionId,
      lessonId: FAKE_LESSON_ID,
      targetDate: '2026-06-02',
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'Not allowed to access this learner or lesson.',
    );
    expect(lessonRequests(fake)).toEqual([]);
  });

  it("turns a backend 403 for someone else's lesson into the short message", async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await options({
      sessionId,
      lessonId: FAKE_OTHER_LESSON_ID,
      targetDate: '2026-06-02',
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'Not allowed to access this learner or lesson.',
    );
    expect(JSON.stringify(result)).not.toContain('access denied');
  });

  it('turns a backend 404 into a short message', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await options({
      sessionId,
      lessonId: FAKE_UNKNOWN_LESSON_ID,
      targetDate: '2026-06-02',
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Lesson not found.');
  });

  it('turns a backend 400 into the short date message, without the backend body', async () => {
    const sessionId = await signInViaTool(connection.client);

    // The backend also answers 400 when a lesson cannot be moved, such as one already completed.
    const result = await options({
      sessionId,
      lessonId: FAKE_COMPLETED_LESSON_ID,
      targetDate: '2026-06-02',
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('That date is not valid.');
    expect(JSON.stringify(result)).not.toContain('cannot reschedule');
  });

  it('refreshes through the call: 401, one refresh, then success', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.expireAccessTokens();

    const result = await options({
      sessionId,
      lessonId: FAKE_LESSON_ID,
      targetDate: '2026-06-02',
    });

    expect(result.isError).toBeUndefined();
    expect(fake.refreshCalls).toBe(1);
    expect(
      fake.requests.map((request) => `${request.method} ${request.path}`),
    ).toEqual([PREVIEW, 'POST /api/v1/auth/refresh', PREVIEW]);
  });

  it('asks the user to sign in again when the refresh is refused', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.expireAccessTokens();
    fake.revokeRefreshTokens();

    const result = await options({
      sessionId,
      lessonId: FAKE_LESSON_ID,
      targetDate: '2026-06-02',
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/ask the user to sign in again/i);
  });

  it('never puts a token or an email in any output or error', async () => {
    const sessionId = await signInViaTool(connection.client);
    const arguments_ = { lessonId: FAKE_LESSON_ID, targetDate: '2026-06-02' };
    const outputs = [
      await options({ sessionId, ...arguments_ }),
      await options({ sessionId: 'unknown', ...arguments_ }),
      await options({
        sessionId,
        ...arguments_,
        lessonId: FAKE_OTHER_LESSON_ID,
      }),
    ];
    fake.expireAccessTokens();
    fake.revokeRefreshTokens();
    outputs.push(await options({ sessionId, ...arguments_ }));

    for (const output of outputs) {
      const text = JSON.stringify(output);
      expect(text).not.toContain(TOKEN_MARKER);
      expect(text).not.toContain(TUTOR_EMAIL_MARKER);
      expect(text).not.toMatch(/@/);
    }
  });
});
