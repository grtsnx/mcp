// Copied from tool.template.spec.ts. This file covers the confirm step when the filing works: it
// sends exactly one request with exactly { learnerId, currentTutorId, reason }, and the tutor id
// comes from the lesson, never from the model. The token is single-use, short-lived, and tied to
// the sign-in session and the action. Failures are in tutor-change-request-create.failures.spec.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FAKE_LEARNER_ID,
  FAKE_LESSON_ID,
  FAKE_TUTOR_ID,
} from '../../helpers/fake-lessons-data.js';
import { TOKEN_MARKER } from '../../helpers/fake-mssuize.js';
import { signInViaTool } from '../../helpers/household-fixtures.js';
import { textOf } from '../../helpers/tool-harness.js';
import {
  CHANGE_REASON,
  REFUSED,
  SENT_TO_STAFF,
  createRequests,
  createTutorChangeFixture,
} from '../../helpers/tutor-change-fixture.js';

describe('tutor_change_request_create tool, step confirm', () => {
  let fx: Awaited<ReturnType<typeof createTutorChangeFixture>>;

  beforeEach(async () => {
    fx = await createTutorChangeFixture();
  });

  afterEach(async () => {
    await fx.close();
  });

  it('sends exactly one request with exactly { learnerId, currentTutorId, reason } and reports it filed', async () => {
    const { sessionId, token } = await fx.proposed();

    const result = await fx.confirm(sessionId, token);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      status: 'filed',
      requestStatus: 'pending',
      note: SENT_TO_STAFF,
    });
    const sent = createRequests(fx.fake);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toEqual({
      learnerId: FAKE_LEARNER_ID,
      currentTutorId: FAKE_TUTOR_ID,
      reason: CHANGE_REASON,
    });
    expect(Object.keys(sent[0]?.body as object).sort()).toEqual([
      'currentTutorId',
      'learnerId',
      'reason',
    ]);
  });

  it('takes the tutor from the lesson: the tutor id sent is the lesson’s, and no input could supply another', async () => {
    const { sessionId, token } = await fx.proposed();
    const lessonRead = fx.fake.requests.find(
      (request) =>
        request.method === 'GET' &&
        request.path === `/api/v1/sessions/${FAKE_LESSON_ID}`,
    );

    await fx.confirm(sessionId, token);

    expect(lessonRead).toBeDefined();
    const body = createRequests(fx.fake)[0]?.body as {
      currentTutorId: string;
    };
    expect(body.currentTutorId).toBe(FAKE_TUTOR_ID);
  });

  it('sends no retry key, no extra header field and no other write', async () => {
    const { sessionId, token } = await fx.proposed();

    await fx.confirm(sessionId, token);

    expect(
      Object.keys(createRequests(fx.fake)[0]?.headers ?? {}).join(' '),
    ).not.toMatch(/idempoten|retry/i);
    expect(
      fx.fake.requests.filter(
        (request) =>
          request.method !== 'GET' && !request.path.startsWith('/api/v1/auth/'),
      ),
    ).toHaveLength(1);
    expect(
      fx.fake.requests.some((request) => request.path.includes('/admin/')),
    ).toBe(false);
  });

  it('files the request in the backend as pending', async () => {
    const { sessionId, token } = await fx.proposed();

    await fx.confirm(sessionId, token);

    expect(
      fx.fake.tutorChange.requests.filter(
        (stored) => stored.learnerId === FAKE_LEARNER_ID,
      ),
    ).toHaveLength(1);
  });

  it('returns only the status: no request id, no backend message, no token, no tutor id', async () => {
    const { sessionId, token } = await fx.proposed();

    const result = await fx.confirm(sessionId, token);

    const text = JSON.stringify(result);
    expect(Object.keys(result.structuredContent as object).sort()).toEqual([
      'note',
      'requestStatus',
      'status',
    ]);
    expect(text).not.toContain(token);
    expect(text).not.toContain(TOKEN_MARKER);
    expect(text).not.toContain(FAKE_TUTOR_ID);
    expect(text).not.toContain('submitted successfully');
    expect(text).not.toMatch(/e1b2c3d4/);
  });

  it('says the staff decide and that it does not change the tutor', async () => {
    const { sessionId, token } = await fx.proposed();

    const result = await fx.confirm(sessionId, token);

    expect(textOf(result)).toMatch(/school's staff, who decide/);
    expect(textOf(result)).toMatch(/does not change the tutor by itself/);
  });

  describe('the confirmation token', () => {
    it('works once: a repeat is refused and files nothing more', async () => {
      const { sessionId, token } = await fx.proposed();
      await fx.confirm(sessionId, token);

      const again = await fx.confirm(sessionId, token);

      expect(again.isError).toBe(true);
      expect(textOf(again)).toBe(REFUSED);
      expect(createRequests(fx.fake)).toHaveLength(1);
    });

    it('gives the same error for an unknown, used, expired and another session’s token', async () => {
      const used = await fx.proposed();
      const expired = await fx.proposed();
      const other = await fx.proposed();
      const stranger = await signInViaTool(fx.connection.client);
      await fx.confirm(used.sessionId, used.token);
      fx.clock.advance(5 * 60_000 + 1);

      const texts = [
        textOf(await fx.confirm(used.sessionId, used.token)),
        textOf(await fx.confirm(expired.sessionId, expired.token)),
        textOf(await fx.confirm(stranger, other.token)),
        textOf(await fx.confirm(other.sessionId, 'not-a-real-token')),
      ];

      expect(new Set(texts)).toEqual(new Set([REFUSED]));
      expect(createRequests(fx.fake)).toHaveLength(1);
    });

    it('is still good one millisecond before 5 minutes and refused at 5 minutes', async () => {
      const early = await fx.proposed();
      fx.clock.advance(5 * 60_000 - 1);
      expect(
        (await fx.confirm(early.sessionId, early.token)).structuredContent,
      ).toMatchObject({ status: 'filed' });
      fx.fake.tutorChange.reset();

      const late = await fx.proposed();
      fx.clock.advance(5 * 60_000);
      const refused = await fx.confirm(late.sessionId, late.token);

      expect(textOf(refused)).toBe(REFUSED);
      expect(createRequests(fx.fake)).toHaveLength(1);
    });

    it('cannot be used by another sign-in session, and still works for its own', async () => {
      const { sessionId, token } = await fx.proposed();
      const stranger = await signInViaTool(fx.connection.client);

      expect((await fx.confirm(stranger, token)).isError).toBe(true);
      expect(createRequests(fx.fake)).toHaveLength(0);
      expect(
        (await fx.confirm(sessionId, token)).structuredContent,
      ).toMatchObject({ status: 'filed' });
    });

    it('is not a token for a cancel, and a cancel token is not one for a request', async () => {
      const { sessionId, token } = await fx.proposed();
      const { confirmationToken: cancelToken } =
        fx.connection.sessions.createProposal(sessionId, {
          action: 'cancel',
          lessonId: FAKE_LESSON_ID,
          reason: 'x',
        });

      const refused = await fx.confirm(sessionId, cancelToken);

      expect(textOf(refused)).toBe(REFUSED);
      expect(createRequests(fx.fake)).toHaveLength(0);
      expect(
        (await fx.confirm(sessionId, token)).structuredContent,
      ).toMatchObject({ status: 'filed' });
    });

    it('stops working when the person signs out', async () => {
      const { sessionId, token } = await fx.proposed();
      await fx.connection.sessions.logout(sessionId);

      const result = await fx.confirm(sessionId, token);

      expect(result.isError).toBe(true);
      expect(createRequests(fx.fake)).toHaveLength(0);
    });

    it('files the learner, tutor and reason that were proposed, whatever is sent with the confirm', async () => {
      const { sessionId, token } = await fx.proposed();

      const refused = await fx
        .create({
          step: 'confirm',
          sessionId,
          confirmationToken: token,
          learnerId: FAKE_LEARNER_ID,
          lessonId: FAKE_LESSON_ID,
          reason: 'different',
        })
        .then((result) => result.isError === true)
        .catch(() => true);
      const refusedTutor = await fx
        .create({
          step: 'confirm',
          sessionId,
          confirmationToken: token,
          currentTutorId: '9a9a9a9a-0000-4000-8000-000000000001',
        })
        .then((result) => result.isError === true)
        .catch(() => true);

      expect(refused).toBe(true);
      expect(refusedTutor).toBe(true);
      expect(createRequests(fx.fake)).toHaveLength(0);
      await fx.confirm(sessionId, token);
      expect(createRequests(fx.fake)[0]?.body).toEqual({
        learnerId: FAKE_LEARNER_ID,
        currentTutorId: FAKE_TUTOR_ID,
        reason: CHANGE_REASON,
      });
    });
  });

  it.each([
    ['no token', { confirmationToken: undefined }],
    ['an empty token', { confirmationToken: '' }],
    ['a token of 257 characters', { confirmationToken: 'x'.repeat(257) }],
  ])('rejects %s before any backend call', async (_label, extra) => {
    const sessionId = await signInViaTool(fx.connection.client);
    const before = fx.fake.requests.length;

    const refused = await fx
      .create({ step: 'confirm', sessionId, ...extra })
      .then((result) => result.isError === true)
      .catch(() => true);

    expect(refused).toBe(true);
    expect(fx.fake.requests).toHaveLength(before);
  });
});
