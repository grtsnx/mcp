// Copied from tool.template.spec.ts. This file covers the confirm step when the cancel works: it
// sends exactly one request with exactly { reason }, and the token is single-use, short-lived and
// tied to the sign-in session that proposed it. Failures are in session-cancel.failures.spec.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FAKE_LESSON_ID } from '../../helpers/fake-lessons-data.js';
import { TOKEN_MARKER } from '../../helpers/fake-mssuize.js';
import {
  CANCEL_REASON,
  UNCONFIRMED,
  cancelRequests,
  createCancelFixture,
} from '../../helpers/cancel-fixture.js';
import { signInViaTool } from '../../helpers/household-fixtures.js';
import { textOf } from '../../helpers/tool-harness.js';

const REFUSED =
  'That confirmation is not valid any more. Make a new proposal and ask the parent to confirm it.';

describe('session_cancel tool, step confirm', () => {
  let fx: Awaited<ReturnType<typeof createCancelFixture>>;

  beforeEach(async () => {
    fx = await createCancelFixture();
  });

  afterEach(async () => {
    await fx.close();
  });

  it('sends exactly one cancel with exactly { reason } and reports cancelled', async () => {
    const { sessionId, token } = await fx.proposed();

    const result = await fx.confirm(sessionId, token);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      status: 'cancelled',
      lessonId: FAKE_LESSON_ID,
    });
    const sent = cancelRequests(fx.fake);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.path).toBe(`/api/v1/sessions/${FAKE_LESSON_ID}/cancel`);
    expect(sent[0]?.body).toEqual({ reason: CANCEL_REASON });
    expect(fx.fake.scheduling.statusOf(FAKE_LESSON_ID)).toBe('cancelled');
  });

  it('sends no retry key and no extra field, and never the bulk-cancel route', async () => {
    const { sessionId, token } = await fx.proposed();

    await fx.confirm(sessionId, token);

    const [sent] = cancelRequests(fx.fake);
    expect(Object.keys(sent?.body as object)).toEqual(['reason']);
    expect(Object.keys(sent?.headers ?? {}).join(' ')).not.toMatch(
      /idempoten|retry/i,
    );
    expect(fx.fake.requests.some((request) => /bulk/i.test(request.path))).toBe(
      false,
    );
    expect(
      fx.fake.requests.some((request) => request.path.includes('/agent/')),
    ).toBe(false);
  });

  it('returns nothing but the status and the lessonId, and never the token or a backend message', async () => {
    const { sessionId, token } = await fx.proposed();

    const result = await fx.confirm(sessionId, token);

    const text = JSON.stringify(result);
    expect(Object.keys(result.structuredContent as object).sort()).toEqual([
      'lessonId',
      'status',
    ]);
    expect(text).not.toContain(token);
    expect(text).not.toContain(TOKEN_MARKER);
    expect(text).not.toContain('session cancelled successfully');
  });

  it('reads the lesson back after the cancel', async () => {
    const { sessionId, token } = await fx.proposed();
    const readsBefore = fx.fake.requests.filter(
      (r) =>
        r.method === 'GET' && r.path === `/api/v1/sessions/${FAKE_LESSON_ID}`,
    ).length;

    await fx.confirm(sessionId, token);

    const reads = fx.fake.requests.filter(
      (r) =>
        r.method === 'GET' && r.path === `/api/v1/sessions/${FAKE_LESSON_ID}`,
    ).length;
    expect(reads).toBe(readsBefore + 1);
  });

  it('says unconfirmed, and points at session_get, when the lesson does not show as cancelled', async () => {
    const { sessionId, token } = await fx.proposed();
    fx.fake.scheduling.applyCancel = false;

    const result = await fx.confirm(sessionId, token);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      status: 'unconfirmed',
      lessonId: FAKE_LESSON_ID,
      message: UNCONFIRMED,
    });
    expect(UNCONFIRMED).toMatch(/session_get/);
    expect(cancelRequests(fx.fake)).toHaveLength(1);
  });

  it('says unconfirmed, not failed, when the cancel went through but the read-back failed', async () => {
    const { sessionId, token } = await fx.proposed();
    fx.state.failReadBack = true;

    const result = await fx.confirm(sessionId, token);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ status: 'unconfirmed' });
    expect(cancelRequests(fx.fake)).toHaveLength(1);
  });

  describe('the confirmation token', () => {
    it('works once: a repeat is refused and sends nothing', async () => {
      const { sessionId, token } = await fx.proposed();
      await fx.confirm(sessionId, token);

      const again = await fx.confirm(sessionId, token);

      expect(again.isError).toBe(true);
      expect(textOf(again)).toBe(REFUSED);
      expect(cancelRequests(fx.fake)).toHaveLength(1);
    });

    it('gives the same error for an unknown, used, expired and another session’s token', async () => {
      // The lesson stays scheduled until the first confirm, so every proposal is made before it.
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
      expect(cancelRequests(fx.fake)).toHaveLength(1);
    });

    it('is still good one millisecond before 5 minutes', async () => {
      const { sessionId, token } = await fx.proposed();
      fx.clock.advance(5 * 60_000 - 1);

      const result = await fx.confirm(sessionId, token);

      expect(result.structuredContent).toMatchObject({ status: 'cancelled' });
    });

    it('is refused at 5 minutes, with nothing sent', async () => {
      const { sessionId, token } = await fx.proposed();
      fx.clock.advance(5 * 60_000);

      const result = await fx.confirm(sessionId, token);

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(REFUSED);
      expect(cancelRequests(fx.fake)).toHaveLength(0);
    });

    it('cannot be used by another sign-in session, and still works for its own', async () => {
      const { sessionId, token } = await fx.proposed();
      const stranger = await signInViaTool(fx.connection.client);

      const refused = await fx.confirm(stranger, token);
      expect(refused.isError).toBe(true);
      expect(cancelRequests(fx.fake)).toHaveLength(0);

      const accepted = await fx.confirm(sessionId, token);
      expect(accepted.structuredContent).toMatchObject({ status: 'cancelled' });
      expect(cancelRequests(fx.fake)).toHaveLength(1);
    });

    it('is not a token for a reschedule, and a reschedule token is not one for a cancel', async () => {
      const { sessionId, token } = await fx.proposed();
      const { confirmationToken: moveToken } =
        fx.connection.sessions.createProposal(sessionId, {
          action: 'reschedule',
          lessonId: FAKE_LESSON_ID,
          newStart: '2026-06-02T14:00:00Z',
          newEnd: '2026-06-02T15:00:00Z',
          reason: 'x',
          currentStart: '2026-06-01T14:00:00Z',
          currentEnd: '2026-06-01T15:00:00Z',
        });

      const refused = await fx.confirm(sessionId, moveToken);

      expect(textOf(refused)).toBe(REFUSED);
      expect(cancelRequests(fx.fake)).toHaveLength(0);
      const accepted = await fx.confirm(sessionId, token);
      expect(accepted.structuredContent).toMatchObject({ status: 'cancelled' });
    });

    it('stops working when the person signs out', async () => {
      const { sessionId, token } = await fx.proposed();
      await fx.connection.sessions.logout(sessionId);

      const result = await fx.confirm(sessionId, token);

      expect(result.isError).toBe(true);
      expect(cancelRequests(fx.fake)).toHaveLength(0);
    });

    it('cancels the lesson and reason that were proposed, whatever is sent with the confirm', async () => {
      const { sessionId, token } = await fx.proposed();

      const refused = await fx
        .cancel({
          step: 'confirm',
          sessionId,
          confirmationToken: token,
          lessonId: FAKE_LESSON_ID,
          reason: 'different',
        })
        .then((result) => result.isError === true)
        .catch(() => true);

      expect(refused).toBe(true);
      expect(cancelRequests(fx.fake)).toHaveLength(0);
      await fx.confirm(sessionId, token);
      expect(cancelRequests(fx.fake)[0]?.body).toEqual({
        reason: CANCEL_REASON,
      });
    });
  });

  it.each([
    ['no token', { step: 'confirm' }],
    ['an empty token', { step: 'confirm', confirmationToken: '' }],
    [
      'a token of 257 characters',
      { step: 'confirm', confirmationToken: 'x'.repeat(257) },
    ],
  ])('rejects %s before any backend call', async (_label, extra) => {
    const sessionId = await signInViaTool(fx.connection.client);
    const before = fx.fake.requests.length;

    const refused = await fx
      .cancel({ sessionId, ...extra })
      .then((result) => result.isError === true)
      .catch(() => true);

    expect(refused).toBe(true);
    expect(fx.fake.requests).toHaveLength(before);
  });
});
