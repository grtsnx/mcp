// Copied from tool.template.spec.ts: listing, a happy path, bad input, errors, no secrets.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { householdLearnersTool } from '@/tools/household-learners/index.js';
import {
  FAKE_EMAIL_MARKER,
  FAKE_PHONE_MARKER,
  FakeMssuize,
  TOKEN_MARKER,
  createFakeMssuizeApi,
} from '../../helpers/fake-mssuize.js';
import {
  householdRequests,
  openSession,
  signInViaTool,
} from '../../helpers/household-fixtures.js';
import {
  connectTools,
  createClock,
  textOf,
} from '../../helpers/tool-harness.js';

describe('household_learners tool', () => {
  let connection: Awaited<ReturnType<typeof connectTools>>;
  let fake: FakeMssuize;
  let clock: ReturnType<typeof createClock>;

  beforeEach(async () => {
    fake = new FakeMssuize();
    clock = createClock();
    connection = await connectTools([householdLearnersTool], {
      backend: createFakeMssuizeApi(fake),
      now: clock.now,
    });
  });

  afterEach(async () => {
    await connection.close();
  });

  const learners = (arguments_: Record<string, unknown>) =>
    connection.client.callTool({
      name: 'household_learners',
      arguments: arguments_,
    });

  const namesOf = (result: object): string[] =>
    (
      (result as { structuredContent: unknown }).structuredContent as {
        learners: { firstName: string }[];
      }
    ).learners.map((learner) => learner.firstName);

  it('is listed read-only, with a strict input that has a status enum and no householdId', async () => {
    const { tools } = await connection.client.listTools();
    const tool = tools.find(
      (candidate) => candidate.name === 'household_learners',
    );

    expect(tool?.inputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
    expect(Object.keys(tool?.inputSchema.properties ?? {}).sort()).toEqual([
      'status',
    ]);
    const properties = (tool?.inputSchema.properties ?? {}) as {
      status?: { enum?: string[] };
    };
    expect(properties.status?.enum).toEqual([
      'active',
      'paused',
      'archived',
      'unarchived',
      'all',
    ]);
    expect(tool?.outputSchema?.type).toBe('object');
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
  });

  it('returns the unarchived learners by default, with only the allowed fields', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await learners({ sessionId });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      learners: [
        {
          id: 'learner-1',
          firstName: 'Byron',
          lastName: 'Lovelace',
          gradeLevel: '6-8',
          actualGradeLevel: '7th Grade',
          status: 'active',
          age: 12,
        },
        {
          id: 'learner-2',
          firstName: 'Anne',
          lastName: 'Lovelace',
          gradeLevel: 'K-2',
          actualGradeLevel: null,
          status: 'No Plan',
          age: 7,
        },
      ],
    });
    const text = JSON.stringify(result);
    expect(text).not.toContain('10001');
    expect(text).not.toContain('District 2');
    expect(text).not.toContain('91.5');
    expect(text).not.toContain('paymentCompletedAt');
  });

  it('asks the backend for the household stored in the session, not one the model names', async () => {
    const sessionId = await signInViaTool(connection.client);

    await learners({ sessionId });

    expect(householdRequests(fake)).toEqual([
      '/api/v1/households/house-1/learners',
    ]);
  });

  it.each([
    ['active', ['Byron']],
    ['paused', []],
    ['archived', ['Ralph']],
    ['unarchived', ['Byron', 'Anne']],
    ['all', ['Byron', 'Anne', 'Ralph']],
  ])(
    'accepts status %s and passes it to the backend',
    async (status, names) => {
      const sessionId = await signInViaTool(connection.client);

      const result = await learners({ sessionId, status });

      expect(result.isError).toBeUndefined();
      expect(namesOf(result)).toEqual(names);
      expect(householdRequests(fake)).toEqual([
        `/api/v1/households/house-1/learners?status=${status}`,
      ]);
    },
  );

  it.each([
    [
      'a made-up status',
      (sessionId: string) => ({ sessionId, status: 'banana' }),
    ],
    [
      'a status in the wrong case',
      (sessionId: string) => ({ sessionId, status: 'Active' }),
    ],
    ['an empty status', (sessionId: string) => ({ sessionId, status: '' })],
    [
      'a status that is not a string',
      (sessionId: string) => ({ sessionId, status: 1 }),
    ],
    [
      'a householdId',
      (sessionId: string) => ({ sessionId, householdId: 'house-2' }),
    ],
    ['an unknown field', (sessionId: string) => ({ sessionId, extra: true })],
    ['a missing sessionId', () => ({})],
  ])('rejects %s before any backend call', async (_name, build) => {
    // A real session, so the rejection can only come from the input check.
    const sessionId = await signInViaTool(connection.client);
    const before = fake.requests.length;

    const outcome = await learners(build(sessionId))
      .then((result) => result.isError === true)
      .catch(() => true);

    expect(outcome).toBe(true);
    expect(fake.requests.length).toBe(before);
  });

  it('returns an empty list, wrapped in an object, when there are no learners', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.learners = [];

    const result = await learners({ sessionId });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ learners: [] });
  });

  it('gives one short error for an unknown session id, without calling the backend', async () => {
    const result = await learners({ sessionId: 'not-a-real-session' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Session not found, sign in again.');
    expect(fake.requests).toHaveLength(0);
  });

  it('gives a short error when the session has no household, without calling the backend', async () => {
    const sessionId = openSession(fake, connection.sessions, null);

    const result = await learners({ sessionId });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('No household is linked to this session.');
    expect(householdRequests(fake)).toEqual([]);
  });

  it('turns a backend 403 into a short message without the backend body', async () => {
    const sessionId = openSession(fake, connection.sessions, 'someone-elses');

    const result = await learners({ sessionId });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Not allowed to access this household.');
    expect(JSON.stringify(result)).not.toContain('unauthorized to access');
    expect(householdRequests(fake)).toEqual([
      '/api/v1/households/someone-elses/learners',
    ]);
  });

  it('refreshes through a household call: 401, one refresh, then success', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.expireAccessTokens();

    const result = await learners({ sessionId });

    expect(result.isError).toBeUndefined();
    expect(namesOf(result)).toEqual(['Byron', 'Anne']);
    expect(fake.refreshCalls).toBe(1);
    expect(
      fake.requests.map((request) => `${request.method} ${request.path}`),
    ).toEqual([
      'GET /api/v1/households/house-1/learners',
      'POST /api/v1/auth/refresh',
      'GET /api/v1/households/house-1/learners',
    ]);
  });

  it('asks the user to sign in again when the refresh is refused', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.expireAccessTokens();
    fake.revokeRefreshTokens();

    const refused = await learners({ sessionId });

    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toMatch(/ask the user to sign in again/i);
  });

  it('never puts a token, an email or a phone number in any output or error', async () => {
    const sessionId = await signInViaTool(connection.client);
    const outputs = [
      await learners({ sessionId }),
      await learners({ sessionId, status: 'all' }),
      await learners({ sessionId: 'unknown' }),
    ];
    fake.expireAccessTokens();
    fake.revokeRefreshTokens();
    outputs.push(await learners({ sessionId }));

    for (const output of outputs) {
      const text = JSON.stringify(output);
      expect(text).not.toContain(TOKEN_MARKER);
      expect(text).not.toContain(FAKE_EMAIL_MARKER);
      expect(text).not.toContain(FAKE_PHONE_MARKER);
      expect(text).not.toMatch(/@/);
    }
  });
});
