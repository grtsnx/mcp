// Copied from tool.template.spec.ts: listing, a happy path, bad input, backend failures, no secrets.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sessionMeTool } from '@/tools/session-me/index.js';
import {
  FakeMssuize,
  TOKEN_MARKER,
  createFakeMssuizeApi,
  fakeUser,
} from '../../helpers/fake-mssuize.js';
import {
  connectTools,
  createClock,
  textOf,
} from '../../helpers/tool-harness.js';
import { signInViaTool } from '../../helpers/household-fixtures.js';

describe('session_me tool', () => {
  let connection: Awaited<ReturnType<typeof connectTools>>;
  let fake: FakeMssuize;
  let clock: ReturnType<typeof createClock>;

  beforeEach(async () => {
    fake = new FakeMssuize();
    clock = createClock();
    connection = await connectTools([sessionMeTool], {
      backend: createFakeMssuizeApi(fake),
      now: clock.now,
    });
  });

  afterEach(async () => {
    await connection.close();
  });

  const signIn = (): Promise<string> => signInViaTool(connection.client);

  const sessionMe = (arguments_: Record<string, unknown>) =>
    connection.client.callTool({ name: 'session_me', arguments: arguments_ });

  it('is listed with a strict sessionId input and an object output', async () => {
    const { tools } = await connection.client.listTools();
    const tool = tools.find((candidate) => candidate.name === 'session_me');

    expect(tool?.inputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
    expect(tool?.outputSchema?.type).toBe('object');
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
  });

  it('says who the session belongs to, and nothing more than the summary', async () => {
    const sessionId = await signIn();

    const result = await sessionMe({ sessionId });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      id: fakeUser.id,
      email: fakeUser.email,
      role: fakeUser.role,
      firstName: fakeUser.firstName,
      lastName: fakeUser.lastName,
      status: fakeUser.status,
      householdId: 'house-1',
    });
    expect(textOf(result)).toContain('Ada Lovelace');
  });

  it('reports no household as null when the backend sends none', async () => {
    const sessionId = await signIn();
    fake.omitHouseholdFromMe = true;

    const result = await sessionMe({ sessionId });

    expect(result.structuredContent).toMatchObject({ householdId: null });
  });

  it('refreshes ahead of expiry and still answers', async () => {
    const sessionId = await signIn();
    clock.advance(7200_000 - 30_000);

    const result = await sessionMe({ sessionId });

    expect(result.isError).toBeUndefined();
    expect(fake.refreshCalls).toBe(1);
  });

  it('recovers when the access token has already expired', async () => {
    const sessionId = await signIn();
    fake.expireAccessTokens();

    const result = await sessionMe({ sessionId });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ email: fakeUser.email });
    expect(fake.refreshCalls).toBe(1);
  });

  it('gives one short error for an unknown session id', async () => {
    const result = await sessionMe({ sessionId: 'not-a-real-session' });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(textOf(result)).toBe('Session not found, sign in again.');
  });

  it('asks the user to sign in again when the refresh is refused, then forgets the session', async () => {
    const sessionId = await signIn();
    fake.expireAccessTokens();
    fake.revokeRefreshTokens();

    const refused = await sessionMe({ sessionId });
    const after = await sessionMe({ sessionId });

    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toMatch(/ask the user to sign in again/i);
    expect(textOf(after)).toBe('Session not found, sign in again.');
  });

  it('shows a backend outage as a clean tool error and keeps the session', async () => {
    const sessionId = await signIn();
    fake.expireAccessTokens();
    fake.refreshFailure = 503;

    const failed = await sessionMe({ sessionId });
    fake.refreshFailure = undefined;
    const recovered = await sessionMe({ sessionId });

    expect(failed.isError).toBe(true);
    expect(textOf(failed)).toMatch(/unavailable/i);
    expect(recovered.isError).toBeUndefined();
  });

  it.each([
    ['an unknown field', (sessionId: string) => ({ sessionId, extra: true })],
    ['a missing sessionId', () => ({})],
    ['an empty sessionId', () => ({ sessionId: '' })],
    ['a sessionId that is not a string', () => ({ sessionId: 1 })],
  ])('rejects %s before any backend call', async (_name, build) => {
    // A real session, so the rejection can only come from the input check.
    const sessionId = await signIn();
    const before = fake.requests.length;

    const outcome = await sessionMe(build(sessionId))
      .then((result) => result.isError === true)
      .catch(() => true);

    expect(outcome).toBe(true);
    expect(fake.requests.length).toBe(before);
  });

  it('never puts a token in any output or error', async () => {
    const sessionId = await signIn();
    const outputs = [
      await sessionMe({ sessionId }),
      await sessionMe({ sessionId: 'unknown' }),
    ];
    fake.expireAccessTokens();
    fake.revokeRefreshTokens();
    outputs.push(await sessionMe({ sessionId }));

    for (const output of outputs) {
      const text = JSON.stringify(output);
      expect(text).not.toContain(TOKEN_MARKER);
    }
  });
});
