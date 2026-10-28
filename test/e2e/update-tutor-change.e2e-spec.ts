import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AppModule } from '@/app';
import { configureApplication } from '@/bootstrap/application.js';
import { validateEnvironment } from '@/config/index.js';
import { BackendClient } from '@/external/mssuize/backend-client.js';
import {
  FakeMssuize,
  TOKEN_MARKER,
  startFakeMssuizeServer,
} from '../helpers/fake-mssuize.js';
import {
  FAKE_LEARNER_ID,
  FAKE_LESSON_ID,
  FAKE_TUTOR_ID,
} from '../helpers/fake-scheduling.js';
import { NO_HOUSEHOLD_TEXT } from '../helpers/fake-tutor-change.js';
import {
  signInWithBearer,
  signInViaTool,
} from '../helpers/household-fixtures.js';
import {
  createRequests,
  secondLearner,
} from '../helpers/tutor-change-fixture.js';
import {
  MOVED_WINDOWS,
  putRequests,
} from '../helpers/weekly-update-fixture.js';
import { weeklyLearner } from '../helpers/weekly-fixture.js';

const mcpApiKey = 'test-mcp-api-key-01';

describe('weekly update and tutor-change over MCP (e2e, fake backend, real client)', () => {
  let app: INestApplication;
  let backend: Awaited<ReturnType<typeof startFakeMssuizeServer>>;
  let client: Client;
  let fake: FakeMssuize;

  beforeAll(async () => {
    fake = new FakeMssuize();
    fake.learners = [weeklyLearner, secondLearner];
    backend = await startFakeMssuizeServer(fake, { latencyMs: 10 });

    // A short client timeout, so a backend that never answers is noticed quickly.
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(BackendClient)
      .useValue(new BackendClient({ baseUrl: backend.url, timeoutMs: 1000 }))
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

    client = new Client({ name: 'update-tutor-change-e2e', version: '0.0.1' });
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

  beforeEach(() => {
    fake.weekly.reset();
    fake.tutorChange.reset();
    fake.requests.length = 0;
  });

  const call = (name: string, arguments_: Record<string, unknown>) =>
    client.callTool({ name, arguments: arguments_ });
  const textOf = (result: Awaited<ReturnType<typeof call>>): string =>
    (result.content as { text: string }[])[0]?.text ?? '';
  const tokenOf = (result: Awaited<ReturnType<typeof call>>) =>
    (result.structuredContent as { confirmationToken: string })
      .confirmationToken;

  it('proposes without saving, then saves with one PUT after the yes, and reads the schedule back', async () => {
    const sessionId = await signInViaTool(client);
    const proposal = await call('learner_weekly_schedule_update', {
      step: 'propose',
      sessionId,
      learnerId: FAKE_LEARNER_ID,
      windows: MOVED_WINDOWS,
      reason: 'Soccer practice moved',
    });
    expect(proposal.structuredContent).toMatchObject({
      status: 'proposed',
      previewIsIncomplete: true,
    });
    expect(putRequests(fake)).toHaveLength(0);

    const result = await call('learner_weekly_schedule_update', {
      step: 'confirm',
      sessionId,
      confirmationToken: tokenOf(proposal),
      parentAcknowledgesLessonsMayBeChanged: true,
    });

    expect(result.structuredContent).toMatchObject({
      status: 'updated',
      windows: [{ startTime: '17:00:00' }, { startTime: '09:00:00' }],
    });
    expect(putRequests(fake)).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(TOKEN_MARKER);
  });

  it('refuses a confirm without the acknowledgement, and sends nothing', async () => {
    const sessionId = await signInViaTool(client);
    const proposal = await call('learner_weekly_schedule_update', {
      step: 'propose',
      sessionId,
      learnerId: FAKE_LEARNER_ID,
      windows: MOVED_WINDOWS,
      reason: 'x',
    });

    const refused = await call('learner_weekly_schedule_update', {
      step: 'confirm',
      sessionId,
      confirmationToken: tokenOf(proposal),
    }).then(
      (result) => result.isError === true,
      () => true,
    );

    expect(refused).toBe(true);
    expect(putRequests(fake)).toHaveLength(0);
  });

  it('sends one save and says the result is unknown when the backend never answers', async () => {
    fake.weekly.putOutcome = 'timeout';
    const sessionId = await signInViaTool(client);
    const proposal = await call('learner_weekly_schedule_update', {
      step: 'propose',
      sessionId,
      learnerId: FAKE_LEARNER_ID,
      windows: MOVED_WINDOWS,
      reason: 'x',
    });

    const result = await call('learner_weekly_schedule_update', {
      step: 'confirm',
      sessionId,
      confirmationToken: tokenOf(proposal),
      parentAcknowledgesLessonsMayBeChanged: true,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/result is unknown/);
    expect(putRequests(fake)).toHaveLength(1);
  });

  it('files a tutor-change request with one POST, taking the tutor from the lesson', async () => {
    const sessionId = await signInViaTool(client);
    const proposal = await call('tutor_change_request_create', {
      step: 'propose',
      sessionId,
      learnerId: FAKE_LEARNER_ID,
      lessonId: FAKE_LESSON_ID,
      reason: 'Not a good fit',
    });
    expect(proposal.structuredContent).toMatchObject({
      status: 'proposed',
      tutorFirstName: 'Grace',
    });
    expect(JSON.stringify(proposal)).not.toContain(FAKE_TUTOR_ID);
    expect(createRequests(fake)).toHaveLength(0);

    const result = await call('tutor_change_request_create', {
      step: 'confirm',
      sessionId,
      confirmationToken: tokenOf(proposal),
    });

    expect(result.structuredContent).toMatchObject({
      status: 'filed',
      requestStatus: 'pending',
    });
    expect(createRequests(fake)).toHaveLength(1);
    expect(createRequests(fake)[0]?.body).toEqual({
      learnerId: FAKE_LEARNER_ID,
      currentTutorId: FAKE_TUTOR_ID,
      reason: 'Not a good fit',
    });

    const listed = await call('tutor_change_request_list', { sessionId });
    expect(listed.structuredContent).toMatchObject({
      requests: [{ status: 'pending' }],
      total: 1,
    });
  });

  it('says plainly that no household could be found, when the backend cannot', async () => {
    fake.tutorChange.listOutcome = { status: 400, text: NO_HOUSEHOLD_TEXT };
    const sessionId = await signInViaTool(client);

    const result = await call('tutor_change_request_list', { sessionId });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      "No household could be found for this account's tutor-change requests.",
    );
  });
});
