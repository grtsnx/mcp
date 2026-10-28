import { fetchCurrentUser } from '@/external/mssuize/auth-api.js';
import { FakeMssuize, createFakeMssuizeApi } from './fake-mssuize.js';
import { createClock, createSessions, sessionLimits } from './tool-harness.js';

export const sessionProfile = {
  id: 'u1',
  email: 'guardian@example.com',
  role: 'guardian',
  firstName: 'Ada',
  lastName: 'Lovelace',
};

export function setupSessions(
  options: {
    latencyMs?: number;
    limits?: Partial<typeof sessionLimits>;
  } = {},
) {
  const fake = new FakeMssuize();
  const clock = createClock();
  const backend = createFakeMssuizeApi(fake, { latencyMs: options.latencyMs });
  const sessions = createSessions(backend, {
    now: clock.now,
    limits: options.limits,
  });

  // Creates credentials in the fake backend and opens a test session.
  const signIn = (): string => {
    const credentials = fake.createTestSessionCredentials();
    return sessions.create({
      accessToken: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      expiresIn: credentials.expiresIn,
      user: sessionProfile,
      householdId: credentials.householdId,
    });
  };

  // What a tool does: ask the backend who this is, with a token that is valid now.
  const whoAmI = (sessionId: string) =>
    sessions.withAccessToken(sessionId, (accessToken) =>
      fetchCurrentUser(backend, accessToken),
    );

  const lastCookie = (path: string): string | undefined =>
    fake.requests.filter((request) => request.path === path).at(-1)?.headers
      .cookie;

  return { fake, clock, backend, sessions, signIn, whoAmI, lastCookie };
}
