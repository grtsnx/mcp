// Copied from tool.template.spec.ts: listing, a happy path, bad input, errors, no secrets.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sessionGetTool } from '@/tools/session-get/index.js';
import {
  FakeMssuize,
  TOKEN_MARKER,
  createFakeMssuizeApi,
} from '../../helpers/fake-mssuize.js';
import {
  FAKE_ACTOR_ID,
  FAKE_COMPLETED_LESSON_ID,
  FAKE_LEARNER_ID,
  FAKE_LESSON_ID,
  FAKE_OTHER_LESSON_ID,
  FAKE_TUTOR_ID,
  FAKE_UNKNOWN_LESSON_ID,
  MEETING_MARKER,
  PAYLOAD_MARKER,
  SIGNED_LINK_MARKER,
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

type LessonBody = {
  lesson: Record<string, unknown>;
  tutor: Record<string, unknown>;
  learner: Record<string, unknown>;
  recentEvents: {
    eventType: string;
    occurredAt: string;
    actorRole: string | null;
  }[];
};

describe('session_get tool', () => {
  let connection: Awaited<ReturnType<typeof connectTools>>;
  let fake: FakeMssuize;
  let clock: ReturnType<typeof createClock>;

  beforeEach(async () => {
    fake = new FakeMssuize();
    clock = createClock();
    connection = await connectTools([sessionGetTool], {
      backend: createFakeMssuizeApi(fake),
      now: clock.now,
    });
  });

  afterEach(async () => {
    await connection.close();
  });

  const get = (arguments_: Record<string, unknown>) =>
    connection.client.callTool({ name: 'session_get', arguments: arguments_ });

  const bodyOf = (result: object): LessonBody =>
    (result as { structuredContent: unknown }).structuredContent as LessonBody;

  it('is listed read-only, with strict sessionId and lessonId inputs', async () => {
    const { tools } = await connection.client.listTools();
    const tool = tools.find((candidate) => candidate.name === 'session_get');

    expect(tool?.inputSchema).toMatchObject({
      type: 'object',
      required: ['lessonId'],
      additionalProperties: false,
    });
    expect(Object.keys(tool?.inputSchema.properties ?? {}).sort()).toEqual([
      'lessonId',
    ]);
    expect(tool?.outputSchema?.type).toBe('object');
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(tool?.description).toMatch(/lessonId/);
    expect(tool?.description).toMatch(/comes from the request’s sign-in/);
  });

  it('returns the lesson, the two people and the newest ten events, with the length worked out', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await get({ sessionId, lessonId: FAKE_LESSON_ID });
    const body = bodyOf(result);

    expect(result.isError).toBeUndefined();
    expect(body.lesson).toEqual({
      lessonId: FAKE_LESSON_ID,
      learnerId: FAKE_LEARNER_ID,
      subjects: ['Math', 'Science'],
      scheduledStart: '2026-06-01T14:00:00Z',
      scheduledEnd: '2026-06-01T15:00:00Z',
      whenLocal: 'Monday 1 June 2026, 10:00 AM to 11:00 AM',
      durationMinutes: 60,
      status: 'scheduled',
      canReschedule: true,
      canCancel: true,
    });
    expect(bodyOf(result)).toMatchObject({ timezone: 'America/New_York' });
    expect(body.tutor).toEqual({ firstName: 'Grace', lastName: 'Hopper' });
    expect(body.learner).toEqual({ firstName: 'Byron', lastName: 'Lovelace' });
    expect(JSON.stringify(result)).not.toMatch(/"durationMinutes":0\b/);
  });

  it('computes the length from the times for a shorter lesson too', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await get({ sessionId, lessonId: FAKE_COMPLETED_LESSON_ID });

    expect(bodyOf(result).lesson).toMatchObject({
      durationMinutes: 45,
      status: 'completed',
      canReschedule: false,
    });
  });

  it('keeps the 10 most recent events, newest first, although the backend sends oldest first', async () => {
    const sessionId = await signInViaTool(connection.client);

    const { recentEvents } = bodyOf(
      await get({ sessionId, lessonId: FAKE_LESSON_ID }),
    );

    expect(recentEvents).toHaveLength(10);
    expect(recentEvents.map((event) => event.eventType)).toEqual([
      'event_11',
      'event_10',
      'event_9',
      'event_8',
      'event_7',
      'event_6',
      'event_5',
      'event_4',
      'event_3',
      'event_2',
    ]);
    expect(Object.keys(recentEvents[0]!).sort()).toEqual([
      'actorRole',
      'eventType',
      'occurredAt',
    ]);
    expect(recentEvents[0]).toMatchObject({ actorRole: 'system' });
  });

  it('never returns the tutor email or id, signed links, actor ids, event payloads or meeting fields', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await get({ sessionId, lessonId: FAKE_LESSON_ID });
    const text = JSON.stringify(result);

    for (const secret of [
      TUTOR_EMAIL_MARKER,
      SIGNED_LINK_MARKER,
      FAKE_TUTOR_ID,
      FAKE_ACTOR_ID,
      PAYLOAD_MARKER,
      MEETING_MARKER,
      TOKEN_MARKER,
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toMatch(
      /"(email|identity_photo_url|tutorId|actor_id|actorId|payload|meetingProvider|meetingUrl|session_id|created_at)"/,
    );
    expect(text).not.toMatch(/@/);
  });

  it('calls only GET /sessions/{lessonId}, without needing a household', async () => {
    const sessionId = openSession(fake, connection.sessions, null);

    const result = await get({ sessionId, lessonId: FAKE_LESSON_ID });

    expect(result.isError).toBeUndefined();
    expect(lessonRequests(fake)).toEqual([
      `GET /api/v1/sessions/${FAKE_LESSON_ID}`,
    ]);
  });

  it.each([
    ['a lessonId that is not a UUID', () => ({ lessonId: 'not-a-uuid' })],
    [
      'a lessonId that is the sign-in handle',
      (sessionId: string) => ({ lessonId: sessionId }),
    ],
    ['no lessonId', () => ({ lessonId: undefined })],
    ['an empty lessonId', () => ({ lessonId: '' })],
    ['a lessonId that is not a string', () => ({ lessonId: 7 })],
    ['a householdId', () => ({ householdId: 'house-1' })],
    ['an unknown field', () => ({ includeTutorEmail: true })],
  ])('rejects %s before any backend call', async (_name, extra) => {
    // A real session, so the rejection can only come from the input check.
    const sessionId = await signInViaTool(connection.client);
    const before = fake.requests.length;

    const outcome = await get({
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
    const result = await get({
      sessionId: 'not-a-real-session',
      lessonId: FAKE_LESSON_ID,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Session not found, sign in again.');
    expect(fake.requests).toHaveLength(0);
  });

  it('refuses a role the backend would turn away, with the same message and no backend call', async () => {
    // The backend itself lets an assigned tutor read their own lesson, so the role is checked here.
    const sessionId = openSession(fake, connection.sessions, null, 'tutor');

    const result = await get({ sessionId, lessonId: FAKE_LESSON_ID });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'Not allowed to access this learner or lesson.',
    );
    expect(lessonRequests(fake)).toEqual([]);
  });

  it("turns a backend 403 for someone else's lesson into the short message, without the backend body", async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await get({ sessionId, lessonId: FAKE_OTHER_LESSON_ID });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'Not allowed to access this learner or lesson.',
    );
    expect(JSON.stringify(result)).not.toContain('access denied');
  });

  it('turns a backend 404 into a short message', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await get({ sessionId, lessonId: FAKE_UNKNOWN_LESSON_ID });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Lesson not found.');
    expect(JSON.stringify(result)).not.toContain('session not found');
  });

  it('shows the 500 the real backend gives for an unknown lesson as a clean outage message', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.scheduling.unknownLessonStatus = 500;

    const result = await get({ sessionId, lessonId: FAKE_UNKNOWN_LESSON_ID });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/unavailable/i);
    expect(JSON.stringify(result)).not.toContain('session not found');
  });

  it('gives the same short message when the scheduling routes answer 403 for the role', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.scheduling.forbidden = true;

    const result = await get({ sessionId, lessonId: FAKE_LESSON_ID });

    expect(textOf(result)).toBe(
      'Not allowed to access this learner or lesson.',
    );
  });

  it('refreshes through the call: 401, one refresh, then success', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.expireAccessTokens();

    const result = await get({ sessionId, lessonId: FAKE_LESSON_ID });

    expect(result.isError).toBeUndefined();
    expect(fake.refreshCalls).toBe(1);
    expect(
      fake.requests.map((request) => `${request.method} ${request.path}`),
    ).toEqual([
      `GET /api/v1/sessions/${FAKE_LESSON_ID}`,
      'POST /api/v1/auth/refresh',
      `GET /api/v1/sessions/${FAKE_LESSON_ID}`,
      'GET /api/v1/households/me',
    ]);
  });

  it('asks the user to sign in again when the refresh is refused', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.expireAccessTokens();
    fake.revokeRefreshTokens();

    const result = await get({ sessionId, lessonId: FAKE_LESSON_ID });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/ask the user to sign in again/i);
  });

  it('never puts a token or an email in any output or error', async () => {
    const sessionId = await signInViaTool(connection.client);
    const outputs = [
      await get({ sessionId, lessonId: FAKE_LESSON_ID }),
      await get({ sessionId: 'unknown', lessonId: FAKE_LESSON_ID }),
      await get({ sessionId, lessonId: FAKE_OTHER_LESSON_ID }),
    ];
    fake.expireAccessTokens();
    fake.revokeRefreshTokens();
    outputs.push(await get({ sessionId, lessonId: FAKE_LESSON_ID }));

    for (const output of outputs) {
      const text = JSON.stringify(output);
      expect(text).not.toContain(TOKEN_MARKER);
      expect(text).not.toContain(TUTOR_EMAIL_MARKER);
      expect(text).not.toMatch(/@/);
    }
  });
});
