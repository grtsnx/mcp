// Copied from tool.template.spec.ts: listing, a happy path, bad input, errors, no secrets.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { householdMembersTool } from '@/tools/household-members/index.js';
import {
  FAKE_EMAIL_MARKER,
  FAKE_PHONE_MARKER,
  FakeMssuize,
  TOKEN_MARKER,
  createFakeMssuizeApi,
  fakeUser,
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

describe('household_members tool', () => {
  let connection: Awaited<ReturnType<typeof connectTools>>;
  let fake: FakeMssuize;
  let clock: ReturnType<typeof createClock>;

  beforeEach(async () => {
    fake = new FakeMssuize();
    clock = createClock();
    connection = await connectTools([householdMembersTool], {
      backend: createFakeMssuizeApi(fake),
      now: clock.now,
    });
  });

  afterEach(async () => {
    await connection.close();
  });

  const members = (arguments_: Record<string, unknown>) =>
    connection.client.callTool({
      name: 'household_members',
      arguments: arguments_,
    });

  it('is listed read-only, with a strict sessionId-only input and an object output', async () => {
    const { tools } = await connection.client.listTools();
    const tool = tools.find(
      (candidate) => candidate.name === 'household_members',
    );

    expect(tool?.inputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual([]);
    expect(tool?.outputSchema?.type).toBe('object');
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
  });

  it('returns only id, names, role, status, accessScope and learnerIds', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await members({ sessionId });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      members: [
        {
          id: 'member-1',
          firstName: 'Ada',
          lastName: 'Lovelace',
          role: 'primary',
          status: 'active',
          accessScope: 'all',
          learnerIds: ['learner-1', 'learner-2', 'learner-3'],
        },
        {
          id: 'member-2',
          firstName: null,
          lastName: null,
          role: 'delegate',
          status: 'pending',
          accessScope: 'selected',
          learnerIds: ['learner-1'],
        },
      ],
    });
  });

  it('never returns an email or a phone number, not even as a key', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await members({ sessionId });
    const text = JSON.stringify(result);

    expect(text).not.toContain(FAKE_EMAIL_MARKER);
    expect(text).not.toContain(FAKE_PHONE_MARKER);
    expect(text).not.toContain('invited-SHOULD-NOT-LEAK');
    expect(text).not.toContain('+1555');
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/"(email|phone|userId|learners|invitedAt)"/);
  });

  it('copes with a member that has no learner ids', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.members = [
      {
        id: 'member-3',
        role: 'delegate',
        status: 'active',
        accessScope: 'selected',
        learnerIds: null,
      },
    ];

    const result = await members({ sessionId });

    expect(result.structuredContent).toEqual({
      members: [
        {
          id: 'member-3',
          firstName: null,
          lastName: null,
          role: 'delegate',
          status: 'active',
          accessScope: 'selected',
          learnerIds: [],
        },
      ],
    });
  });

  it('asks the backend for the household stored in the session, not one the model names', async () => {
    const sessionId = await signInViaTool(connection.client);

    await members({ sessionId });

    expect(householdRequests(fake)).toEqual([
      '/api/v1/households/house-1/members',
    ]);
  });

  it.each([
    [
      'a householdId',
      (sessionId: string) => ({ sessionId, householdId: 'house-2' }),
    ],
    [
      'an unknown field',
      (sessionId: string) => ({ sessionId, includeEmail: true }),
    ],
    ['a missing sessionId', () => ({})],
    ['an empty sessionId', () => ({ sessionId: '' })],
  ])('rejects %s before any backend call', async (_name, build) => {
    // A real session, so the rejection can only come from the input check.
    const sessionId = await signInViaTool(connection.client);
    const before = fake.requests.length;

    const outcome = await members(build(sessionId))
      .then((result) => result.isError === true)
      .catch(() => true);

    expect(outcome).toBe(true);
    expect(fake.requests.length).toBe(before);
  });

  it('gives one short error for an unknown session id, without calling the backend', async () => {
    const result = await members({ sessionId: 'not-a-real-session' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Session not found, sign in again.');
    expect(fake.requests).toHaveLength(0);
  });

  it('gives a short error when the session has no household, without calling the backend', async () => {
    const sessionId = openSession(fake, connection.sessions, null);

    const result = await members({ sessionId });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('No household is linked to this session.');
    expect(householdRequests(fake)).toEqual([]);
  });

  it('turns a backend 403 into a short message without the backend body', async () => {
    const sessionId = openSession(fake, connection.sessions, 'someone-elses');

    const result = await members({ sessionId });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Not allowed to access this household.');
    expect(JSON.stringify(result)).not.toContain('access denied');
  });

  it('refreshes through a household call: 401, one refresh, then success', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.expireAccessTokens();

    const result = await members({ sessionId });

    expect(result.isError).toBeUndefined();
    expect(fake.refreshCalls).toBe(1);
    expect(
      fake.requests.map((request) => `${request.method} ${request.path}`),
    ).toEqual([
      'GET /api/v1/households/house-1/members',
      'POST /api/v1/auth/refresh',
      'GET /api/v1/households/house-1/members',
    ]);
  });

  it('asks the user to sign in again when the refresh is refused', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.expireAccessTokens();
    fake.revokeRefreshTokens();

    const refused = await members({ sessionId });

    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toMatch(/ask the user to sign in again/i);
  });

  it('never puts a token or the signed-in person’s own email in any output or error', async () => {
    const sessionId = await signInViaTool(connection.client);
    const outputs = [
      await members({ sessionId }),
      await members({ sessionId: 'unknown' }),
    ];
    fake.expireAccessTokens();
    fake.revokeRefreshTokens();
    outputs.push(await members({ sessionId }));

    for (const output of outputs) {
      const text = JSON.stringify(output);
      expect(text).not.toContain(TOKEN_MARKER);
      expect(text).not.toContain(fakeUser.email);
      expect(text).not.toContain(fakeUser.phone);
    }
  });
});
