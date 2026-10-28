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
import { FAKE_LESSON_ID, FAKE_TUTOR_ID } from '../helpers/fake-scheduling.js';
import {
  moveRequests,
  signInWithBearer,
  signInViaTool,
} from '../helpers/household-fixtures.js';

const mcpApiKey = 'test-mcp-api-key-01';
const START = '2026-06-02T10:00:00-04:00';
const END = '2026-06-02T11:00:00-04:00';
const UNKNOWN_OUTCOME =
  /result is unknown: the move may or may not have happened/;

describe('rescheduling over MCP (e2e, fake backend, real client)', () => {
  let app: INestApplication;
  let backend: Awaited<ReturnType<typeof startFakeMssuizeServer>>;
  let client: Client;
  let fake: FakeMssuize;

  beforeAll(async () => {
    fake = new FakeMssuize();
    backend = await startFakeMssuizeServer(fake, { latencyMs: 10 });

    // The real client with a short timeout, so a backend that never answers is noticed quickly.
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(BackendClient)
      .useValue(new BackendClient({ baseUrl: backend.url, timeoutMs: 1500 }))
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

    client = new Client({ name: 'reschedule-e2e', version: '0.0.1' });
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
    fake.scheduling.rescheduleOutcome = 'success';
    fake.scheduling.applyReschedule = true;
    fake.requests.length = 0;
  });

  const call = (arguments_: Record<string, unknown>) =>
    client.callTool({ name: 'session_reschedule', arguments: arguments_ });

  const textOf = (result: Awaited<ReturnType<typeof call>>): string =>
    (result.content as { text: string }[])[0]?.text ?? '';

  async function proposed() {
    const sessionId = await signInViaTool(client);
    const proposal = await call({
      step: 'propose',
      sessionId,
      lessonId: FAKE_LESSON_ID,
      newStart: START,
      newEnd: END,
      reason: 'Soccer practice moved',
    });
    return {
      sessionId,
      token: (proposal.structuredContent as { confirmationToken: string })
        .confirmationToken,
      proposal,
    };
  }

  it('proposes without sending a move, then moves the lesson with one request after the yes', async () => {
    const { sessionId, token, proposal } = await proposed();

    expect(proposal.structuredContent).toMatchObject({
      status: 'proposed',
      timezone: 'America/New_York',
      newStart: START,
      currentWhenLocal: 'Monday 1 June 2026, 10:00 AM to 11:00 AM',
      newWhenLocal: 'Tuesday 2 June 2026, 10:00 AM to 11:00 AM',
    });
    expect(moveRequests(fake)).toHaveLength(0);

    const result = await call({
      step: 'confirm',
      sessionId,
      confirmationToken: token,
    });

    expect(result.structuredContent).toEqual({
      status: 'rescheduled',
      lessonId: FAKE_LESSON_ID,
      learnerName: 'Byron Lovelace',
      subjects: ['Math', 'Science'],
      timezone: 'America/New_York',
      currentStart: '2026-06-01T10:00:00-04:00',
      currentEnd: '2026-06-01T11:00:00-04:00',
      currentWhenLocal: 'Monday 1 June 2026, 10:00 AM to 11:00 AM',
      newStart: '2026-06-02T14:00:00Z',
      newEnd: '2026-06-02T15:00:00Z',
      newWhenLocal: 'Tuesday 2 June 2026, 10:00 AM to 11:00 AM',
    });
    const moves = moveRequests(fake);
    expect(moves).toHaveLength(1);
    expect(moves[0]?.body).toEqual({
      new_start: START,
      new_end: END,
      reason: 'Soccer practice moved',
    });
    // No retry key and no extra header: only the bearer token and the JSON basics.
    expect(Object.keys(moves[0]!.headers)).not.toContain('idempotency-key');
  });

  it('works once over HTTP: a second confirm sends nothing', async () => {
    const { sessionId, token } = await proposed();
    await call({ step: 'confirm', sessionId, confirmationToken: token });
    const before = fake.requests.length;

    const again = await call({
      step: 'confirm',
      sessionId,
      confirmationToken: token,
    });

    expect(again.isError).toBe(true);
    expect(fake.requests.length).toBe(before);
  });

  it('sends one move when two confirms arrive together over HTTP', async () => {
    const { sessionId, token } = await proposed();

    const results = await Promise.all([
      call({ step: 'confirm', sessionId, confirmationToken: token }),
      call({ step: 'confirm', sessionId, confirmationToken: token }),
    ]);

    expect(results.filter((result) => result.isError !== true)).toHaveLength(1);
    expect(moveRequests(fake)).toHaveLength(1);
  });

  it('sends exactly one move and says the result is unknown after a real 500', async () => {
    const { sessionId, token } = await proposed();
    fake.scheduling.rescheduleOutcome = {
      status: 500,
      text: 'failed to reschedule session',
    };

    const result = await call({
      step: 'confirm',
      sessionId,
      confirmationToken: token,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(UNKNOWN_OUTCOME);
    expect(textOf(result)).not.toContain('failed to reschedule session');
    expect(moveRequests(fake)).toHaveLength(1);
  });

  it('sends exactly one move and says the result is unknown when the backend never answers', async () => {
    const { sessionId, token } = await proposed();
    fake.scheduling.rescheduleOutcome = 'timeout';

    const result = await call({
      step: 'confirm',
      sessionId,
      confirmationToken: token,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(UNKNOWN_OUTCOME);
    expect(moveRequests(fake)).toHaveLength(1);
  }, 10_000);

  it('reads each known 400 text from the real reply and shows only a fixed message', async () => {
    const cases: [string, string][] = [
      [
        'cannot reschedule this session',
        'This lesson cannot be rescheduled (its status or timing does not allow it).',
      ],
      [
        'selected time slot is no longer available',
        'That time is not available.',
      ],
      [
        'not within the learner availability',
        "That time is outside the learner's availability.",
      ],
      ['invalid request body', 'The request was not accepted.'],
    ];
    for (const [text, message] of cases) {
      const { sessionId, token } = await proposed();
      fake.scheduling.rescheduleOutcome = { status: 400, text };
      fake.requests.length = 0;

      const result = await call({
        step: 'confirm',
        sessionId,
        confirmationToken: token,
      });

      expect(textOf(result)).toBe(message);
      expect(JSON.stringify(result)).not.toContain(text);
      expect(moveRequests(fake)).toHaveLength(1);
    }
  });

  it('sends nothing more and asks to sign in again after a real 401', async () => {
    const { sessionId, token } = await proposed();
    const movesBefore = moveRequests(fake).length;
    fake.expireAccessTokens();
    const refreshesBefore = fake.refreshCalls;

    const outcome = await call({
      step: 'confirm',
      sessionId,
      confirmationToken: token,
    })
      .then((result) => (result.content as { text: string }[])[0]?.text ?? '')
      .catch(() => 'refused');

    expect(outcome).toMatch(/sign in again|refused/i);
    expect(fake.refreshCalls).toBe(refreshesBefore);
    // The backend refused the token before running anything, so no lesson moved.
    expect(moveRequests(fake).length - movesBefore).toBeLessThanOrEqual(1);
  });

  it('never returns a token, a tutor id or backend text', async () => {
    const outputs = [] as Awaited<ReturnType<typeof call>>[];
    for (const outcome of [
      'success',
      { status: 500, text: 'failed to reschedule session' },
    ] as const) {
      const { sessionId, token, proposal } = await proposed();
      outputs.push(proposal);
      fake.scheduling.rescheduleOutcome = outcome;
      outputs.push(
        await call({ step: 'confirm', sessionId, confirmationToken: token }),
      );
    }

    for (const output of outputs) {
      const text = JSON.stringify(output);
      for (const secret of [
        TOKEN_MARKER,
        FAKE_TUTOR_ID,
        'failed to reschedule session',
      ]) {
        expect(text).not.toContain(secret);
      }
      expect(text).not.toMatch(/@/);
    }
  });
});
