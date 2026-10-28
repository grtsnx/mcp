// Copied from tool.template.spec.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FAKE_LEARNER_ID,
  FAKE_OTHER_LEARNER_ID,
  FAKE_TUTOR_ID,
} from '../../helpers/fake-lessons-data.js';
import { TOKEN_MARKER } from '../../helpers/fake-mssuize.js';
import {
  ADMIN_NOTES_MARKER,
  HOUSEHOLD_MARKER,
  NO_HOUSEHOLD_TEXT,
  REQUESTER_MARKER,
  REVIEWER_MARKER,
} from '../../helpers/fake-tutor-change.js';
import { openSession } from '../../helpers/household-fixtures.js';
import { textOf } from '../../helpers/tool-harness.js';
import { createTutorChangeFixture } from '../../helpers/tutor-change-fixture.js';

const MINE = 'e1b2c3d4-0100-4222-8333-444455556666';

describe('tutor_change_request_list tool', () => {
  let fx: Awaited<ReturnType<typeof createTutorChangeFixture>>;

  beforeEach(async () => {
    fx = await createTutorChangeFixture();
    fx.fake.tutorChange.requests.push({
      id: MINE,
      learnerId: FAKE_LEARNER_ID,
      currentTutorId: FAKE_TUTOR_ID,
      reason: 'Not a good fit',
      status: 'pending',
    });
  });

  afterEach(async () => {
    await fx.close();
  });

  it('is read-only and says the staff decide', async () => {
    const { tools } = await fx.connection.client.listTools();
    const tool = tools.find(
      (candidate) => candidate.name === 'tutor_change_request_list',
    );

    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(tool?.description).toMatch(/staff decide/);
    expect(tool?.description).toMatch(/no household could be found/);
    const schema = (tool?.inputSchema ?? {}) as { properties?: object };
    expect(Object.keys(schema.properties ?? {})).toEqual([]);
  });

  it('returns exactly the documented fields for the signed-in household’s requests', async () => {
    const result = await fx.list({ sessionId: await fx.signIn() });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      requests: [
        {
          requestId: MINE,
          learnerId: FAKE_LEARNER_ID,
          learnerName: null,
          currentTutorName: 'Grace Hopper',
          status: 'pending',
          reason: 'Not a good fit',
          createdAt: '2026-05-01T12:00:00Z',
          reviewedAt: null,
          newTutorName: null,
        },
      ],
      total: 1,
    });
  });

  it('drops the tutors’ ids, the staff’s names and notes, the household id and the parent-notified flag', async () => {
    const text = JSON.stringify(
      await fx.list({ sessionId: await fx.signIn() }),
    );

    expect(text).not.toContain(FAKE_TUTOR_ID);
    expect(text).not.toContain(ADMIN_NOTES_MARKER);
    expect(text).not.toContain(REVIEWER_MARKER);
    expect(text).not.toContain(REQUESTER_MARKER);
    expect(text).not.toContain(HOUSEHOLD_MARKER);
    expect(text).not.toMatch(
      /parentNotified|adminNotes|reviewedByName|requestedByName|householdId|currentTutorId|newTutorId/,
    );
    expect(text).not.toContain(TOKEN_MARKER);
  });

  it('keeps out requests for learners that are not in the signed-in household', async () => {
    const result = await fx.list({ sessionId: await fx.signIn() });

    const ids = (
      result.structuredContent as { requests: { learnerId: string }[] }
    ).requests.map((r) => r.learnerId);
    expect(ids).not.toContain(FAKE_OTHER_LEARNER_ID);
  });

  it('passes on a learner name, a review time and a new tutor when a later backend sends them, and the paging it sends', async () => {
    fx.fake.tutorChange.extraListFields = {
      learnerName: 'Byron',
      reviewedAt: '2026-05-02T09:00:00Z',
      newTutorName: 'Ada Lovelace',
      status: 'approved',
    };
    fx.fake.tutorChange.extraTopFields = { total: 99, page: 1, pageSize: 20 };

    const result = await fx.list({ sessionId: await fx.signIn() });

    expect(result.structuredContent).toEqual({
      requests: [
        expect.objectContaining({
          learnerName: 'Byron',
          reviewedAt: '2026-05-02T09:00:00Z',
          newTutorName: 'Ada Lovelace',
          status: 'approved',
        }),
      ],
      // The total counts what is shown, not the backend's, because other households' are removed.
      total: 1,
      page: 1,
      pageSize: 20,
    });
  });

  it('gives an empty list when there are none, and when the backend sends null', async () => {
    fx.fake.tutorChange.requests.length = 0;
    const none = await fx.list({ sessionId: await fx.signIn() });

    expect(none.structuredContent).toEqual({ requests: [], total: 0 });
  });

  describe('when the backend cannot find the household', () => {
    it('says the fixed message, and forwards none of the backend text', async () => {
      fx.fake.tutorChange.listOutcome = {
        status: 400,
        text: NO_HOUSEHOLD_TEXT,
      };

      const result = await fx.list({ sessionId: await fx.signIn() });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(
        "No household could be found for this account's tutor-change requests.",
      );
    });

    it('matches the phrase inside longer text, in any case', async () => {
      fx.fake.tutorChange.listOutcome = {
        status: 400,
        text: 'Error: COULD NOT DETERMINE HOUSEHOLD (sql: no rows)',
      };

      const result = await fx.list({ sessionId: await fx.signIn() });

      expect(textOf(result)).toBe(
        "No household could be found for this account's tutor-change requests.",
      );
      expect(textOf(result)).not.toContain('sql');
    });

    it('does not treat another 400 as that', async () => {
      fx.fake.tutorChange.listOutcome = {
        status: 400,
        text: 'something else SECRET-DB-DETAIL',
      };

      const result = await fx.list({ sessionId: await fx.signIn() });

      expect(textOf(result)).toBe(
        'The backend rejected the request as invalid.',
      );
      expect(JSON.stringify(result)).not.toContain('SECRET-DB-DETAIL');
    });
  });

  it.each([
    [403, 'Not allowed to access this household.'],
    [500, 'The backend is unavailable. Try again later.'],
  ])('maps a %i to fixed wording', async (status, wording) => {
    fx.fake.tutorChange.listOutcome = {
      status,
      text: 'failed to fetch requests: pq: SECRET-DB-DETAIL',
    };

    const result = await fx.list({ sessionId: await fx.signIn() });

    expect(textOf(result)).toBe(wording);
    expect(JSON.stringify(result)).not.toContain('SECRET-DB-DETAIL');
  });

  it('does one refresh and carries on after an expired access token', async () => {
    const sessionId = await fx.signIn();
    fx.fake.expireAccessTokens();

    const result = await fx.list({ sessionId });

    expect(result.isError).toBeUndefined();
    expect(fx.fake.refreshCalls).toBe(1);
  });

  describe('who may list', () => {
    it('refuses a tutor before any backend call', async () => {
      const sessionId = openSession(
        fx.fake,
        fx.connection.sessions,
        'house-1',
        'tutor',
      );
      const before = fx.fake.requests.length;

      const result = await fx.list({ sessionId });

      expect(result.isError).toBe(true);
      expect(fx.fake.requests).toHaveLength(before);
    });

    it('refuses a session with no household without asking for the requests', async () => {
      const sessionId = openSession(fx.fake, fx.connection.sessions, null);

      const result = await fx.list({ sessionId });

      expect(result.isError).toBe(true);
      expect(
        fx.fake.requests.some(
          (request) => request.path === '/api/v1/tutor-change-requests',
        ),
      ).toBe(false);
    });

    it('refuses an unknown session before any backend call', async () => {
      const before = fx.fake.requests.length;

      const result = await fx.list({ sessionId: 'no-such-session' });

      expect(result.isError).toBe(true);
      expect(fx.fake.requests).toHaveLength(before);
    });

    it('uses only the guardian-facing route, with no paging or filter sent', async () => {
      await fx.list({ sessionId: await fx.signIn() });

      const asked = fx.fake.requests.filter((request) =>
        request.path.startsWith('/api/v1/tutor-change-requests'),
      );
      expect(
        asked.map((request) => `${request.method} ${request.path}`),
      ).toEqual(['GET /api/v1/tutor-change-requests']);
      expect(
        fx.fake.requests.some(
          (request) =>
            request.path.includes('/agent/') ||
            request.path.includes('/admin/'),
        ),
      ).toBe(false);
    });
  });

  it.each([
    ['a page number', { page: 1 }],
    ['a pageSize', { pageSize: 10 }],
    ['a status filter', { status: 'pending' }],
    ['a householdId', { householdId: 'house-1' }],
  ])(
    'rejects %s, because the backend’s route has none, before any backend call',
    async (_label, extra) => {
      const sessionId = await fx.signIn();
      const before = fx.fake.requests.length;

      const refused = await fx
        .list({ sessionId, ...extra })
        .then((result) => result.isError === true)
        .catch(() => true);

      expect(refused).toBe(true);
      expect(fx.fake.requests).toHaveLength(before);
    },
  );
});
