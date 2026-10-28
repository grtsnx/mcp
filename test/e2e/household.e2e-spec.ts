import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AppModule } from '@/app';
import { configureApplication } from '@/bootstrap/application.js';
import { validateEnvironment } from '@/config/index.js';
import { BackendClient } from '@/external/mssuize/backend-client.js';
import {
  FAKE_EMAIL_MARKER,
  FAKE_PHONE_MARKER,
  FakeMssuize,
  TOKEN_MARKER,
  startFakeMssuizeServer,
} from '../helpers/fake-mssuize.js';
import {
  signInWithBearer,
  signInViaTool,
} from '../helpers/household-fixtures.js';

const mcpApiKey = 'test-mcp-api-key-01';

describe('household tools over MCP (e2e, fake backend)', () => {
  let app: INestApplication;
  let backend: Awaited<ReturnType<typeof startFakeMssuizeServer>>;
  let client: Client;
  let fake: FakeMssuize;

  beforeAll(async () => {
    fake = new FakeMssuize();
    backend = await startFakeMssuizeServer(fake, { latencyMs: 20 });

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(BackendClient)
      .useValue(new BackendClient({ baseUrl: backend.url, timeoutMs: 2000 }))
      .compile();

    app = moduleFixture.createNestApplication({ logger: false });
    configureApplication(
      app,
      validateEnvironment({
        NODE_ENV: 'test',
        SWAGGER_ENABLED: false,
        MCP_API_KEY: mcpApiKey,
        BACKEND_BASE_URL: backend.url,
      }),
    );
    await app.listen(0, '127.0.0.1');

    client = new Client({ name: 'household-e2e', version: '0.0.1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('/mcp', await app.getUrl()), {
        requestInit: { headers: { Authorization: `Bearer ${mcpApiKey}` } },
      }),
    );
    signInWithBearer(
      client,
      () => fake.createTestSessionCredentials(),
      async (token) => {
        const parent = new Client({ name: 'parent', version: '0.0.1' });
        await parent.connect(
          new StreamableHTTPClientTransport(
            new URL('/mcp', await app.getUrl()),
            {
              requestInit: { headers: { Authorization: `Bearer ${token}` } },
            },
          ),
        );
        return parent;
      },
    );
  });

  afterAll(async () => {
    await client.close();
    await app.close();
    await backend.close();
  });

  const call = (name: string, arguments_: Record<string, unknown>) =>
    client.callTool({ name, arguments: arguments_ });

  const householdPaths = () =>
    fake.requests
      .filter((request) => request.path.includes('/households/'))
      .map((request) => request.path);

  it('reads the household, learners and members of the signed-in person', async () => {
    const sessionId = await signInViaTool(client);
    fake.requests.length = 0;

    const household = await call('household_get', { sessionId });
    const learners = await call('household_learners', { sessionId });
    const members = await call('household_members', { sessionId });

    expect(household.structuredContent).toMatchObject({
      id: 'house-1',
      name: 'The Lovelace Family',
      recordingConsent: true,
    });
    expect(
      (learners.structuredContent as { learners: unknown[] }).learners,
    ).toHaveLength(2);
    expect(
      (members.structuredContent as { members: unknown[] }).members,
    ).toHaveLength(2);
    expect(householdPaths()).toEqual([
      '/api/v1/households/me',
      '/api/v1/households/house-1/learners',
      '/api/v1/households/house-1/members',
    ]);
  });

  it('sends the chosen status to the backend as a query parameter', async () => {
    const sessionId = await signInViaTool(client);
    fake.requests.length = 0;

    const all = await call('household_learners', { sessionId, status: 'all' });

    expect(
      (all.structuredContent as { learners: unknown[] }).learners,
    ).toHaveLength(3);
    expect(householdPaths()).toEqual([
      '/api/v1/households/house-1/learners?status=all',
    ]);
  });

  it('refuses a made-up status and a householdId before the backend is called', async () => {
    const sessionId = await signInViaTool(client);
    fake.requests.length = 0;

    const outcomes = await Promise.all(
      [
        { sessionId, status: 'banana' },
        { sessionId, householdId: 'house-2' },
      ].map((arguments_) =>
        call('household_learners', arguments_)
          .then((result) => result.isError === true)
          .catch(() => true),
      ),
    );

    expect(outcomes).toEqual([true, true]);
    expect(
      fake.requests.filter((request) => request.path !== '/api/v1/auth/me'),
    ).toHaveLength(0);
  });

  it('asks to sign in again when the token has expired, and never refreshes it', async () => {
    const sessionId = await signInViaTool(client);
    await call('household_members', { sessionId });
    fake.expireAccessTokens();
    const before = fake.refreshCalls;
    const outcomes = await Promise.all(
      [1, 2, 3].map(() =>
        call('household_members', { sessionId })
          .then(
            (result) => (result.content as { text: string }[])[0]?.text ?? '',
          )
          .catch(() => 'refused'),
      ),
    );
    for (const outcome of outcomes)
      expect(outcome).toMatch(/sign in again|refused/i);
    expect(fake.refreshCalls).toBe(before);
  });

  it('turns a backend 403 into a short message', async () => {
    const sessionId = await signInViaTool(client);
    fake.householdForbidden = true;

    const result = await call('household_learners', { sessionId });
    fake.householdForbidden = false;

    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]?.text).toBe(
      'Not allowed to access this household.',
    );
  });

  it('refuses a session it does not know before any tool runs', async () => {
    await expect(
      call('household_get', { sessionId: 'unknown' }),
    ).rejects.toThrow(/401/);
  });

  it('never returns a token, an email or a phone number from any household tool', async () => {
    const sessionId = await signInViaTool(client);
    const outputs = await Promise.all([
      call('household_get', { sessionId }),
      call('household_learners', { sessionId, status: 'all' }),
      call('household_members', { sessionId }),
    ]);

    for (const output of outputs) {
      const text = JSON.stringify(output);
      expect(text).not.toContain(TOKEN_MARKER);
      expect(text).not.toContain(FAKE_EMAIL_MARKER);
      expect(text).not.toContain(FAKE_PHONE_MARKER);
      expect(text).not.toMatch(/@/);
    }
  });
});
