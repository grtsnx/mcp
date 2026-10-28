// Copied from tool.template.spec.ts: listing, a happy path, bad input, errors, no secrets.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { learnerSessionsListTool } from '@/tools/learner-sessions-list/index.js';
import {
  FAKE_ACTOR_ID,
  FAKE_LEARNER_ID,
  FAKE_OTHER_LEARNER_ID,
  FAKE_TUTOR_ID,
  FAKE_UNKNOWN_LEARNER_ID,
  MEETING_MARKER,
  SIGNED_LINK_MARKER,
  TUTOR_EMAIL_MARKER,
  fakeLessons,
} from '../../helpers/fake-scheduling.js';
import {
  FakeMssuize,
  TOKEN_MARKER,
  createFakeMssuizeApi,
} from '../../helpers/fake-mssuize.js';
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

const BASE = `GET /api/v1/households/house-1/learners/${FAKE_LEARNER_ID}/scheduled-sessions`;

describe('learner_sessions_list tool', () => {
  let connection: Awaited<ReturnType<typeof connectTools>>;
  let fake: FakeMssuize;
  let clock: ReturnType<typeof createClock>;

  beforeEach(async () => {
    fake = new FakeMssuize();
    clock = createClock();
    connection = await connectTools([learnerSessionsListTool], {
      backend: createFakeMssuizeApi(fake),
      now: clock.now,
    });
  });

  afterEach(async () => {
    await connection.close();
  });

  const list = (arguments_: Record<string, unknown>) =>
    connection.client.callTool({
      name: 'learner_sessions_list',
      arguments: arguments_,
    });

  const lessonsOf = (result: object) =>
    (
      (result as { structuredContent: unknown }).structuredContent as {
        lessons: Record<string, unknown>[];
        totalCount: number;
        page: number;
        pageSize: number;
      }
    ).lessons;

  it('is listed read-only, with a strict input that has no householdId', async () => {
    const { tools } = await connection.client.listTools();
    const tool = tools.find(
      (candidate) => candidate.name === 'learner_sessions_list',
    );
    const properties = (tool?.inputSchema.properties ?? {}) as Record<
      string,
      { enum?: string[]; minimum?: number; maximum?: number; default?: number }
    >;

    expect(tool?.inputSchema).toMatchObject({
      type: 'object',
      required: ['learnerId'],
      additionalProperties: false,
    });
    expect(Object.keys(properties).sort()).toEqual([
      'learnerId',
      'page',
      'pageSize',
      'startAfter',
      'startBefore',
      'status',
    ]);
    expect(properties.status?.enum).toEqual([
      'scheduled',
      'in_progress',
      'completed',
      'cancelled',
      'no_show',
    ]);
    expect(properties.pageSize).toMatchObject({
      minimum: 1,
      maximum: 50,
      default: 20,
    });
    expect(properties.page?.minimum).toBe(0);
    expect(tool?.outputSchema?.type).toBe('object');
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(tool?.description).toMatch(/lessonId/);
    expect(tool?.description).toMatch(/comes from the request’s sign-in/);
  });

  it('returns the lessons with only the allowed fields and the length worked out from the times', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await list({ sessionId, learnerId: FAKE_LEARNER_ID });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      timezone: 'America/New_York',
      lessons: [
        {
          lessonId: fakeLessons[0]!.id,
          tutorName: 'Grace Hopper',
          learnerName: 'Byron Lovelace',
          subjects: ['Math', 'Science'],
          scheduledStart: '2026-06-01T14:00:00Z',
          scheduledEnd: '2026-06-01T15:00:00Z',
          whenLocal: 'Monday 1 June 2026, 10:00 AM to 11:00 AM',
          durationMinutes: 60,
          status: 'scheduled',
          canReschedule: true,
          canCancel: true,
        },
        expect.objectContaining({
          durationMinutes: 45,
          status: 'completed',
          canReschedule: false,
        }),
        expect.objectContaining({
          durationMinutes: 30,
          status: 'cancelled',
          canCancel: false,
        }),
      ],
      totalCount: 3,
      page: 0,
      pageSize: 20,
    });
    expect(JSON.stringify(result)).not.toMatch(/"durationMinutes":0\b/);
  });

  it('never returns signed links, tutor ids or emails, or video and meeting fields', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await list({ sessionId, learnerId: FAKE_LEARNER_ID });
    const text = JSON.stringify(result);

    for (const secret of [
      SIGNED_LINK_MARKER,
      MEETING_MARKER,
      FAKE_TUTOR_ID,
      FAKE_ACTOR_ID,
      TUTOR_EMAIL_MARKER,
      TOKEN_MARKER,
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toMatch(
      /tutorId|tutorVerificationPhotoUrl|meetingProvider|videoProvider|meetingUrl|tutorFirstName/,
    );
    expect(text).not.toMatch(/@/);
  });

  it('asks the backend for the household stored in the session and always sends a page size', async () => {
    const sessionId = await signInViaTool(connection.client);

    await list({ sessionId, learnerId: FAKE_LEARNER_ID });

    expect(lessonRequests(fake)).toEqual([`${BASE}?page_size=20`]);
  });

  it('passes the filters to the backend and returns the filtered lessons', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await list({
      sessionId,
      learnerId: FAKE_LEARNER_ID,
      status: 'scheduled',
      startAfter: '2026-05-31T00:00:00Z',
      startBefore: '2026-06-02T00:00:00+01:00',
      page: 0,
      pageSize: 5,
    });

    expect(lessonsOf(result).map((lesson) => lesson.status)).toEqual([
      'scheduled',
    ]);
    const [request] = lessonRequests(fake);
    const params = new URL(request!.split(' ')[1]!, 'http://x').searchParams;
    expect(Object.fromEntries(params)).toEqual({
      page: '0',
      page_size: '5',
      status: 'scheduled',
      start_after: '2026-05-31T00:00:00Z',
      start_before: '2026-06-02T00:00:00+01:00',
    });
  });

  it('pages through the lessons', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.scheduling.lessons = Array.from({ length: 25 }, (_, index) => ({
      ...fakeLessons[0]!,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    }));

    const result = await list({
      sessionId,
      learnerId: FAKE_LEARNER_ID,
      page: 1,
      pageSize: 10,
    });

    expect(lessonsOf(result)).toHaveLength(10);
    expect(result.structuredContent).toMatchObject({
      totalCount: 25,
      page: 1,
      pageSize: 10,
    });
  });

  it('returns an empty list, in an object, when the backend sends null for none', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await list({
      sessionId,
      learnerId: FAKE_LEARNER_ID,
      status: 'no_show',
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      timezone: 'America/New_York',
      lessons: [],
      totalCount: 0,
      page: 0,
      pageSize: 20,
    });
  });

  it.each([
    ['the smallest page size', { pageSize: 1 }],
    ['the largest page size', { pageSize: 50 }],
    ['page zero', { page: 0 }],
    [
      'a UTC offset on a date filter',
      { startAfter: '2026-06-01T10:00:00+01:00' },
    ],
    [
      'fractional seconds on a date filter',
      { startBefore: '2026-06-01T10:00:00.250Z' },
    ],
  ])('accepts %s', async (_name, extra) => {
    const sessionId = await signInViaTool(connection.client);

    const result = await list({
      sessionId,
      learnerId: FAKE_LEARNER_ID,
      ...extra,
    });

    expect(result.isError).toBeUndefined();
  });

  it.each([
    ['a learnerId that is not a UUID', () => ({ learnerId: 'not-a-uuid' })],
    [
      'a learnerId with the dashes removed',
      () => ({ learnerId: FAKE_LEARNER_ID.replaceAll('-', '') }),
    ],
    ['no learnerId', () => ({ learnerId: undefined })],
    ['an unknown status', () => ({ status: 'pending' })],
    ['a status in the wrong case', () => ({ status: 'Scheduled' })],
    ['the backend word canceled for cancelled', () => ({ status: 'canceled' })],
    ['a startAfter that is only a date', () => ({ startAfter: '2026-06-01' })],
    [
      'a startAfter with no offset',
      () => ({ startAfter: '2026-06-01T10:00:00' }),
    ],
    ['a startBefore in words', () => ({ startBefore: 'tomorrow' })],
    ['a negative page', () => ({ page: -1 })],
    ['a fractional page', () => ({ page: 1.5 })],
    ['a page size of 0', () => ({ pageSize: 0 })],
    ['a page size of 51', () => ({ pageSize: 51 })],
    ['a page size that is not a number', () => ({ pageSize: 'ten' })],
    ['a householdId', () => ({ householdId: 'house-2' })],
    ['an unknown field', () => ({ includeNames: true })],
  ])('rejects %s before any backend call', async (_name, extra) => {
    // A real session, so the rejection can only come from the input check.
    const sessionId = await signInViaTool(connection.client);
    const before = fake.requests.length;

    const outcome = await list({
      sessionId,
      learnerId: FAKE_LEARNER_ID,
      ...extra(),
    })
      .then((result) => result.isError === true)
      .catch(() => true);

    expect(outcome).toBe(true);
    expect(fake.requests.length).toBe(before);
  });

  it('gives one short error for an unknown sign-in session, without calling the backend', async () => {
    const result = await list({
      sessionId: 'not-a-real-session',
      learnerId: FAKE_LEARNER_ID,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Session not found, sign in again.');
    expect(fake.requests).toHaveLength(0);
  });

  it('refuses a role the backend would turn away, with the same message and no backend call', async () => {
    const sessionId = openSession(fake, connection.sessions, null, 'tutor');

    const result = await list({ sessionId, learnerId: FAKE_LEARNER_ID });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'Not allowed to access this learner or lesson.',
    );
    expect(lessonRequests(fake)).toEqual([]);
  });

  it.each(['guardian', 'delegate', 'admin'])(
    'lets the %s role through',
    async (role) => {
      const sessionId = openSession(fake, connection.sessions, 'house-1', role);

      const result = await list({ sessionId, learnerId: FAKE_LEARNER_ID });

      expect(result.isError).toBeUndefined();
    },
  );

  it('gives a short error when a guardian session has no household', async () => {
    const sessionId = openSession(fake, connection.sessions, null);

    const result = await list({ sessionId, learnerId: FAKE_LEARNER_ID });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('No household is linked to this session.');
    expect(lessonRequests(fake)).toEqual([]);
  });

  it("turns a backend 403 for someone else's learner into the short message, without the backend body", async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await list({ sessionId, learnerId: FAKE_OTHER_LEARNER_ID });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'Not allowed to access this learner or lesson.',
    );
    expect(JSON.stringify(result)).not.toContain('access denied');
  });

  it("turns a backend 403 for someone else's household into the same message", async () => {
    const sessionId = openSession(fake, connection.sessions, 'someone-elses');

    const result = await list({ sessionId, learnerId: FAKE_LEARNER_ID });

    expect(textOf(result)).toBe(
      'Not allowed to access this learner or lesson.',
    );
  });

  it('turns a backend 404 for an unknown learner into a short message', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await list({
      sessionId,
      learnerId: FAKE_UNKNOWN_LEARNER_ID,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Learner not found.');
    expect(JSON.stringify(result)).not.toContain('learner not found');
  });

  it('refreshes through the call: 401, one refresh, then success', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.expireAccessTokens();

    const result = await list({ sessionId, learnerId: FAKE_LEARNER_ID });

    expect(result.isError).toBeUndefined();
    expect(fake.refreshCalls).toBe(1);
    expect(
      fake.requests.map(
        (request) => `${request.method} ${request.path.split('?')[0]}`,
      ),
    ).toEqual([
      `${BASE}`,
      'POST /api/v1/auth/refresh',
      `${BASE}`,
      'GET /api/v1/households/me',
    ]);
  });

  it('refreshes ahead of expiry', async () => {
    const sessionId = await signInViaTool(connection.client);
    clock.advance(7200_000 - 30_000);

    const result = await list({ sessionId, learnerId: FAKE_LEARNER_ID });

    expect(result.isError).toBeUndefined();
    expect(fake.refreshCalls).toBe(1);
  });

  it('asks the user to sign in again when the refresh is refused', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.expireAccessTokens();
    fake.revokeRefreshTokens();

    const result = await list({ sessionId, learnerId: FAKE_LEARNER_ID });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/ask the user to sign in again/i);
  });

  it('never puts a token or an email in any output or error', async () => {
    const sessionId = await signInViaTool(connection.client);
    const outputs = [
      await list({ sessionId, learnerId: FAKE_LEARNER_ID }),
      await list({ sessionId: 'unknown', learnerId: FAKE_LEARNER_ID }),
      await list({ sessionId, learnerId: FAKE_OTHER_LEARNER_ID }),
    ];
    fake.expireAccessTokens();
    fake.revokeRefreshTokens();
    outputs.push(await list({ sessionId, learnerId: FAKE_LEARNER_ID }));

    for (const output of outputs) {
      const text = JSON.stringify(output);
      expect(text).not.toContain(TOKEN_MARKER);
      expect(text).not.toContain(TUTOR_EMAIL_MARKER);
      expect(text).not.toMatch(/@/);
    }
  });
});
