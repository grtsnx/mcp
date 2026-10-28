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
import { FAKE_LEARNER_ID, FAKE_LESSON_ID } from '../helpers/fake-scheduling.js';
import { cancelRequests } from '../helpers/cancel-fixture.js';
import {
  signInWithBearer,
  signInViaTool,
} from '../helpers/household-fixtures.js';
import { WINDOW_SUNDAY_ID, WINDOW_TUESDAY_ID } from '../helpers/fake-weekly.js';
import { weeklyLearner, weeklyRequests } from '../helpers/weekly-fixture.js';

const mcpApiKey = 'test-mcp-api-key-01';

describe('weekly schedule and cancel over MCP (e2e, fake backend, real client)', () => {
  let app: INestApplication;
  let backend: Awaited<ReturnType<typeof startFakeMssuizeServer>>;
  let client: Client;
  let fake: FakeMssuize;

  beforeAll(async () => {
    fake = new FakeMssuize();
    fake.learners = [weeklyLearner];
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

    client = new Client({ name: 'cancel-weekly-e2e', version: '0.0.1' });
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
    fake.scheduling.cancelOutcome = 'success';
    fake.scheduling.cancelSavedDespiteFailure = false;
    fake.scheduling.applyCancel = true;
    fake.scheduling.resetLessons();
    fake.requests.length = 0;
  });

  const call = (name: string, arguments_: Record<string, unknown>) =>
    client.callTool({ name, arguments: arguments_ });
  const textOf = (result: Awaited<ReturnType<typeof call>>): string =>
    (result.content as { text: string }[])[0]?.text ?? '';

  it('reads the weekly schedule and previews the same windows with no change', async () => {
    const sessionId = await signInViaTool(client);

    const schedule = await call('learner_weekly_schedule_get', {
      sessionId,
      learnerId: FAKE_LEARNER_ID,
    });
    const preview = await call('learner_weekly_schedule_preview', {
      sessionId,
      learnerId: FAKE_LEARNER_ID,
      windows: [
        {
          windowId: WINDOW_TUESDAY_ID,
          dayOfWeek: 2,
          startTime: '16:00',
          endTime: '18:00',
        },
        {
          windowId: WINDOW_SUNDAY_ID,
          dayOfWeek: 0,
          startTime: '09:00',
          endTime: '11:00',
        },
      ],
    });

    expect(schedule.structuredContent).toMatchObject({
      windows: [
        {
          dayName: 'Tuesday',
          whenLocal:
            'Tuesday, 4:00 PM to 6:00 PM and 7:00 PM to 8:00 PM (America/New_York)',
        },
        {
          dayName: 'Sunday',
          whenLocal: 'Sunday, 9:00 AM to 11:00 AM (America/New_York)',
        },
      ],
    });
    expect(preview.structuredContent).toMatchObject({
      timezone: 'America/New_York',
      affectedCount: 0,
      cancelCount: 0,
      entries: [],
    });
    expect(
      weeklyRequests(fake).filter((line) => line.startsWith('POST')),
    ).toEqual([
      `POST /api/v1/learners/${FAKE_LEARNER_ID}/weekly-schedule-v2/preview`,
    ]);
    expect(JSON.stringify([schedule, preview])).not.toContain(TOKEN_MARKER);
  });

  it('proposes without cancelling, then cancels with one request after the yes', async () => {
    const sessionId = await signInViaTool(client);
    const proposal = await call('session_cancel', {
      step: 'propose',
      sessionId,
      lessonId: FAKE_LESSON_ID,
      reason: 'Family trip',
    });
    const token = (proposal.structuredContent as { confirmationToken: string })
      .confirmationToken;
    expect(proposal.structuredContent).toMatchObject({
      timezone: 'America/New_York',
      whenLocal: 'Monday 1 June 2026, 10:00 AM to 11:00 AM',
    });
    expect(cancelRequests(fake)).toHaveLength(0);

    const result = await call('session_cancel', {
      step: 'confirm',
      sessionId,
      confirmationToken: token,
    });

    expect(result.structuredContent).toEqual({
      status: 'cancelled',
      lessonId: FAKE_LESSON_ID,
    });
    expect(cancelRequests(fake)).toHaveLength(1);
    expect(cancelRequests(fake)[0]?.body).toEqual({ reason: 'Family trip' });
  });

  it('sends one cancel and reads the lesson back when the backend never answers', async () => {
    fake.scheduling.cancelOutcome = 'timeout';
    const sessionId = await signInViaTool(client);
    const proposal = await call('session_cancel', {
      step: 'propose',
      sessionId,
      lessonId: FAKE_LESSON_ID,
      reason: 'Family trip',
    });
    const token = (proposal.structuredContent as { confirmationToken: string })
      .confirmationToken;

    const result = await call('session_cancel', {
      step: 'confirm',
      sessionId,
      confirmationToken: token,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/did not go through/);
    expect(cancelRequests(fake)).toHaveLength(1);
    expect(fake.scheduling.statusOf(FAKE_LESSON_ID)).toBe('scheduled');
  });
});
