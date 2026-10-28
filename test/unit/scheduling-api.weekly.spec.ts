import { beforeEach, describe, expect, it } from 'vitest';
import { BackendError } from '@/external/mssuize/backend-error.js';
import { assertLearnerInHousehold } from '@/external/mssuize/household-api.js';
import {
  cancelLesson,
  fetchWeeklySchedule,
  previewWeeklySchedule,
  weekdayName,
} from '@/external/mssuize/scheduling-api.js';
import {
  createFakeMssuizeApi,
  fakeHousehold,
  type FakeMssuize,
} from '../helpers/fake-mssuize.js';
import {
  FAKE_LEARNER_ID,
  FAKE_LESSON_ID,
  FAKE_OTHER_LEARNER_ID,
} from '../helpers/fake-scheduling.js';
import { fakeWeeklyPreview } from '../helpers/fake-weekly.js';
import { createApiFixture } from '../helpers/scheduling-api-fixture.js';
import { weeklyLearner } from '../helpers/weekly-fixture.js';

describe('scheduling-api: weekly schedule, its preview and the cancel', () => {
  let fake: FakeMssuize;
  let accessToken: string;
  const backend = () => createFakeMssuizeApi(fake);
  const lastRequest = () => fake.requests.at(-1)!;

  beforeEach(() => {
    ({ fake, accessToken } = createApiFixture());
    fake.learners = [weeklyLearner];
  });

  describe('weekdayName', () => {
    it.each([
      [0, 'Sunday'],
      [1, 'Monday'],
      [6, 'Saturday'],
    ])('names day %i %s', (day, name) => {
      expect(weekdayName(day)).toBe(name);
    });

    it.each([-1, 7, 1.5, Number.NaN])(
      'refuses %s as an unexpected response',
      (day) => {
        expect(() => weekdayName(day)).toThrow(BackendError);
        expect(() => weekdayName(day)).toThrow(
          expect.objectContaining({ kind: 'unexpected_response' }),
        );
      },
    );
  });

  describe('fetchWeeklySchedule', () => {
    it('reads the learner’s schedule with the bearer token and no body', async () => {
      const schedule = await fetchWeeklySchedule(
        backend(),
        accessToken,
        FAKE_LEARNER_ID,
      );

      expect(lastRequest()).toMatchObject({
        method: 'GET',
        path: `/api/v1/learners/${FAKE_LEARNER_ID}/weekly-schedule-v2`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(lastRequest().body).toBeUndefined();
      expect(schedule.windows).toHaveLength(2);
    });

    it('rejects a day of week outside 0 to 6 as an unexpected response', async () => {
      fake.weekly.schedule = (learnerId) => ({
        learnerId,
        windows: [
          {
            id: 'w',
            dayOfWeek: 9,
            startTime: '09:00:00',
            endTime: '10:00:00',
            status: 'active',
          },
        ],
      });

      await expect(
        fetchWeeklySchedule(backend(), accessToken, FAKE_LEARNER_ID),
      ).rejects.toMatchObject({
        kind: 'unexpected_response',
      });
    });

    it('maps a bad token to unauthorized', async () => {
      await expect(
        fetchWeeklySchedule(backend(), 'wrong', FAKE_LEARNER_ID),
      ).rejects.toMatchObject({
        kind: 'unauthorized',
      });
    });
  });

  describe('previewWeeklySchedule', () => {
    const request = {
      windows: [{ dayOfWeek: 2, startTime: '16:00:00', endTime: '18:00:00' }],
      subjectPreferences: [],
    };

    it('posts to the /preview path only, with the body as given', async () => {
      await previewWeeklySchedule(
        backend(),
        accessToken,
        FAKE_LEARNER_ID,
        request,
      );

      expect(lastRequest()).toMatchObject({
        method: 'POST',
        path: `/api/v1/learners/${FAKE_LEARNER_ID}/weekly-schedule-v2/preview`,
        body: request,
      });
      expect(
        fake.requests.filter(
          (r) =>
            r.method !== 'GET' &&
            !r.path.endsWith('/preview') &&
            r.path.includes('weekly-schedule'),
        ),
      ).toEqual([]);
    });

    it('drops the tutor and learner names and ids when parsing the reply', async () => {
      fake.weekly.preview = fakeWeeklyPreview;

      const reply = await previewWeeklySchedule(
        backend(),
        accessToken,
        FAKE_LEARNER_ID,
        request,
      );

      expect(JSON.stringify(reply)).not.toMatch(/tutor|learner_/);
      expect(reply.entries?.[0]).toEqual({
        session_id: FAKE_LESSON_ID,
        subjects: ['Math'],
        old_start: '2026-06-02T20:00:00Z',
        old_end: '2026-06-02T21:00:00Z',
        action: 'reschedule',
        new_start: '2026-06-02T21:00:00Z',
        new_end: '2026-06-02T22:00:00Z',
        reason: 'outside the new window',
      });
    });

    it('treats a reply of the wrong shape as an unexpected response', async () => {
      fake.weekly.preview = { total_scanned: 'many' };

      await expect(
        previewWeeklySchedule(backend(), accessToken, FAKE_LEARNER_ID, request),
      ).rejects.toMatchObject({ kind: 'unexpected_response' });
    });
  });

  describe('cancelLesson', () => {
    it('posts to the cancel route with exactly { reason } and the bearer token', async () => {
      const reply = await cancelLesson(backend(), accessToken, FAKE_LESSON_ID, {
        reason: 'Trip',
      });

      expect(lastRequest()).toMatchObject({
        method: 'POST',
        path: `/api/v1/sessions/${FAKE_LESSON_ID}/cancel`,
        headers: { authorization: `Bearer ${accessToken}` },
        body: { reason: 'Trip' },
      });
      expect(Object.keys(lastRequest().body as object)).toEqual(['reason']);
      expect(reply).toEqual({ message: 'session cancelled successfully' });
    });

    it('sends nothing but the reason even if more is passed in', async () => {
      await cancelLesson(backend(), accessToken, FAKE_LESSON_ID, {
        reason: 'Trip',
        force: true,
      } as { reason: string });

      expect(lastRequest().body).toEqual({ reason: 'Trip' });
    });

    it.each([
      [403, 'forbidden'],
      [500, 'unavailable'],
      [401, 'unauthorized'],
    ])('maps a %i to %s', async (status, kind) => {
      fake.scheduling.cancelOutcome = { status, text: 'x' };

      await expect(
        cancelLesson(backend(), accessToken, FAKE_LESSON_ID, {
          reason: 'Trip',
        }),
      ).rejects.toMatchObject({ kind });
    });

    it('maps a reply that never comes to timeout', async () => {
      fake.scheduling.cancelOutcome = 'timeout';

      await expect(
        cancelLesson(backend(), accessToken, FAKE_LESSON_ID, {
          reason: 'Trip',
        }),
      ).rejects.toMatchObject({ kind: 'timeout' });
    });
  });

  describe('assertLearnerInHousehold', () => {
    it('passes for a learner in the household, reading the list with status=all', async () => {
      await assertLearnerInHousehold(
        backend(),
        accessToken,
        fakeHousehold.id,
        FAKE_LEARNER_ID,
      );

      expect(lastRequest().path).toBe(
        `/api/v1/households/${fakeHousehold.id}/learners?status=all`,
      );
    });

    it('matches the id without regard to case', async () => {
      await expect(
        assertLearnerInHousehold(
          backend(),
          accessToken,
          fakeHousehold.id,
          FAKE_LEARNER_ID.toUpperCase(),
        ),
      ).resolves.toBeUndefined();
    });

    it('refuses a learner that is not in the list, as forbidden', async () => {
      await expect(
        assertLearnerInHousehold(
          backend(),
          accessToken,
          fakeHousehold.id,
          FAKE_OTHER_LEARNER_ID,
        ),
      ).rejects.toMatchObject({ kind: 'forbidden' });
    });

    it('refuses when the list is empty', async () => {
      fake.learners = [];

      await expect(
        assertLearnerInHousehold(
          backend(),
          accessToken,
          fakeHousehold.id,
          FAKE_LEARNER_ID,
        ),
      ).rejects.toMatchObject({ kind: 'forbidden' });
    });

    it('passes the backend’s own refusal of the household through', async () => {
      fake.householdForbidden = true;

      await expect(
        assertLearnerInHousehold(
          backend(),
          accessToken,
          fakeHousehold.id,
          FAKE_LEARNER_ID,
        ),
      ).rejects.toMatchObject({ kind: 'forbidden' });
    });
  });
});
