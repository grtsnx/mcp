// Copied from tool.template.spec.ts: listing, a happy path, bad input, errors, no secrets.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { householdGetTool } from '@/tools/household-get/index.js';
import {
  FAKE_EMAIL_MARKER,
  FAKE_PHONE_MARKER,
  FakeMssuize,
  TOKEN_MARKER,
  createFakeMssuizeApi,
  fakeHousehold,
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

describe('household_get tool', () => {
  let connection: Awaited<ReturnType<typeof connectTools>>;
  let fake: FakeMssuize;
  let clock: ReturnType<typeof createClock>;

  beforeEach(async () => {
    fake = new FakeMssuize();
    clock = createClock();
    connection = await connectTools([householdGetTool], {
      backend: createFakeMssuizeApi(fake),
      now: clock.now,
    });
  });

  afterEach(async () => {
    await connection.close();
  });

  const householdGet = (arguments_: Record<string, unknown>) =>
    connection.client.callTool({
      name: 'household_get',
      arguments: arguments_,
    });

  it('is listed read-only, with a strict sessionId-only input and an object output', async () => {
    const { tools } = await connection.client.listTools();
    const tool = tools.find((candidate) => candidate.name === 'household_get');

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

  it('returns only id, name, timezone, currentLearnerId and recordingConsent', async () => {
    const sessionId = await signInViaTool(connection.client);

    const result = await householdGet({ sessionId });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      id: 'house-1',
      name: 'The Lovelace Family',
      timezone: 'America/New_York',
      currentLearnerId: 'learner-1',
      recordingConsent: true,
    });
    const text = JSON.stringify(result);
    expect(text).not.toContain('primaryGuardianId');
    expect(text).not.toContain('communicationPrefs');
    expect(text).not.toContain('REF-123');
  });

  it('reports no current learner as null', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.household = { ...fakeHousehold, currentLearnerId: undefined };

    const result = await householdGet({ sessionId });

    expect(result.structuredContent).toMatchObject({ currentLearnerId: null });
  });

  it.each([
    [
      'a householdId',
      (sessionId: string) => ({ sessionId, householdId: 'house-2' }),
    ],
    ['an unknown field', (sessionId: string) => ({ sessionId, extra: true })],
    ['a missing sessionId', () => ({})],
    ['an empty sessionId', () => ({ sessionId: '' })],
  ])('rejects %s before any backend call', async (_name, build) => {
    // A real session, so the rejection can only come from the input check.
    const sessionId = await signInViaTool(connection.client);
    const before = fake.requests.length;

    const outcome = await householdGet(build(sessionId))
      .then((result) => result.isError === true)
      .catch(() => true);

    expect(outcome).toBe(true);
    expect(fake.requests.length).toBe(before);
  });

  it('gives one short error for an unknown session id, without calling the backend', async () => {
    const result = await householdGet({ sessionId: 'not-a-real-session' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Session not found, sign in again.');
    expect(fake.requests).toHaveLength(0);
  });

  it('gives a short error when the session has no household, without calling the backend', async () => {
    const sessionId = openSession(fake, connection.sessions, null);

    const result = await householdGet({ sessionId });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('No household is linked to this session.');
    expect(householdRequests(fake)).toEqual([]);
  });

  it('turns a backend 403 into a short message without the backend body', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.householdForbidden = true;

    const result = await householdGet({ sessionId });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Not allowed to access this household.');
    expect(JSON.stringify(result)).not.toContain('forbidden role');
  });

  it('refreshes through a household call: 401, one refresh, then success', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.expireAccessTokens();

    const result = await householdGet({ sessionId });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ id: 'house-1' });
    expect(fake.refreshCalls).toBe(1);
    expect(
      fake.requests.map((request) => `${request.method} ${request.path}`),
    ).toEqual([
      'GET /api/v1/households/me',
      'POST /api/v1/auth/refresh',
      'GET /api/v1/households/me',
    ]);
  });

  it('refreshes ahead of expiry', async () => {
    const sessionId = await signInViaTool(connection.client);
    clock.advance(7200_000 - 30_000);

    const result = await householdGet({ sessionId });

    expect(result.isError).toBeUndefined();
    expect(fake.refreshCalls).toBe(1);
  });

  it('asks the user to sign in again when the refresh is refused', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.expireAccessTokens();
    fake.revokeRefreshTokens();

    const refused = await householdGet({ sessionId });
    const after = await householdGet({ sessionId });

    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toMatch(/ask the user to sign in again/i);
    expect(textOf(after)).toBe('Session not found, sign in again.');
  });

  it('shows a missing household as a clean error with no backend body', async () => {
    const sessionId = await signInViaTool(connection.client);
    fake.householdMissing = true;

    const missing = await householdGet({ sessionId });

    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toMatch(/could not find/i);
    expect(textOf(missing)).not.toContain('household not found');
  });

  it('never puts a token, an email or a phone number in any output or error', async () => {
    const sessionId = await signInViaTool(connection.client);
    const outputs = [
      await householdGet({ sessionId }),
      await householdGet({ sessionId: 'unknown' }),
    ];
    fake.expireAccessTokens();
    fake.revokeRefreshTokens();
    outputs.push(await householdGet({ sessionId }));

    for (const output of outputs) {
      const text = JSON.stringify(output);
      expect(text).not.toContain(TOKEN_MARKER);
      expect(text).not.toContain(FAKE_EMAIL_MARKER);
      expect(text).not.toContain(FAKE_PHONE_MARKER);
      expect(text).not.toMatch(/@/);
    }
  });
});
