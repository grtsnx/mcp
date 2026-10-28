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
  fakeHousehold,
  startFakeMssuizeServer,
} from '../helpers/fake-mssuize.js';
import {
  FAKE_LEARNER_ID,
  FAKE_LESSON_ID,
  FAKE_OTHER_LESSON_ID,
  FAKE_UNKNOWN_LESSON_ID,
  MEETING_MARKER,
  PAYLOAD_MARKER,
  SIGNED_LINK_MARKER,
  TUTOR_EMAIL_MARKER,
} from '../helpers/fake-scheduling.js';
import {
  signInWithBearer,
  signInViaTool,
} from '../helpers/household-fixtures.js';

const mcpApiKey = 'test-mcp-api-key-01';

describe('scheduling tools over MCP (e2e, fake backend)', () => {
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

    client = new Client({ name: 'scheduling-e2e', version: '0.0.1' });
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

  const textOf = (result: Awaited<ReturnType<typeof call>>): string =>
    (result.content as { text: string }[])[0]?.text ?? '';

  const schedulingPaths = () =>
    fake.requests
      .filter(
        (request) =>
          request.path.startsWith('/api/v1/sessions/') ||
          request.path.includes('/scheduled-sessions'),
      )
      .map((request) => `${request.method} ${request.path}`);

  it('finds a learner’s lessons, reads one, and previews a day, as one flow', async () => {
    const sessionId = await signInViaTool(client);
    fake.requests.length = 0;

    const list = await call('learner_sessions_list', {
      sessionId,
      learnerId: FAKE_LEARNER_ID,
      status: 'scheduled',
    });
    const lessonId = (
      list.structuredContent as { lessons: { lessonId: string }[] }
    ).lessons[0]?.lessonId;
    const lesson = await call('session_get', { sessionId, lessonId });
    const options = await call('session_reschedule_options_day', {
      sessionId,
      lessonId,
      targetDate: '2026-06-02',
    });

    expect(lessonId).toBe(FAKE_LESSON_ID);
    expect(lesson.structuredContent).toMatchObject({
      lesson: { lessonId: FAKE_LESSON_ID, durationMinutes: 60 },
    });
    expect(options.structuredContent).toMatchObject({
      lessonId: FAKE_LESSON_ID,
      count: 2,
      durationMinutes: 60,
    });
    expect(schedulingPaths()).toEqual([
      `GET /api/v1/households/house-1/learners/${FAKE_LEARNER_ID}/scheduled-sessions?page_size=20&status=scheduled`,
      `GET /api/v1/sessions/${FAKE_LESSON_ID}`,
      `POST /api/v1/sessions/${FAKE_LESSON_ID}/reschedule-preview`,
    ]);
  });

  describe("times written in the household's own zone", () => {
    afterEach(() => {
      fake.household = fakeHousehold;
      fake.householdMissing = false;
    });

    const lessonOf = (result: Awaited<ReturnType<typeof call>>) =>
      result.structuredContent as {
        timezone: string;
        lesson?: { whenLocal: string };
        lessons?: { whenLocal: string }[];
      };

    it('follows daylight saving in America/New_York', async () => {
      const sessionId = await signInViaTool(client);

      const list = lessonOf(
        await call('learner_sessions_list', {
          sessionId,
          learnerId: FAKE_LEARNER_ID,
          status: 'scheduled',
        }),
      );

      expect(list.timezone).toBe('America/New_York');
      // 14:00 UTC is 10:00 AM in New York in June (UTC-4).
      expect(list.lessons?.[0]?.whenLocal).toBe(
        'Monday 1 June 2026, 10:00 AM to 11:00 AM',
      );
    });

    it('uses a zone without daylight saving (Africa/Lagos), for lessons and for slots', async () => {
      fake.household = { ...fakeHousehold, timezone: 'Africa/Lagos' };
      const sessionId = await signInViaTool(client);
      fake.requests.length = 0;

      const lesson = lessonOf(
        await call('session_get', { sessionId, lessonId: FAKE_LESSON_ID }),
      );
      const options = await call('session_reschedule_options_day', {
        sessionId,
        lessonId: FAKE_LESSON_ID,
        targetDate: '2026-06-02',
        timezone: 'Africa/Lagos',
      });

      expect(lesson).toMatchObject({
        timezone: 'Africa/Lagos',
        lesson: { whenLocal: 'Monday 1 June 2026, 3:00 PM to 4:00 PM' },
      });
      expect(options.structuredContent).toMatchObject({
        timezone: 'Africa/Lagos',
        targetDateLocal: 'Tuesday 2 June 2026',
        slots: [
          { whenLocal: 'Tuesday 2 June 2026, 10:00 AM to 11:00 AM' },
          { whenLocal: 'Tuesday 2 June 2026, 3:00 PM to 4:00 PM' },
        ],
      });
      // The household is read once for session_get; the day preview names its own zone.
      expect(
        fake.requests.filter(
          (request) => request.path === '/api/v1/households/me',
        ),
      ).toHaveLength(1);
    });

    it('writes the local day when it is not the UTC day', async () => {
      fake.household = { ...fakeHousehold, timezone: 'Pacific/Kiritimati' };
      const sessionId = await signInViaTool(client);

      const list = lessonOf(
        await call('household_sessions_list', {
          sessionId,
          status: 'scheduled',
        }),
      );

      expect(list.timezone).toBe('Pacific/Kiritimati');
      // 14:00 UTC on Monday 1 June is 4:00 AM on Tuesday 2 June at UTC+14.
      expect(list.lessons?.[0]?.whenLocal).toBe(
        'Tuesday 2 June 2026, 4:00 AM to 5:00 AM',
      );
    });

    it('falls back to UTC, and says so, when the household cannot be read', async () => {
      fake.householdMissing = true;
      const sessionId = await signInViaTool(client);

      const lesson = lessonOf(
        await call('session_get', { sessionId, lessonId: FAKE_LESSON_ID }),
      );

      expect(lesson).toMatchObject({
        timezone: 'UTC',
        lesson: { whenLocal: 'Monday 1 June 2026, 2:00 PM to 3:00 PM UTC' },
      });
    });

    it('tells the model to show the Local text as given and never convert it', async () => {
      const { tools } = await client.listTools();
      const covered = [
        'household_sessions_list',
        'learner_sessions_list',
        'session_get',
        'session_reschedule_options_day',
        'session_reschedule_options_week',
        'session_reschedule',
        'session_cancel',
        'learner_weekly_schedule_get',
        'learner_weekly_schedule_preview',
        'learner_weekly_schedule_update',
      ];

      for (const name of covered) {
        const tool = tools.find((candidate) => candidate.name === name);
        expect(tool?.description).toMatch(/exactly as given/);
        expect(tool?.description).toMatch(/never convert/);
      }
    });
  });

  it('refuses bad ids, dates, zones and statuses before the backend is called', async () => {
    const sessionId = await signInViaTool(client);
    fake.requests.length = 0;

    const attempts: [string, Record<string, unknown>][] = [
      ['learner_sessions_list', { sessionId, learnerId: 'nope' }],
      [
        'learner_sessions_list',
        { sessionId, learnerId: FAKE_LEARNER_ID, status: 'pending' },
      ],
      ['session_get', { sessionId, lessonId: 'nope' }],
      [
        'session_reschedule_options_day',
        { sessionId, lessonId: FAKE_LESSON_ID, targetDate: '2026-02-30' },
      ],
      [
        'session_reschedule_options_day',
        {
          sessionId,
          lessonId: FAKE_LESSON_ID,
          targetDate: '2026-06-02',
          timezone: 'Mars/Phobos',
        },
      ],
      [
        'session_get',
        { sessionId, lessonId: FAKE_LESSON_ID, householdId: 'house-1' },
      ],
    ];
    const outcomes = await Promise.all(
      attempts.map(([name, arguments_]) =>
        call(name, arguments_).then(
          (result) => result.isError === true,
          () => true,
        ),
      ),
    );

    expect(outcomes).toEqual(attempts.map(() => true));
    expect(
      fake.requests.filter((request) => request.path !== '/api/v1/auth/me'),
    ).toHaveLength(0);
  });

  it('turns 403 and 404 into short messages with no backend text', async () => {
    const sessionId = await signInViaTool(client);

    const forbidden = await call('session_get', {
      sessionId,
      lessonId: FAKE_OTHER_LESSON_ID,
    });
    const missing = await call('session_get', {
      sessionId,
      lessonId: FAKE_UNKNOWN_LESSON_ID,
    });

    expect(textOf(forbidden)).toBe(
      'Not allowed to access this learner or lesson.',
    );
    expect(textOf(missing)).toBe('Lesson not found.');
    expect(JSON.stringify([forbidden, missing])).not.toMatch(
      /access denied|session not found/,
    );
  });

  it('asks to sign in again when the token has expired, and never refreshes it', async () => {
    const sessionId = await signInViaTool(client);
    await call('household_sessions_list', { sessionId });
    fake.expireAccessTokens();
    const before = fake.refreshCalls;
    const outcomes = await Promise.all(
      [1, 2, 3].map(() =>
        call('household_sessions_list', { sessionId })
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

  it('never returns a token, an email, a signed link, a payload or a meeting link', async () => {
    const sessionId = await signInViaTool(client);

    const outputs = await Promise.all([
      call('learner_sessions_list', {
        sessionId,
        learnerId: FAKE_LEARNER_ID,
        status: 'completed',
      }),
      call('session_get', { sessionId, lessonId: FAKE_LESSON_ID }),
      call('session_reschedule_options_day', {
        sessionId,
        lessonId: FAKE_LESSON_ID,
        targetDate: '2026-06-02',
      }),
    ]);

    for (const output of outputs) {
      const text = JSON.stringify(output);
      for (const secret of [
        TOKEN_MARKER,
        TUTOR_EMAIL_MARKER,
        SIGNED_LINK_MARKER,
        PAYLOAD_MARKER,
        MEETING_MARKER,
      ]) {
        expect(text).not.toContain(secret);
      }
      expect(text).not.toMatch(/@/);
    }
  });
});
