import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { SessionService } from '@/session/session.service.js';
import type { FakeMssuize, FakeSessionCredentials } from './fake-mssuize.js';

const testSessionCreators = new WeakMap<Client, () => string>();

export function registerTestSessionCreator(
  client: Client,
  createCredentials: () => FakeSessionCredentials,
  sessions: SessionService,
): void {
  testSessionCreators.set(client, () => {
    const credentials = createCredentials();
    return sessions.create({
      accessToken: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      expiresIn: credentials.expiresIn,
      user: credentials.user,
      householdId: credentials.householdId,
    });
  });
}

//1. For tests over real HTTP: the client signs in the way any MCP client does, by sending the
//   person's access token as its bearer token. signInViaTool then returns that token, and
//   a call that names it as `sessionId` is sent with it as the bearer instead.
//2. Each token gets its own connected client, closed with the main one.
export function signInWithBearer(
  client: Client,
  createCredentials: () => FakeSessionCredentials,
  connectAs: (token: string) => Promise<Client>,
): void {
  testSessionCreators.set(client, () => createCredentials().accessToken);
  const byToken = new Map<string, Promise<Client>>();
  const callTool = client.callTool.bind(client);
  client.callTool = (async (request, ...rest) => {
    const { sessionId, ...args } = (request.arguments ?? {}) as Record<
      string,
      unknown
    >;
    if (typeof sessionId !== 'string')
      return callTool({ ...request, arguments: args }, ...rest);
    let signedIn = byToken.get(sessionId);
    if (!signedIn) {
      signedIn = connectAs(sessionId);
      byToken.set(sessionId, signedIn);
      // A refused sign-in is not kept, so a later call can try again.
      signedIn.catch(() => byToken.delete(sessionId));
    }
    return (await signedIn).callTool({ ...request, arguments: args }, ...rest);
  }) as typeof client.callTool;
  const close = client.close.bind(client);
  client.close = async () => {
    for (const other of byToken.values())
      await other.then((signedIn) => signedIn.close()).catch(() => undefined);
    await close();
  };
}

// Opens an in-memory test session without adding a login tool to the MCP server.
export async function signInViaTool(client: Client): Promise<string> {
  const create = testSessionCreators.get(client);
  if (create === undefined) {
    throw new Error('Test session creator is not registered for this client.');
  }
  return create();
}

// Opens a session from fake credentials, with the household id of the test's choosing
// (null for a person with no household, another id for one that is not theirs).
export function openSession(
  fake: FakeMssuize,
  sessions: SessionService,
  householdId: string | null,
  role = 'guardian',
  expiresIn = 7200,
): string {
  const credentials = fake.createTestSessionCredentials();
  return sessions.create({
    accessToken: credentials.accessToken,
    refreshToken: credentials.refreshToken,
    expiresIn: Math.min(expiresIn, credentials.expiresIn),
    user: { ...credentials.user, role },
    householdId,
  });
}

export function householdRequests(fake: FakeMssuize): string[] {
  return fake.requests
    .filter((request) => request.path.includes('/households/'))
    .map((request) => request.path);
}

// Requests that reached the scheduling routes, ignoring sign-in and household calls.
export function lessonRequests(fake: FakeMssuize): string[] {
  return fake.requests
    .filter(
      (request) =>
        request.path.startsWith('/api/v1/sessions/') ||
        request.path.includes('/scheduled-sessions'),
    )
    .map((request) => `${request.method} ${request.path}`);
}

// Every move request that reached the backend, including ones it refused.
export function moveRequests(fake: FakeMssuize) {
  return fake.requests.filter(
    (request) =>
      request.method === 'POST' && request.path.endsWith('/reschedule'),
  );
}
