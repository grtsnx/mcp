import { beforeEach, describe, expect, it } from 'vitest';
import { setupSessions as setup } from '../helpers/session-fixture.js';

// A person signs in by sending their own ms-backend access token, as any MCP client does.
describe('SessionService.signIn', () => {
  let ctx: ReturnType<typeof setup>;
  const meCalls = () =>
    ctx.fake.requests.filter((request) => request.path === '/api/v1/auth/me')
      .length;

  beforeEach(() => {
    ctx = setup();
  });

  it('turns an accepted token into a session, and a refused one into none', async () => {
    const { accessToken } = ctx.fake.createTestSessionCredentials();
    const sessionId = await ctx.sessions.signIn(accessToken);
    expect(sessionId).toBeDefined();
    await expect(ctx.whoAmI(sessionId!)).resolves.toMatchObject({
      email: expect.any(String),
    });
    expect(await ctx.sessions.signIn('not-a-real-token')).toBeUndefined();
  });

  it('keeps one session per person, so a newer token keeps their pending confirmation', async () => {
    const first = ctx.fake.createTestSessionCredentials();
    const sessionId = (await ctx.sessions.signIn(first.accessToken))!;
    const { confirmationToken } = ctx.sessions.createProposal(sessionId, {
      action: 'cancel',
      lessonId: 'lesson-1',
      reason: 'Sick.',
    });
    const second = ctx.fake.createTestSessionCredentials();
    expect(await ctx.sessions.signIn(second.accessToken)).toBe(sessionId);
    expect(
      ctx.sessions.takeProposal(sessionId, confirmationToken, 'cancel'),
    ).toMatchObject({ lessonId: 'lesson-1' });
  });

  it('checks a token with ms-backend once a minute, not on every request', async () => {
    const { accessToken } = ctx.fake.createTestSessionCredentials();
    await ctx.sessions.signIn(accessToken);
    await ctx.sessions.signIn(accessToken);
    expect(meCalls()).toBe(1);
    ctx.clock.advance(61_000);
    await ctx.sessions.signIn(accessToken);
    expect(meCalls()).toBe(2);
  });

  it('never refreshes: an expired token asks the person to sign in again', async () => {
    const { accessToken } = ctx.fake.createTestSessionCredentials();
    const sessionId = (await ctx.sessions.signIn(accessToken))!;
    ctx.fake.expireAccessTokens();
    const before = ctx.fake.refreshCalls;
    await expect(ctx.whoAmI(sessionId)).rejects.toThrow(/sign in again/i);
    expect(ctx.fake.refreshCalls).toBe(before);
  });
});
