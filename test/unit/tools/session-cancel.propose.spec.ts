// Copied from tool.template.spec.ts. session_cancel is a write tool: this file covers the propose
// step, which must never change anything; the confirm step is in the sibling specs.
import { afterEach, describe, expect, it } from 'vitest';
import {
  FAKE_COMPLETED_LESSON_ID,
  FAKE_LESSON_ID,
  FAKE_LOCKED_LESSON_ID,
  FAKE_OTHER_LESSON_ID,
  FAKE_UNKNOWN_LESSON_ID,
  PAYLOAD_MARKER,
  SIGNED_LINK_MARKER,
  TUTOR_EMAIL_MARKER,
} from '../../helpers/fake-lessons-data.js';
import { TOKEN_MARKER } from '../../helpers/fake-mssuize.js';
import {
  CANCEL_REASON,
  FAR_BEFORE,
  LATE_NOTICE,
  ONE_HOUR_BEFORE,
  TWELVE_HOURS_BEFORE,
  cancelRequests,
  createCancelFixture,
} from '../../helpers/cancel-fixture.js';
import {
  openSession,
  signInViaTool,
} from '../../helpers/household-fixtures.js';
import { textOf } from '../../helpers/tool-harness.js';

const LESSON_START = Date.parse('2026-06-01T14:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('session_cancel tool, step propose', () => {
  let fx: Awaited<ReturnType<typeof createCancelFixture>>;

  afterEach(async () => {
    await fx.close();
  });

  it('is listed as one plain object, not read-only, destructive, not idempotent', async () => {
    fx = await createCancelFixture();
    const { tools } = await fx.connection.client.listTools();
    const tool = tools.find((candidate) => candidate.name === 'session_cancel');
    const schema = tool?.inputSchema as Record<string, unknown>;

    expect(schema.type).toBe('object');
    expect(schema).not.toHaveProperty('oneOf');
    expect(schema).not.toHaveProperty('anyOf');
    expect(schema).toMatchObject({
      required: ['step'],
      additionalProperties: false,
    });
    expect(Object.keys((schema.properties ?? {}) as object).sort()).toEqual([
      'confirmationToken',
      'lessonId',
      'reason',
      'step',
    ]);
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
  });

  it('tells the model it cannot be undone, to show the proposal, and never to confirm alone', async () => {
    fx = await createCancelFixture();
    const { tools } = await fx.connection.client.listTools();
    const description =
      tools.find((candidate) => candidate.name === 'session_cancel')
        ?.description ?? '';

    expect(description).toMatch(/cannot be undone with these tools/);
    expect(description).toMatch(/explicit yes BEFORE calling step 'confirm'/);
    expect(description).toMatch(/never confirm on your own/);
    expect(description).toMatch(/NEVER retried/);
    expect(description).toMatch(/do not try again/);
    expect(description).toMatch(/session_get/);
    expect(description).toMatch(/comes from the request’s sign-in/);
  });

  it('proposes with exactly the documented fields, and changes NOTHING', async () => {
    fx = await createCancelFixture(FAR_BEFORE);
    const sessionId = await signInViaTool(fx.connection.client);

    const result = await fx.propose(sessionId);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      status: 'proposed',
      confirmationToken: expect.stringMatching(/^[A-Za-z0-9_-]{43,}$/),
      lessonId: FAKE_LESSON_ID,
      timezone: 'America/New_York',
      scheduledStart: '2026-06-01T14:00:00Z',
      scheduledEnd: '2026-06-01T15:00:00Z',
      whenLocal: 'Monday 1 June 2026, 10:00 AM to 11:00 AM',
      durationMinutes: 60,
      reason: CANCEL_REASON,
      expiresInSeconds: 300,
    });
    expect(cancelRequests(fx.fake)).toHaveLength(0);
    expect(
      fx.fake.requests.filter(
        (request) =>
          request.method !== 'GET' && request.path.includes('/sessions/'),
      ),
    ).toHaveLength(0);
    expect(fx.fake.scheduling.statusOf(FAKE_LESSON_ID)).toBe('scheduled');
  });

  it('gives a new token each time and still changes nothing', async () => {
    fx = await createCancelFixture();
    const sessionId = await signInViaTool(fx.connection.client);

    const first = (await fx.propose(sessionId)).structuredContent as {
      confirmationToken: string;
    };
    const second = (await fx.propose(sessionId)).structuredContent as {
      confirmationToken: string;
    };

    expect(first.confirmationToken).not.toBe(second.confirmationToken);
    expect(cancelRequests(fx.fake)).toHaveLength(0);
  });

  it.each([
    ['a completed lesson', FAKE_COMPLETED_LESSON_ID, /not scheduled/],
    [
      'an already cancelled lesson',
      '4a6c8e10-2b4d-4f6a-8b0c-1d2e3f4a5b6c',
      null,
    ],
    [
      'a scheduled lesson that canCancel says no to',
      FAKE_LOCKED_LESSON_ID,
      /cannot be cancelled/,
    ],
  ])(
    'refuses %s without sending anything',
    async (_label, lessonId, message) => {
      fx = await createCancelFixture();
      const sessionId = await signInViaTool(fx.connection.client);

      const result = await fx.propose(sessionId, lessonId);

      expect(result.isError).toBe(true);
      if (message) expect(textOf(result)).toMatch(message);
      expect(cancelRequests(fx.fake)).toHaveLength(0);
    },
  );

  it('says Lesson not found for an unknown lesson, and refuses a lesson that is not theirs', async () => {
    fx = await createCancelFixture();
    const sessionId = await signInViaTool(fx.connection.client);

    const unknown = await fx.propose(sessionId, FAKE_UNKNOWN_LESSON_ID);
    const foreign = await fx.propose(sessionId, FAKE_OTHER_LESSON_ID);

    expect(textOf(unknown)).toBe('Lesson not found.');
    expect(textOf(foreign)).toBe('Not allowed to change this lesson.');
    expect(cancelRequests(fx.fake)).toHaveLength(0);
  });

  describe('the late-cancellation notice', () => {
    const proposeAt = async (now: number) => {
      fx = await createCancelFixture(now);
      const sessionId = await signInViaTool(fx.connection.client);
      return (await fx.propose(sessionId)).structuredContent as Record<
        string,
        unknown
      >;
    };

    it('is absent when the lesson is more than 24 hours away', async () => {
      expect(await proposeAt(FAR_BEFORE)).not.toHaveProperty(
        'lateCancellationNotice',
      );
    });

    it('is absent at exactly 24 hours and present one millisecond later', async () => {
      expect(await proposeAt(LESSON_START - DAY)).not.toHaveProperty(
        'lateCancellationNotice',
      );
      await fx.close();
      expect(await proposeAt(LESSON_START - DAY + 1)).toMatchObject({
        lateCancellationNotice: LATE_NOTICE,
      });
    });

    it.each([
      ['twelve hours before', TWELVE_HOURS_BEFORE],
      ['one hour before', ONE_HOUR_BEFORE],
      ['after the start', LESSON_START + 60_000],
    ])('is the fixed sentence %s', async (_label, now) => {
      const proposal = await proposeAt(now);

      expect(proposal.lateCancellationNotice).toBe(LATE_NOTICE);
    });

    it('never names an amount or says a fee is charged', () => {
      // The only number is the 24 hours; there is no currency sign and no amount.
      expect(LATE_NOTICE.replace('24 hours', '')).not.toMatch(/[\d$€£]/);
      expect(LATE_NOTICE).toMatch(/\bmay incur\b/);
      expect(LATE_NOTICE).not.toMatch(/\b(will|has been|is) (be )?charged\b/i);
    });
  });

  it('leaves out the tutor’s email, signed links, event payloads and tokens', async () => {
    fx = await createCancelFixture(ONE_HOUR_BEFORE);
    const sessionId = await signInViaTool(fx.connection.client);

    const text = JSON.stringify(await fx.propose(sessionId));

    expect(text).not.toContain(TUTOR_EMAIL_MARKER);
    expect(text).not.toContain(SIGNED_LINK_MARKER);
    expect(text).not.toContain(PAYLOAD_MARKER);
    expect(text).not.toContain(TOKEN_MARKER);
    expect(text).not.toMatch(/tutor/i);
  });

  it('refuses a tutor before any backend call', async () => {
    fx = await createCancelFixture();
    const sessionId = openSession(
      fx.fake,
      fx.connection.sessions,
      'house-1',
      'tutor',
    );
    const before = fx.fake.requests.length;

    const result = await fx.propose(sessionId);

    expect(textOf(result)).toBe('Not allowed to change this lesson.');
    expect(fx.fake.requests).toHaveLength(before);
  });

  it('refuses an unknown session before any backend call', async () => {
    fx = await createCancelFixture();
    const before = fx.fake.requests.length;

    const result = await fx.propose('no-such-session');

    expect(result.isError).toBe(true);
    expect(fx.fake.requests).toHaveLength(before);
  });

  describe('input checked before any backend call', () => {
    const base = {
      step: 'propose',
      lessonId: FAKE_LESSON_ID,
      reason: CANCEL_REASON,
    };

    it.each([
      ['a missing reason', { reason: undefined }],
      ['an empty reason', { reason: '' }],
      ['a reason of only spaces', { reason: '   ' }],
      ['a reason of 501 characters', { reason: 'x'.repeat(501) }],
      ['a missing lessonId', { lessonId: undefined }],
      ['a lessonId that is not a UUID', { lessonId: 'lesson-1' }],
      ['a confirmationToken on a propose', { confirmationToken: 'abc' }],
      ['a householdId', { householdId: 'house-1' }],
      ['a force flag', { force: true }],
      ['an unknown step', { step: 'maybe' }],
    ])('rejects %s', async (_label, overrides) => {
      fx = await createCancelFixture();
      const sessionId = await signInViaTool(fx.connection.client);
      const before = fx.fake.requests.length;

      const refused = await fx
        .cancel({ ...base, sessionId, ...overrides })
        .then((result) => result.isError === true)
        .catch(() => true);

      expect(refused).toBe(true);
      expect(fx.fake.requests).toHaveLength(before);
    });

    it('accepts a reason of exactly 500 characters and trims it', async () => {
      fx = await createCancelFixture();
      const sessionId = await signInViaTool(fx.connection.client);

      const result = await fx.cancel({
        ...base,
        sessionId,
        reason: `  ${'x'.repeat(500)}  `,
      });

      expect(result.isError).toBeUndefined();
      expect(
        (result.structuredContent as { reason: string }).reason,
      ).toHaveLength(500);
    });
  });
});
