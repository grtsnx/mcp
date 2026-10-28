// Copied from tool.template.spec.ts. This file covers what happens when a filing fails or the
// access token has expired. A request is never sent twice: after a 500, a timeout or a network
// error the outcome is reported as unknown. The backend's 400 text is raw internal text and is
// never forwarded; only the exact "pending request already exists" phrase picks a fixed message.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FAKE_LEARNER_ID,
  FAKE_TUTOR_ID,
} from '../../helpers/fake-lessons-data.js';
import { TOKEN_MARKER } from '../../helpers/fake-mssuize.js';
import {
  DB_ERROR_MARKER,
  DUPLICATE_TEXT,
} from '../../helpers/fake-tutor-change.js';
import { openSession } from '../../helpers/household-fixtures.js';
import { textOf } from '../../helpers/tool-harness.js';
import {
  UNKNOWN_FILING,
  createRequests,
  createTutorChangeFixture,
} from '../../helpers/tutor-change-fixture.js';

describe('tutor_change_request_create tool, when a filing fails', () => {
  let fx: Awaited<ReturnType<typeof createTutorChangeFixture>>;

  beforeEach(async () => {
    fx = await createTutorChangeFixture();
  });

  afterEach(async () => {
    await fx.close();
  });

  describe('a 5xx, a timeout or a network error: the outcome is unknown, so nothing is retried', () => {
    it.each([
      [
        'a 500',
        { status: 500, text: `failed to create request: ${DB_ERROR_MARKER}` },
      ],
      ['a timeout', 'timeout' as const],
      ['a 502', { status: 502, text: 'bad gateway' }],
      ['a 503', { status: 503, text: 'unavailable' }],
      ['a 504', { status: 504, text: 'gateway timeout' }],
    ])(
      'after %s: one request, the unknown-outcome error, and no backend text',
      async (_label, outcome) => {
        const { sessionId, token } = await fx.proposed();
        fx.fake.tutorChange.createOutcome = outcome;

        const result = await fx.confirm(sessionId, token);

        expect(result.isError).toBe(true);
        expect(textOf(result)).toBe(UNKNOWN_FILING);
        expect(textOf(result)).toMatch(/Do not try again/);
        expect(textOf(result)).toMatch(/tutor_change_request_list/);
        expect(JSON.stringify(result)).not.toContain('SECRET-DB-DETAIL');
        expect(createRequests(fx.fake)).toHaveLength(1);
      },
    );

    it('says unknown even when the request was filed, because it cannot tell', async () => {
      const { sessionId, token } = await fx.proposed();
      fx.fake.tutorChange.createOutcome = 'timeout';
      fx.fake.tutorChange.createSavedDespiteFailure = true;

      const result = await fx.confirm(sessionId, token);

      expect(textOf(result)).toBe(UNKNOWN_FILING);
      expect(createRequests(fx.fake)).toHaveLength(1);
    });

    it('says unknown, not filed, when the reply is not the pending status the tool expects', async () => {
      const { sessionId, token } = await fx.proposed();
      fx.fake.tutorChange.replyStatus = 'approved';

      const result = await fx.confirm(sessionId, token);

      expect(textOf(result)).toBe(UNKNOWN_FILING);
      expect(createRequests(fx.fake)).toHaveLength(1);
    });

    it('does not retry when the same token is used again after a failure', async () => {
      const { sessionId, token } = await fx.proposed();
      fx.fake.tutorChange.createOutcome = 'timeout';
      await fx.confirm(sessionId, token);

      const again = await fx.confirm(sessionId, token);

      expect(again.isError).toBe(true);
      expect(textOf(again)).toMatch(/not valid any more/);
      expect(createRequests(fx.fake)).toHaveLength(1);
    });

    it('does not retry on its own even when the backend would now succeed', async () => {
      const { sessionId, token } = await fx.proposed();
      fx.fake.tutorChange.createOutcome = { status: 500, text: 'boom' };
      await fx.confirm(sessionId, token);
      fx.fake.tutorChange.createOutcome = 'success';

      expect(createRequests(fx.fake)).toHaveLength(1);
      expect(fx.fake.tutorChange.requests).toHaveLength(1);
    });
  });

  describe('a 400: only one exact phrase picks a message, the text is never forwarded', () => {
    it('maps the exact duplicate phrase to the fixed pending message', async () => {
      const { sessionId, token } = await fx.proposed();
      fx.fake.tutorChange.createOutcome = { status: 400, text: DUPLICATE_TEXT };

      const result = await fx.confirm(sessionId, token);

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(
        'A request for this tutor is already pending.',
      );
      expect(createRequests(fx.fake)).toHaveLength(1);
    });

    it('maps a real duplicate (filed after the proposal) the same way, with one request sent', async () => {
      const { sessionId, token } = await fx.proposed();
      fx.fake.tutorChange.requests.push({
        id: 'e1b2c3d4-0009-4222-8333-444455556666',
        learnerId: FAKE_LEARNER_ID,
        currentTutorId: FAKE_TUTOR_ID,
        status: 'pending',
      });

      const result = await fx.confirm(sessionId, token);

      expect(textOf(result)).toBe(
        'A request for this tutor is already pending.',
      );
      expect(createRequests(fx.fake)).toHaveLength(1);
    });

    it.each([
      ['database error text', `failed to create request: ${DB_ERROR_MARKER}`],
      [
        'the learner lookup failure',
        `learner not found or no household: ${DB_ERROR_MARKER}`,
      ],
      ['the required-fields text', 'learnerId and currentTutorId are required'],
      ['an invalid id', 'invalid tutor ID'],
      ['text that only mentions pending', 'a request is pending somewhere'],
    ])(
      'turns %s into "The request was not accepted." and forwards none of it',
      async (_label, text) => {
        const { sessionId, token } = await fx.proposed();
        fx.fake.tutorChange.createOutcome = { status: 400, text };

        const result = await fx.confirm(sessionId, token);

        expect(result.isError).toBe(true);
        expect(textOf(result)).toBe('The request was not accepted.');
        expect(JSON.stringify(result)).not.toContain('SECRET-DB-DETAIL');
        expect(JSON.stringify(result)).not.toContain(text);
        expect(createRequests(fx.fake)).toHaveLength(1);
      },
    );

    it.each([
      [403, 'Not allowed to change this learner’s tutor.'],
      [404, 'Lesson not found.'],
    ])('reports a %i with fixed wording, once', async (status, wording) => {
      const { sessionId, token } = await fx.proposed();
      fx.fake.tutorChange.createOutcome = { status, text: 'BACKEND-TEXT' };

      const result = await fx.confirm(sessionId, token);

      expect(textOf(result)).toBe(wording);
      expect(createRequests(fx.fake)).toHaveLength(1);
    });
  });

  describe('an expired access token', () => {
    it('refreshes once and sends the request once more after a 401, then reports filed', async () => {
      const { sessionId, token } = await fx.proposed();
      fx.fake.expireAccessTokens();

      const result = await fx.confirm(sessionId, token);

      expect(result.structuredContent).toMatchObject({ status: 'filed' });
      expect(fx.fake.refreshCalls).toBe(1);
      // The first is rejected by the backend before it runs anything; the second is the only one that counts.
      expect(createRequests(fx.fake)).toHaveLength(2);
      expect(createRequests(fx.fake)[1]?.body).toEqual(
        createRequests(fx.fake)[0]?.body,
      );
      expect(fx.fake.tutorChange.requests).toHaveLength(2);
    });

    it('ends the session and files nothing when the refresh is refused', async () => {
      const { sessionId, token } = await fx.proposed();
      fx.fake.expireAccessTokens();
      fx.fake.refreshFailure = 401;

      const result = await fx.confirm(sessionId, token);

      expect(result.isError).toBe(true);
      expect(textOf(result)).not.toBe(UNKNOWN_FILING);
      expect(textOf(result)).toMatch(/sign in again/i);
      expect(fx.fake.tutorChange.requests).toHaveLength(1);
    });
  });

  it('keeps tokens, the backend’s text and the password out of every failure', async () => {
    const outputs: unknown[] = [];
    for (const outcome of [
      { status: 500, text: `failed: ${DB_ERROR_MARKER}` },
      'timeout' as const,
      { status: 400, text: DB_ERROR_MARKER },
    ]) {
      const { sessionId, token } = await fx.proposed();
      fx.fake.tutorChange.createOutcome = outcome;
      outputs.push(await fx.confirm(sessionId, token));
    }

    const text = JSON.stringify(outputs);
    expect(text).not.toContain(TOKEN_MARKER);
    expect(text).not.toContain('SECRET-DB-DETAIL');
    expect(text).not.toContain('refresh_token');
  });

  it('refuses a tutor’s session at confirm time with no backend call', async () => {
    const tutor = openSession(
      fx.fake,
      fx.connection.sessions,
      'house-1',
      'tutor',
    );
    const { confirmationToken } = fx.connection.sessions.createProposal(tutor, {
      action: 'cancel',
      lessonId: '8a1f6e52-2c4b-4f0e-bd51-7c9e0a1b2c3d',
      reason: 'x',
    });
    const before = fx.fake.requests.length;

    const result = await fx.confirm(tutor, confirmationToken);

    expect(result.isError).toBe(true);
    expect(fx.fake.requests).toHaveLength(before);
  });
});
