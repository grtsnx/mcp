// Copied from tool.template.spec.ts. session_reschedule is a write tool: this file covers the
// propose step, which must never change anything; the confirm step is in the sibling spec.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sessionRescheduleTool } from '@/tools/session-reschedule/index.js';
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
  moveRequests,
  openSession,
  signInViaTool,
} from '../../helpers/household-fixtures.js';
import {
  connectTools,
  createClock,
  textOf,
} from '../../helpers/tool-harness.js';

const START = '2026-06-02T10:00:00-04:00';
const END = '2026-06-02T11:00:00-04:00';

describe('session_reschedule tool, step propose', () => {
  let connection: Awaited<ReturnType<typeof connectTools>>;
  let fake: FakeMssuize;
  let clock: ReturnType<typeof createClock>;

  beforeEach(async () => {
    fake = new FakeMssuize();
    clock = createClock();
    connection = await connectTools([sessionRescheduleTool], {
      backend: createFakeMssuizeApi(fake),
      now: clock.now,
    });
  });

  afterEach(async () => {
    await connection.close();
  });

  const reschedule = (arguments_: Record<string, unknown>) =>
    connection.client.callTool({
      name: 'session_reschedule',
      arguments: arguments_,
    });

  const propose = (
    sessionId: string,
    overrides: Record<string, unknown> = {},
  ) =>
    reschedule({
      step: 'propose',
      sessionId,
      lessonId: FAKE_LESSON_ID,
      newStart: START,
      newEnd: END,
      reason: 'Soccer practice moved',
      ...overrides,
    });

  it('is listed as one plain object, not read-only, not destructive, not idempotent', async () => {
    const { tools } = await connection.client.listTools();
    const tool = tools.find(
      (candidate) => candidate.name === 'session_reschedule',
    );
    const schema = tool?.inputSchema as Record<string, unknown>;

    expect(schema.type).toBe('object');
    expect(schema).not.toHaveProperty('oneOf');
    expect(schema).not.toHaveProperty('anyOf');
    expect(schema).toMatchObject({
      required: ['step'],
      additionalProperties: false,
    });
    expect(Object.keys((schema.properties ?? {}) as object).sort()).toEqual([
      'confirmationToken',
      'lessonId',
      'newEnd',
      'newStart',
      'reason',
      'step',
    ]);
    expect(tool?.outputSchema?.type).toBe('object');
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    });
  });

  it('tells the model to show the proposal and get an explicit yes, and never to confirm alone', async () => {
    const { tools } = await connection.client.listTools();
    const description =
      tools.find((candidate) => candidate.name === 'session_reschedule')
        ?.description ?? '';

    expect(description).toMatch(/explicit yes BEFORE calling step 'confirm'/);
    expect(description).toMatch(/never confirm on your own/);
    expect(description).toMatch(/NEVER retried/);
    expect(description).toMatch(/do not try again/);
    expect(description).toMatch(/session_get/);
    expect(description).toMatch(/comes from the request’s sign-in/);
  });

  it('proposes an offered time and returns a token, and changes NOTHING', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await propose(sessionId);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      status: 'proposed',
      confirmationToken: expect.stringMatching(/^[A-Za-z0-9_-]{43,}$/),
      lessonId: FAKE_LESSON_ID,
      learnerName: 'Byron Lovelace',
      subjects: ['Math', 'Science'],
      timezone: 'America/New_York',
      currentStart: '2026-06-01T10:00:00-04:00',
      currentEnd: '2026-06-01T11:00:00-04:00',
      currentWhenLocal: 'Monday 1 June 2026, 10:00 AM to 11:00 AM',
      newStart: START,
      newEnd: END,
      newWhenLocal: 'Tuesday 2 June 2026, 10:00 AM to 11:00 AM',
      durationMinutes: 60,
      reason: 'Soccer practice moved',
      expiresInSeconds: 300,
    });
    // Nothing was sent that could move the lesson, and the lesson is where it was.
    expect(moveRequests(fake)).toHaveLength(0);
    expect(
      fake.requests.filter(
        (request) =>
          request.method !== 'GET' &&
          !request.path.endsWith('/reschedule-preview') &&
          !request.path.startsWith('/api/v1/auth/'),
      ),
    ).toEqual([]);
    expect(fake.scheduling.timesOf(FAKE_LESSON_ID)).toEqual({
      start: '2026-06-01T14:00:00Z',
      end: '2026-06-01T15:00:00Z',
    });
  });

  it('only reads the lesson and previews the day', async () => {
    const sessionId = await signInViaTool(connection.client);

    await propose(sessionId);

    expect(lessonRequests(fake)).toEqual([
      `GET /api/v1/sessions/${FAKE_LESSON_ID}`,
      `POST /api/v1/sessions/${FAKE_LESSON_ID}/reschedule-preview`,
    ]);
    expect(fake.requests.at(-1)?.body).toEqual({ target_date: '2026-06-02' });
  });

  it('accepts the same instant written in another offset, and previews the family’s date', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.requests.length = 0;

    // 10:00 in New York on 2 June, written in an offset where it is already 3 June.
    const result = await propose(sessionId, {
      newStart: '2026-06-03T04:00:00+14:00',
      newEnd: '2026-06-03T05:00:00+14:00',
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      status: 'proposed',
      newStart: START,
      newEnd: END,
    });
    const previews = fake.requests.filter((request) =>
      request.path.endsWith('/reschedule-preview'),
    );
    expect(
      previews.map(
        (request) => (request.body as { target_date: string }).target_date,
      ),
    ).toEqual(['2026-06-03', '2026-06-02']);
  });

  it('trims the reason', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await propose(sessionId, { reason: '  Exam on Monday  ' });

    expect(result.structuredContent).toMatchObject({
      reason: 'Exam on Monday',
    });
  });

  it.each([
    [
      'a time that is not an offered slot',
      {
        newStart: '2026-06-02T10:30:00-04:00',
        newEnd: '2026-06-02T11:30:00-04:00',
      },
      /not one of the offered times/,
    ],
    [
      'the right start with the wrong length',
      { newEnd: '2026-06-02T10:45:00-04:00' },
      /length of 60 minutes/,
    ],
    [
      'an end that is not after the start',
      { newEnd: START },
      /end time must be after the start time/,
    ],
    [
      'an end before the start',
      { newEnd: '2026-06-02T09:00:00-04:00' },
      /end time must be after the start time/,
    ],
    [
      'a time on a day with no offered slots at that hour',
      {
        newStart: '2026-06-02T12:00:00-04:00',
        newEnd: '2026-06-02T13:00:00-04:00',
      },
      /not one of the offered times/,
    ],
  ])(
    'refuses %s, with a short reason, and nothing is proposed or sent',
    async (_name, overrides, reason) => {
      const sessionId = await signInViaTool(connection.client);

      const result = await propose(sessionId, overrides);

      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(reason);
      expect(moveRequests(fake)).toHaveLength(0);
    },
  );

  it('says a time is not offered without inventing any slots', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await propose(sessionId, {
      newStart: '2026-06-02T10:30:00-04:00',
      newEnd: '2026-06-02T11:30:00-04:00',
    });

    expect(textOf(result)).toMatch(/session_reschedule_options_/);
    expect(textOf(result)).not.toMatch(/\d{2}:\d{2}|2026/);
  });

  it('refuses a lesson that is not scheduled', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await propose(sessionId, {
      lessonId: FAKE_COMPLETED_LESSON_ID,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'This lesson is not scheduled, so it cannot be moved.',
    );
    expect(lessonRequests(fake)).toEqual([
      `GET /api/v1/sessions/${FAKE_COMPLETED_LESSON_ID}`,
    ]);
  });

  it('refuses a scheduled lesson whose canReschedule is false, before any preview', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await propose(sessionId, {
      lessonId: FAKE_LOCKED_LESSON_ID,
    });

    expect(textOf(result)).toBe(
      'This lesson cannot be rescheduled (its status or timing does not allow it).',
    );
    expect(lessonRequests(fake)).toEqual([
      `GET /api/v1/sessions/${FAKE_LOCKED_LESSON_ID}`,
    ]);
  });

  it.each([
    ['no step', () => ({ step: undefined })],
    ['an unknown step', () => ({ step: 'cancel' })],
    ['no lessonId', () => ({ lessonId: undefined })],
    ['a lessonId that is not a UUID', () => ({ lessonId: 'not-a-uuid' })],
    [
      'a lessonId that is the sign-in handle',
      (sessionId: string) => ({ lessonId: sessionId }),
    ],
    ['no newStart', () => ({ newStart: undefined })],
    ['no newEnd', () => ({ newEnd: undefined })],
    ['a newStart with no offset', () => ({ newStart: '2026-06-02T10:00:00' })],
    ['a newEnd that is only a date', () => ({ newEnd: '2026-06-02' })],
    ['a newStart in words', () => ({ newStart: 'tomorrow at ten' })],
    ['no reason', () => ({ reason: undefined })],
    ['an empty reason', () => ({ reason: '' })],
    ['a reason of only spaces', () => ({ reason: '    ' })],
    ['a reason of 501 characters', () => ({ reason: 'x'.repeat(501) })],
    [
      'a confirmationToken while proposing',
      () => ({ confirmationToken: 'abc' }),
    ],
    ['a force field', () => ({ force: true })],
    ['a householdId', () => ({ householdId: 'house-1' })],
    ['an unknown field', () => ({ notify: false })],
  ])('rejects %s before any backend call', async (_name, change) => {
    // A real session, so the rejection can only come from the input check.
    const sessionId = await signInViaTool(connection.client);
    const before = fake.requests.length;

    const outcome = await propose(sessionId, change(sessionId))
      .then((result) => result.isError === true)
      .catch(() => true);

    expect(outcome).toBe(true);
    expect(fake.requests.length).toBe(before);
  });

  it('accepts a reason of exactly 500 characters', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await propose(sessionId, { reason: 'x'.repeat(500) });

    expect(result.isError).toBeUndefined();
  });

  it('gives one short error for an unknown sign-in session, without calling the backend', async () => {
    const result = await propose('not-a-real-session');

    expect(textOf(result)).toBe('Session not found, sign in again.');
    expect(fake.requests).toHaveLength(0);
  });

  it('refuses a role the backend would turn away, with a short message and no backend call', async () => {
    const sessionId = openSession(fake, connection.sessions, null, 'tutor');

    const result = await propose(sessionId);

    expect(textOf(result)).toBe('Not allowed to change this lesson.');
    expect(lessonRequests(fake)).toEqual([]);
  });

  it("turns a backend 403 for someone else's lesson into the short message", async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await propose(sessionId, { lessonId: FAKE_OTHER_LESSON_ID });

    expect(textOf(result)).toBe('Not allowed to change this lesson.');
    expect(JSON.stringify(result)).not.toContain('access denied');
  });

  it('turns a backend 404 into a short message', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await propose(sessionId, {
      lessonId: FAKE_UNKNOWN_LESSON_ID,
    });

    expect(textOf(result)).toBe('Lesson not found.');
  });

  it('refreshes through the reads: 401, one refresh, then a proposal', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.expireAccessTokens();

    const result = await propose(sessionId);

    expect(result.structuredContent).toMatchObject({ status: 'proposed' });
    expect(fake.refreshCalls).toBe(1);
    expect(moveRequests(fake)).toHaveLength(0);
  });

  it('never puts a token, an email or a backend text in any output or error', async () => {
    const sessionId = await signInViaTool(connection.client);
    const outputs = [
      await propose(sessionId),
      await propose('unknown'),
      await propose(sessionId, { lessonId: FAKE_OTHER_LESSON_ID }),
      await propose(sessionId, { lessonId: FAKE_COMPLETED_LESSON_ID }),
    ];

    for (const output of outputs) {
      const text = JSON.stringify(output);
      for (const secret of [
        TOKEN_MARKER,
        TUTOR_EMAIL_MARKER,
        FAKE_TUTOR_ID,
        'access denied',
        'cannot reschedule this session',
      ]) {
        expect(text).not.toContain(secret);
      }
      expect(text).not.toMatch(/@/);
    }
  });
});
