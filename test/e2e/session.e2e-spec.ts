import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import request from 'supertest';
import { AppModule } from '@/app';
import { configureApplication } from '@/bootstrap/application.js';
import { validateEnvironment } from '@/config/index.js';
import { BackendClient } from '@/external/mssuize/backend-client.js';
import {
  FakeMssuize,
  TOKEN_MARKER,
  fakeUser,
  startFakeMssuizeServer,
} from '../helpers/fake-mssuize.js';

const mcpApiKey = 'test-mcp-api-key-01';

describe('sign-in sessions over MCP (e2e, fake backend)', () => {
  let app: INestApplication;
  let backend: Awaited<ReturnType<typeof startFakeMssuizeServer>>;
  let client: Client;
  let fake: FakeMssuize;

  beforeAll(async () => {
    fake = new FakeMssuize();
    // Slow enough that two simultaneous MCP requests overlap while a refresh is running.
    backend = await startFakeMssuizeServer(fake, { latencyMs: 40 });

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

    client = new Client({ name: 'session-e2e', version: '0.0.1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('/mcp', await app.getUrl()), {
        requestInit: { headers: { Authorization: `Bearer ${mcpApiKey}` } },
      }),
    );
  });

  afterAll(async () => {
    await client.close();
    await app.close();
    await backend.close();
  });

  const call = (name: string, arguments_: Record<string, unknown>) =>
    client.callTool({ name, arguments: arguments_ });

  const textOf = (result: Awaited<ReturnType<typeof call>>): string =>
    (result.content as { text: string }[])
      .map((block) => block.text)
      .join('\n');

  it('lists every tool once', async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'household_get',
      'household_learners',
      'household_members',
      'household_sessions_list',
      'learner_sessions_list',
      'learner_weekly_schedule_get',
      'learner_weekly_schedule_preview',
      'learner_weekly_schedule_update',
      'ping',
      'session_cancel',
      'session_get',
      'session_me',
      'session_reschedule',
      'session_reschedule_options_day',
      'session_reschedule_options_week',
      'tutor_change_request_create',
      'tutor_change_request_list',
    ]);
  });

  // A client that signs in the standard way: the person's access token as its bearer token.
  const connectAs = async (token: string) => {
    const parent = new Client({ name: 'parent', version: '0.0.1' });
    await parent.connect(
      new StreamableHTTPClientTransport(new URL('/mcp', await app.getUrl()), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    return parent;
  };

  it('signs a person in from their own access token and says who they are', async () => {
    const { accessToken } = fake.createTestSessionCredentials();
    const parent = await connectAs(accessToken);
    try {
      const me = await parent.callTool({ name: 'session_me', arguments: {} });
      expect(me.isError).toBeUndefined();
      expect(me.structuredContent).toMatchObject({
        id: fakeUser.id,
        email: fakeUser.email,
      });
      // The person's token never comes back in a result.
      expect(JSON.stringify(me)).not.toContain(TOKEN_MARKER);
    } finally {
      await parent.close();
    }
  });

  it('refuses a token ms-backend does not accept, and says where to sign in', async () => {
    const response = await request(app.getHttpServer())
      .post('/mcp')
      .set('Authorization', 'Bearer not-a-real-token')
      .set('Content-Type', 'application/json')
      .send({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} })
      .expect(401);
    expect(response.headers['www-authenticate']).toMatch(
      /^Bearer resource_metadata=".*\/\.well-known\/oauth-protected-resource"$/,
    );
  });

  it('serves the standard sign-in discovery document', async () => {
    const response = await request(app.getHttpServer())
      .get('/.well-known/oauth-protected-resource')
      .expect(200);
    expect(response.body).toMatchObject({
      resource: expect.stringMatching(/\/mcp$/),
      bearer_methods_supported: ['header'],
    });
  });

  it('asks to sign in first when only the agent key is sent', async () => {
    const result = await call('session_me', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Sign in to MsSuzie first, then try again.');
  });

  it('asks to sign in again when the token expires, and never refreshes it', async () => {
    const { accessToken } = fake.createTestSessionCredentials();
    const parent = await connectAs(accessToken);
    try {
      await parent.callTool({ name: 'session_me', arguments: {} });
      fake.expireAccessTokens();
      const before = fake.refreshCalls;
      const expired = await parent
        .callTool({ name: 'session_me', arguments: {} })
        .then((result) => textOf(result))
        .catch(() => 'refused');
      expect(expired).toMatch(/sign in again|refused/i);
      expect(fake.refreshCalls).toBe(before);
    } finally {
      await parent.close();
    }
  });
});
