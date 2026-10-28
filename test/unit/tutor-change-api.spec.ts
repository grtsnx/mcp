import { beforeEach, describe, expect, it } from 'vitest';
import {
  createTutorChangeRequest,
  listTutorChangeRequests,
} from '@/external/mssuize/tutor-change-api.js';
import { updateWeeklySchedule } from '@/external/mssuize/weekly-update-api.js';
import {
  createFakeMssuizeApi,
  type FakeMssuize,
} from '../helpers/fake-mssuize.js';
import {
  FAKE_LEARNER_ID,
  FAKE_TUTOR_ID,
} from '../helpers/fake-lessons-data.js';
import {
  ADMIN_NOTES_MARKER,
  DB_ERROR_MARKER,
  DUPLICATE_TEXT,
  HOUSEHOLD_MARKER,
  NO_HOUSEHOLD_TEXT,
} from '../helpers/fake-tutor-change.js';
import { createApiFixture } from '../helpers/scheduling-api-fixture.js';

describe('weekly-update-api and tutor-change-api', () => {
  let fake: FakeMssuize;
  let accessToken: string;
  const backend = () => createFakeMssuizeApi(fake);
  const lastRequest = () => fake.requests.at(-1)!;

  beforeEach(() => {
    ({ fake, accessToken } = createApiFixture());
  });

  describe('updateWeeklySchedule', () => {
    const request = {
      windows: [{ dayOfWeek: 2, startTime: '16:00:00', endTime: '18:00:00' }],
      subjectPreferences: [
        {
          learnerSubjectId: 'c1b2c3d4-4444-4222-8333-444455556666',
          preferredDuration: 60,
          sessionsPerWeek: 2,
        },
      ],
    };

    it('puts to the weekly schedule path with exactly windows and subjectPreferences', async () => {
      await updateWeeklySchedule(
        backend(),
        accessToken,
        FAKE_LEARNER_ID,
        request,
      );

      expect(lastRequest()).toMatchObject({
        method: 'PUT',
        path: `/api/v1/learners/${FAKE_LEARNER_ID}/weekly-schedule-v2`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(Object.keys(lastRequest().body as object).sort()).toEqual([
        'subjectPreferences',
        'windows',
      ]);
    });

    it('sends nothing but those two fields even if more is passed in', async () => {
      await updateWeeklySchedule(backend(), accessToken, FAKE_LEARNER_ID, {
        ...request,
        force: true,
      } as typeof request);

      expect(Object.keys(lastRequest().body as object).sort()).toEqual([
        'subjectPreferences',
        'windows',
      ]);
    });

    it('returns the schedule the backend answers with', async () => {
      const saved = await updateWeeklySchedule(
        backend(),
        accessToken,
        FAKE_LEARNER_ID,
        request,
      );

      expect(saved.windows).toHaveLength(1);
      expect(saved.windows?.[0]?.startTime).toBe('16:00:00');
    });

    it.each([
      [400, 'invalid_request'],
      [403, 'forbidden'],
      [404, 'not_found'],
      [500, 'unavailable'],
      [401, 'unauthorized'],
    ])('maps a %i to %s without reading the text', async (status, kind) => {
      fake.weekly.putOutcome = {
        status,
        text: 'your plan allows a maximum of 1 subject(s)',
      };

      await expect(
        updateWeeklySchedule(backend(), accessToken, FAKE_LEARNER_ID, request),
      ).rejects.toMatchObject({ kind });
    });

    it('maps a reply that never comes to timeout', async () => {
      fake.weekly.putOutcome = 'timeout';

      await expect(
        updateWeeklySchedule(backend(), accessToken, FAKE_LEARNER_ID, request),
      ).rejects.toMatchObject({ kind: 'timeout' });
    });
  });

  describe('createTutorChangeRequest', () => {
    const request = {
      learnerId: FAKE_LEARNER_ID,
      currentTutorId: FAKE_TUTOR_ID,
      reason: 'Not a fit',
    };

    it('posts exactly { learnerId, currentTutorId, reason } to the parent route', async () => {
      const reply = await createTutorChangeRequest(
        backend(),
        accessToken,
        request,
      );

      expect(lastRequest()).toMatchObject({
        method: 'POST',
        path: '/api/v1/tutor-change-requests',
        headers: { authorization: `Bearer ${accessToken}` },
        body: request,
      });
      expect(Object.keys(lastRequest().body as object).sort()).toEqual([
        'currentTutorId',
        'learnerId',
        'reason',
      ]);
      expect(reply).toEqual({ status: 'pending' });
    });

    it('sends nothing but those fields even if more is passed in', async () => {
      await createTutorChangeRequest(backend(), accessToken, {
        ...request,
        extra: 'x',
      } as typeof request);

      expect(Object.keys(lastRequest().body as object).sort()).toEqual([
        'currentTutorId',
        'learnerId',
        'reason',
      ]);
    });

    it('maps only the exact duplicate phrase to already_pending', async () => {
      fake.tutorChange.createOutcome = { status: 400, text: DUPLICATE_TEXT };

      await expect(
        createTutorChangeRequest(backend(), accessToken, request),
      ).rejects.toMatchObject({ kind: 'already_pending' });
    });

    it.each([
      ['database error text', `failed to create request: ${DB_ERROR_MARKER}`],
      ['the required-fields text', 'learnerId and currentTutorId are required'],
      ['unrelated text', 'a request is pending somewhere'],
    ])(
      'maps %s to invalid_request, and the error carries none of it',
      async (_label, text) => {
        fake.tutorChange.createOutcome = { status: 400, text };

        const error = (await createTutorChangeRequest(
          backend(),
          accessToken,
          request,
        ).catch((caught: unknown) => caught)) as Error;

        expect(error).toMatchObject({ kind: 'invalid_request' });
        expect(JSON.stringify(error)).not.toContain('SECRET');
        expect(error.message).not.toContain('SECRET');
      },
    );

    it('does not read the phrase out of a 403 or a 500', async () => {
      fake.tutorChange.createOutcome = { status: 500, text: DUPLICATE_TEXT };

      await expect(
        createTutorChangeRequest(backend(), accessToken, request),
      ).rejects.toMatchObject({ kind: 'unavailable' });
    });

    it('treats a reply that is not "pending" as an unexpected response', async () => {
      fake.tutorChange.replyStatus = 'approved';

      await expect(
        createTutorChangeRequest(backend(), accessToken, request),
      ).rejects.toMatchObject({ kind: 'unexpected_response' });
    });
  });

  describe('listTutorChangeRequests', () => {
    it('gets the parent route with no query and no body', async () => {
      await listTutorChangeRequests(backend(), accessToken);

      expect(lastRequest()).toMatchObject({
        method: 'GET',
        path: '/api/v1/tutor-change-requests',
      });
      expect(lastRequest().body).toBeUndefined();
    });

    it('parses only the fields it names, dropping ids of tutors, notes and the household id', async () => {
      const listed = await listTutorChangeRequests(backend(), accessToken);

      expect(Object.keys(listed.requests?.[0] ?? {}).sort()).toEqual([
        'createdAt',
        'currentTutorName',
        'id',
        'learnerId',
        'reason',
        'status',
      ]);
      expect(JSON.stringify(listed)).not.toContain(ADMIN_NOTES_MARKER);
      expect(JSON.stringify(listed)).not.toContain(HOUSEHOLD_MARKER);
      expect(JSON.stringify(listed)).not.toContain(FAKE_TUTOR_ID);
    });

    it('maps the exact no-household phrase to household_not_found, and any other 400 to invalid_request', async () => {
      fake.tutorChange.listOutcome = { status: 400, text: NO_HOUSEHOLD_TEXT };
      await expect(
        listTutorChangeRequests(backend(), accessToken),
      ).rejects.toMatchObject({ kind: 'household_not_found' });

      fake.tutorChange.listOutcome = { status: 400, text: 'other' };
      await expect(
        listTutorChangeRequests(backend(), accessToken),
      ).rejects.toMatchObject({ kind: 'invalid_request' });
    });
  });
});
