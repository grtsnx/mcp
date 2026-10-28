// Copied from tool.template.spec.ts: listing, a happy path, bad input, errors, no secrets.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { householdSessionsListTool } from '@/tools/household-sessions-list/index.js';
import {
  FakeMssuize,
  TOKEN_MARKER,
  createFakeMssuizeApi,
} from '../../helpers/fake-mssuize.js';
import {
  FAKE_LEARNER_ID,
  FAKE_TUTOR_ID,
  MEETING_MARKER,
  SIGNED_LINK_MARKER,
  TUTOR_EMAIL_MARKER,
  fakeLessons,
} from '../../helpers/fake-scheduling.js';
import {
  openSession,
  signInViaTool,
} from '../../helpers/household-fixtures.js';
import {
  connectTools,
  createClock,
  textOf,
} from '../../helpers/tool-harness.js';

const BASE = 'GET /api/v1/households/house-1/sessions';

describe('household_sessions_list tool', () => {
  let connection: Awaited<ReturnType<typeof connectTools>>;
  let fake: FakeMssuize;
  let clock: ReturnType<typeof createClock>;

  beforeEach(async () => {
    fake = new FakeMssuize();
    clock = createClock();
    connection = await connectTools([householdSessionsListTool], {
      backend: createFakeMssuizeApi(fake),
      now: clock.now,
    });
  });

  afterEach(async () => {
    await connection.close();
  });

  const list = (arguments_: Record<string, unknown>) =>
    connection.client.callTool({
      name: 'household_sessions_list',
      arguments: arguments_,
    });

  const requested = () =>
    fake.requests
      .filter((request) =>
        request.path.includes('/households/house-1/sessions'),
      )
      .map((request) => `${request.method} ${request.path}`);

  it('is listed read-only, points to household_learners for names, and has no householdId', async () => {
    const { tools } = await connection.client.listTools();
    const tool = tools.find(
      (candidate) => candidate.name === 'household_sessions_list',
    );
    const properties = (tool?.inputSchema.properties ?? {}) as Record<
      string,
      { enum?: string[]; minimum?: number; maximum?: number; default?: number }
    >;

    expect(tool?.inputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
    expect(Object.keys(properties).sort()).toEqual([
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
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(tool?.description).toMatch(/household_learners/);
    expect(tool?.description).toMatch(/comes from the request’s sign-in/);
  });

  it('returns the household’s lessons with only the allowed fields and the length worked out', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await list({ sessionId });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      timezone: 'America/New_York',
      lessons: [
        {
          lessonId: fakeLessons[0]!.id,
          learnerId: FAKE_LEARNER_ID,
          subjects: ['Math', 'Science'],
          scheduledStart: '2026-06-01T14:00:00Z',
          scheduledEnd: '2026-06-01T15:00:00Z',
          whenLocal: 'Monday 1 June 2026, 10:00 AM to 11:00 AM',
          durationMinutes: 60,
          status: 'scheduled',
          canReschedule: true,
          canCancel: true,
        },
        expect.objectContaining({ durationMinutes: 45, status: 'completed' }),
        expect.objectContaining({ durationMinutes: 30, status: 'cancelled' }),
      ],
      totalCount: 3,
      page: 0,
      pageSize: 20,
    });
    expect(JSON.stringify(result)).not.toMatch(/"durationMinutes":0\b/);
  });

  it('has no names, tutor ids, signed links or meeting fields', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await list({ sessionId });
    const text = JSON.stringify(result);

    for (const secret of [
      FAKE_TUTOR_ID,
      SIGNED_LINK_MARKER,
      MEETING_MARKER,
      TUTOR_EMAIL_MARKER,
      TOKEN_MARKER,
      'Grace',
      'Byron',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toMatch(
      /tutorId|tutorName|learnerName|meetingProvider|videoProvider|recordingPreference/,
    );
    expect(text).not.toMatch(/@/);
  });

  it('asks the backend for the household stored in the session, with the page size always sent', async () => {
    const sessionId = await signInViaTool(connection.client);

    await list({ sessionId });

    expect(requested()).toEqual([`${BASE}?page_size=20`]);
  });

  it('sends the filters under the names the backend reads', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await list({
      sessionId,
      status: 'scheduled',
      startAfter: '2026-05-31T00:00:00Z',
      startBefore: '2026-06-02T00:00:00+01:00',
      page: 0,
      pageSize: 5,
    });

    const [request] = requested();
    const params = new URL(request!.split(' ')[1]!, 'http://x').searchParams;
    expect(Object.fromEntries(params)).toEqual({
      page: '0',
      page_size: '5',
      status: 'scheduled',
      start_after: '2026-05-31T00:00:00Z',
      start_before: '2026-06-02T00:00:00+01:00',
    });
    expect(
      (result.structuredContent as { lessons: unknown[] }).lessons,
    ).toHaveLength(1);
  });

  it('returns an empty list, in an object, when the backend sends null for none', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await list({ sessionId, status: 'no_show' });

    expect(result.structuredContent).toEqual({
      timezone: 'America/New_York',
      lessons: [],
      totalCount: 0,
      page: 0,
      pageSize: 20,
    });
  });

  it.each([
    ['an unknown status', () => ({ status: 'pending' })],
    ['a status in the wrong case', () => ({ status: 'Scheduled' })],
    ['the word canceled for cancelled', () => ({ status: 'canceled' })],
    ['a startAfter that is only a date', () => ({ startAfter: '2026-06-01' })],
    [
      'a startBefore with no offset',
      () => ({ startBefore: '2026-06-01T10:00:00' }),
    ],
    ['a negative page', () => ({ page: -1 })],
    ['a page size of 0', () => ({ pageSize: 0 })],
    ['a page size of 51', () => ({ pageSize: 51 })],
    ['a householdId', () => ({ householdId: 'house-2' })],
    ['a learnerId', () => ({ learnerId: FAKE_LEARNER_ID })],
    ['an unknown field', () => ({ includeNames: true })],
  ])('rejects %s before any backend call', async (_name, extra) => {
    // A real session, so the rejection can only come from the input check.
    const sessionId = await signInViaTool(connection.client);
    const before = fake.requests.length;

    const outcome = await list({ sessionId, ...extra() })
      .then((result) => result.isError === true)
      .catch(() => true);

    expect(outcome).toBe(true);
    expect(fake.requests.length).toBe(before);
  });

  it('gives one short error for an unknown sign-in session, without calling the backend', async () => {
    const result = await list({ sessionId: 'not-a-real-session' });

    expect(textOf(result)).toBe('Session not found, sign in again.');
    expect(fake.requests).toHaveLength(0);
  });

  it('refuses a role the backend would turn away, with a short message and no backend call', async () => {
    const sessionId = openSession(fake, connection.sessions, null, 'tutor');

    const result = await list({ sessionId });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Not allowed to access this household.');
    expect(requested()).toEqual([]);
  });

  it('gives a short error when a guardian session has no household', async () => {
    const sessionId = openSession(fake, connection.sessions, null);

    const result = await list({ sessionId });

    expect(textOf(result)).toBe('No household is linked to this session.');
    expect(requested()).toEqual([]);
  });

  it("turns a backend 403 for someone else's household into the short message", async () => {
    const sessionId = openSession(fake, connection.sessions, 'someone-elses');

    const result = await list({ sessionId });

    expect(textOf(result)).toBe('Not allowed to access this household.');
    expect(JSON.stringify(result)).not.toContain('access denied');
  });

  it('refreshes through the call: 401, one refresh, then success', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.expireAccessTokens();

    const result = await list({ sessionId });

    expect(result.isError).toBeUndefined();
    expect(fake.refreshCalls).toBe(1);
    expect(requested().map((request) => request.split('?')[0])).toEqual([
      BASE,
      BASE,
    ]);
  });

  it('asks the user to sign in again when the refresh is refused', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.expireAccessTokens();
    fake.revokeRefreshTokens();

    const result = await list({ sessionId });

    expect(textOf(result)).toMatch(/ask the user to sign in again/i);
  });

  it('never puts a token or an email in any output or error', async () => {
    const sessionId = await signInViaTool(connection.client);
    const outputs = [
      await list({ sessionId }),
      await list({ sessionId: 'unknown' }),
    ];
    fake.expireAccessTokens();
    fake.revokeRefreshTokens();
    outputs.push(await list({ sessionId }));

    for (const output of outputs) {
      const text = JSON.stringify(output);
      expect(text).not.toContain(TOKEN_MARKER);
      expect(text).not.toMatch(/@/);
    }
  });
});
