// Copied from tool.template.spec.ts. tutor_change_request_create is a write tool: this file covers
// the propose step, which must never change anything. The backend checks neither that the person
// may act for the learner nor that the tutor is the learner's, so the tool does both here.
import { afterEach, describe, expect, it } from 'vitest';
import {
  FAKE_LEARNER_ID,
  FAKE_OTHER_LEARNER_ID,
  FAKE_OTHER_LESSON_ID,
  FAKE_SECOND_LEARNER_LESSON_ID,
  FAKE_TUTOR_ID,
  FAKE_UNKNOWN_LESSON_ID,
  SIGNED_LINK_MARKER,
  TUTOR_EMAIL_MARKER,
} from '../../helpers/fake-lessons-data.js';
import { TOKEN_MARKER } from '../../helpers/fake-mssuize.js';
import { openSession } from '../../helpers/household-fixtures.js';
import { textOf } from '../../helpers/tool-harness.js';
import {
  CHANGE_REASON,
  CHECK_UNAVAILABLE,
  SENT_TO_STAFF,
  createRequests,
  createTutorChangeFixture,
  lessonReads,
} from '../../helpers/tutor-change-fixture.js';

describe('tutor_change_request_create tool, step propose', () => {
  let fx: Awaited<ReturnType<typeof createTutorChangeFixture>>;

  afterEach(async () => {
    await fx.close();
  });

  it('is listed as one plain object, not read-only, not destructive, not idempotent, with no tutor id field', async () => {
    fx = await createTutorChangeFixture();
    const { tools } = await fx.connection.client.listTools();
    const tool = tools.find(
      (candidate) => candidate.name === 'tutor_change_request_create',
    );
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
      'learnerId',
      'lessonId',
      'reason',
      'step',
    ]);
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    });
  });

  it('tells the model the staff decide, that it does not change the tutor, and never to confirm alone', async () => {
    fx = await createTutorChangeFixture();
    const { tools } = await fx.connection.client.listTools();
    const description =
      tools.find(
        (candidate) => candidate.name === 'tutor_change_request_create',
      )?.description ?? '';

    expect(description).toMatch(/goes to the staff, who decide/);
    expect(description).toMatch(/does NOT change the tutor by itself/);
    expect(description).toMatch(/never give a tutor id/);
    expect(description).toMatch(/explicit yes BEFORE calling step 'confirm'/);
    expect(description).toMatch(/never confirm on your own/);
    expect(description).toMatch(/NEVER retried/);
    expect(description).toMatch(/tutor_change_request_list/);
    expect(description).toMatch(/comes from the request’s sign-in/);
  });

  it('proposes with exactly the documented fields, and changes NOTHING', async () => {
    fx = await createTutorChangeFixture();
    const sessionId = await fx.signIn();

    const result = await fx.propose(sessionId);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      status: 'proposed',
      confirmationToken: expect.stringMatching(/^[A-Za-z0-9_-]{43,}$/),
      learnerFirstName: 'Byron',
      tutorFirstName: 'Grace',
      tutorLastName: 'Hopper',
      reason: CHANGE_REASON,
      alreadyPending: false,
      expiresInSeconds: 300,
      note: SENT_TO_STAFF,
    });
    expect(createRequests(fx.fake)).toHaveLength(0);
    expect(fx.fake.tutorChange.requests).toHaveLength(1);
  });

  it('never returns the tutor id, the tutor’s email, a signed link or a token', async () => {
    fx = await createTutorChangeFixture();

    const text = JSON.stringify(await fx.propose(await fx.signIn()));

    expect(text).not.toContain(FAKE_TUTOR_ID);
    expect(text).not.toContain(TUTOR_EMAIL_MARKER);
    expect(text).not.toContain(SIGNED_LINK_MARKER);
    expect(text).not.toContain(TOKEN_MARKER);
    expect(text).not.toMatch(/tutorId|currentTutorId/);
  });

  describe('the lesson and the learner are checked here, because the backend does not', () => {
    it('refuses a lesson that belongs to another learner of the household, with no token and no request', async () => {
      fx = await createTutorChangeFixture();

      const result = await fx.propose(await fx.signIn(), {
        lessonId: FAKE_SECOND_LEARNER_LESSON_ID,
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(
        'That lesson does not belong to this learner.',
      );
      expect(JSON.stringify(result)).not.toContain('confirmationToken');
      expect(createRequests(fx.fake)).toHaveLength(0);
    });

    it('refuses a learner that is not in the household, before any lesson is read', async () => {
      fx = await createTutorChangeFixture();

      const result = await fx.propose(await fx.signIn(), {
        learnerId: FAKE_OTHER_LEARNER_ID,
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(
        'Not allowed to change this learner’s tutor.',
      );
      expect(lessonReads(fx.fake)).toEqual([]);
      expect(createRequests(fx.fake)).toHaveLength(0);
    });

    it('refuses a lesson of another household, which the backend answers with a 403', async () => {
      fx = await createTutorChangeFixture();

      const result = await fx.propose(await fx.signIn(), {
        lessonId: FAKE_OTHER_LESSON_ID,
      });

      expect(textOf(result)).toBe(
        'Not allowed to change this learner’s tutor.',
      );
      expect(createRequests(fx.fake)).toHaveLength(0);
    });

    it('says Lesson not found for an unknown lesson', async () => {
      fx = await createTutorChangeFixture();

      const result = await fx.propose(await fx.signIn(), {
        lessonId: FAKE_UNKNOWN_LESSON_ID,
      });

      expect(textOf(result)).toBe('Lesson not found.');
    });

    it('refuses a lesson with no tutor', async () => {
      fx = await createTutorChangeFixture();
      fx.fake.scheduling.omitTutorId = true;

      const result = await fx.propose(await fx.signIn());

      expect(textOf(result)).toBe('That lesson has no tutor to ask about.');
      expect(createRequests(fx.fake)).toHaveLength(0);
    });
  });

  describe('a request that is already pending', () => {
    it('is refused at propose, with no token', async () => {
      fx = await createTutorChangeFixture();
      fx.fake.tutorChange.requests.push({
        id: 'e1b2c3d4-0002-4222-8333-444455556666',
        learnerId: FAKE_LEARNER_ID,
        currentTutorId: FAKE_TUTOR_ID,
        status: 'pending',
      });

      const result = await fx.propose(await fx.signIn());

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(
        'A request for this tutor is already pending.',
      );
      expect(JSON.stringify(result)).not.toContain('confirmationToken');
      expect(createRequests(fx.fake)).toHaveLength(0);
    });

    it.each([
      [
        'a request that was already decided',
        {
          status: 'approved',
          currentTutorId: FAKE_TUTOR_ID,
          learnerId: FAKE_LEARNER_ID,
        },
      ],
      [
        'a pending request for another tutor',
        {
          status: 'pending',
          currentTutorId: '9a9a9a9a-0000-4000-8000-000000000001',
          learnerId: FAKE_LEARNER_ID,
        },
      ],
    ])('does not count %s', async (_label, stored) => {
      fx = await createTutorChangeFixture();
      fx.fake.tutorChange.requests.push({
        id: 'e1b2c3d4-0003-4222-8333-444455556666',
        ...stored,
      });

      const result = await fx.propose(await fx.signIn());

      expect(result.structuredContent).toMatchObject({ status: 'proposed' });
    });

    it('does not count a pending request for another household’s learner', async () => {
      fx = await createTutorChangeFixture();

      const result = await fx.propose(await fx.signIn());

      expect(result.structuredContent).toMatchObject({ status: 'proposed' });
    });
  });

  describe('when the check for a pending request fails, it says so and carries on', () => {
    it.each([
      [
        'the backend cannot find the household',
        { status: 400, text: 'could not determine household' },
      ],
      [
        'a 500',
        { status: 500, text: 'failed to fetch requests: pq: SECRET-DB-DETAIL' },
      ],
      ['a 403', { status: 403, text: 'forbidden' }],
    ])('after %s', async (_label, listOutcome) => {
      fx = await createTutorChangeFixture();
      fx.fake.tutorChange.listOutcome = listOutcome;

      const result = await fx.propose(await fx.signIn());

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({
        status: 'proposed',
        alreadyPending: false,
        note: CHECK_UNAVAILABLE,
      });
      expect(JSON.stringify(result)).not.toContain('SECRET-DB-DETAIL');
      expect(createRequests(fx.fake)).toHaveLength(0);
    });
  });

  describe('who may propose', () => {
    it('refuses a tutor before any backend call', async () => {
      fx = await createTutorChangeFixture();
      const sessionId = openSession(
        fx.fake,
        fx.connection.sessions,
        'house-1',
        'tutor',
      );
      const before = fx.fake.requests.length;

      const result = await fx.propose(sessionId);

      expect(result.isError).toBe(true);
      expect(fx.fake.requests).toHaveLength(before);
    });

    it('refuses a session with no household without reading a lesson', async () => {
      fx = await createTutorChangeFixture();
      const sessionId = openSession(fx.fake, fx.connection.sessions, null);

      const result = await fx.propose(sessionId);

      expect(result.isError).toBe(true);
      expect(lessonReads(fx.fake)).toEqual([]);
    });

    it('refuses an unknown session before any backend call', async () => {
      fx = await createTutorChangeFixture();
      const before = fx.fake.requests.length;

      const result = await fx.propose('no-such-session');

      expect(result.isError).toBe(true);
      expect(fx.fake.requests).toHaveLength(before);
    });

    it('uses only the guardian-facing routes', async () => {
      fx = await createTutorChangeFixture();

      await fx.propose(await fx.signIn());

      expect(
        fx.fake.requests.some((request) => request.path.includes('/agent/')),
      ).toBe(false);
    });
  });

  describe('input checked before any backend call', () => {
    it.each([
      ['a tutor id', { tutorId: FAKE_TUTOR_ID }],
      ['a currentTutorId', { currentTutorId: FAKE_TUTOR_ID }],
      ['a householdId', { householdId: 'house-1' }],
      ['a missing learnerId', { learnerId: undefined }],
      ['a missing lessonId', { lessonId: undefined }],
      ['a missing reason', { reason: undefined }],
      ['an empty reason', { reason: '' }],
      ['a reason of only spaces', { reason: '   ' }],
      ['a reason of 501 characters', { reason: 'x'.repeat(501) }],
      ['a learnerId that is not a UUID', { learnerId: 'learner-1' }],
      ['a lessonId that is not a UUID', { lessonId: 'lesson-1' }],
      ['a confirmationToken on a propose', { confirmationToken: 'abc' }],
      ['an unknown step', { step: 'maybe' }],
    ])('rejects %s', async (_label, overrides) => {
      fx = await createTutorChangeFixture();
      const sessionId = await fx.signIn();
      const before = fx.fake.requests.length;

      const refused = await fx
        .propose(sessionId, overrides)
        .then((result) => result.isError === true)
        .catch(() => true);

      expect(refused).toBe(true);
      expect(fx.fake.requests).toHaveLength(before);
    });

    it('accepts a reason of exactly 500 characters and trims it', async () => {
      fx = await createTutorChangeFixture();

      const result = await fx.propose(await fx.signIn(), {
        reason: `  ${'x'.repeat(500)}  `,
      });

      expect(
        (result.structuredContent as { reason: string }).reason,
      ).toHaveLength(500);
    });
  });
});
