import { beforeEach, describe, expect, it } from 'vitest';
import {
  fetchHouseholdLessons,
  fetchRescheduleWeek,
  ianaTimeZoneSchema,
  localDateIn,
  rescheduleErrorPhrases,
  rescheduleLesson,
} from '@/external/mssuize/scheduling-api.js';
import {
  createFakeMssuizeApi,
  type FakeMssuize,
} from '../helpers/fake-mssuize.js';
import {
  FAKE_LESSON_ID,
  FAKE_LOCKED_LESSON_ID,
} from '../helpers/fake-scheduling.js';
import { createApiFixture } from '../helpers/scheduling-api-fixture.js';

describe('scheduling-api: the week, the household list and the move', () => {
  let fake: FakeMssuize;
  let accessToken: string;
  const backend = () => createFakeMssuizeApi(fake);
  const lastRequest = () => fake.requests.at(-1)!;

  beforeEach(() => {
    ({ fake, accessToken } = createApiFixture());
  });

  describe('fetchRescheduleWeek', () => {
    it('reads the week preview, with no query when there is no timezone', async () => {
      await fetchRescheduleWeek(backend(), accessToken, FAKE_LESSON_ID);

      expect(lastRequest()).toMatchObject({
        method: 'GET',
        path: `/api/v1/sessions/${FAKE_LESSON_ID}/reschedule-week-preview`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
    });

    it('sends the timezone as a query parameter, encoded', async () => {
      await fetchRescheduleWeek(
        backend(),
        accessToken,
        FAKE_LESSON_ID,
        'America/New_York',
      );

      expect(lastRequest().path).toBe(
        `/api/v1/sessions/${FAKE_LESSON_ID}/reschedule-week-preview?timezone=America%2FNew_York`,
      );
    });

    it('keeps only the fields the tool returns', async () => {
      const week = await fetchRescheduleWeek(
        backend(),
        accessToken,
        FAKE_LESSON_ID,
      );

      expect(Object.keys(week).sort()).toEqual([
        'current_end',
        'current_start',
        'days',
        'duration_minutes',
        'session_id',
        'timezone',
      ]);
      expect(Object.keys(week.days![0]!).sort()).toEqual(['date', 'slots']);
    });

    it('reads a 400 "cannot reschedule" as that kind', async () => {
      await expect(
        fetchRescheduleWeek(backend(), accessToken, FAKE_LOCKED_LESSON_ID),
      ).rejects.toMatchObject({ kind: 'cannot_reschedule' });
    });
  });

  describe('fetchHouseholdLessons', () => {
    it('reads GET /households/{id}/sessions with the filters under the names the backend reads', async () => {
      await fetchHouseholdLessons(backend(), accessToken, 'house-1', {
        page: 1,
        pageSize: 10,
        status: 'cancelled',
        startAfter: '2026-06-01T00:00:00Z',
        startBefore: '2026-07-01T00:00:00Z',
      });

      const url = new URL(lastRequest().path, 'http://x');
      expect(url.pathname).toBe('/api/v1/households/house-1/sessions');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        page: '1',
        page_size: '10',
        status: 'cancelled',
        start_after: '2026-06-01T00:00:00Z',
        start_before: '2026-07-01T00:00:00Z',
      });
    });

    it('keeps only ids, times, status and the two permission flags', async () => {
      const list = await fetchHouseholdLessons(
        backend(),
        accessToken,
        'house-1',
      );

      expect(Object.keys(list.sessions![0]!).sort()).toEqual([
        'canCancel',
        'canReschedule',
        'id',
        'learnerId',
        'scheduledEnd',
        'scheduledStart',
        'status',
        'subjects',
      ]);
    });

    it('turns the 500 the backend gives for a made-up status into an outage, not a result', async () => {
      await expect(
        fetchHouseholdLessons(backend(), accessToken, 'house-1', {
          status: 'nonsense' as never,
        }),
      ).rejects.toMatchObject({ kind: 'unavailable' });
    });
  });

  describe('rescheduleLesson', () => {
    const move = {
      newStart: '2026-06-02T10:00:00-04:00',
      newEnd: '2026-06-02T11:00:00-04:00',
      reason: 'Soccer practice moved',
    };

    it('posts exactly new_start, new_end and reason, and never force', async () => {
      await rescheduleLesson(backend(), accessToken, FAKE_LESSON_ID, move);

      expect(lastRequest()).toMatchObject({
        method: 'POST',
        path: `/api/v1/sessions/${FAKE_LESSON_ID}/reschedule`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(lastRequest().body).toEqual({
        new_start: move.newStart,
        new_end: move.newEnd,
        reason: move.reason,
      });
      expect(JSON.stringify(lastRequest().body)).not.toContain('force');
    });

    it('sends no retry key', async () => {
      await rescheduleLesson(backend(), accessToken, FAKE_LESSON_ID, move);

      expect(Object.keys(lastRequest().headers).sort()).toEqual([
        'authorization',
      ]);
    });

    it('lists the phrases in the order that decides a reply with more than one', () => {
      expect(rescheduleErrorPhrases.map((entry) => entry.phrase)).toEqual([
        'cannot reschedule',
        'selected time slot',
        'learner availability',
      ]);
    });

    it('reads each known 400 text as its own kind', async () => {
      const kinds = [] as string[];
      for (const text of [
        'cannot reschedule this session',
        'selected time slot is no longer available',
        'learner availability',
        'invalid something',
      ]) {
        fake.scheduling.rescheduleOutcome = { status: 400, text };
        kinds.push(
          await rescheduleLesson(
            backend(),
            accessToken,
            FAKE_LESSON_ID,
            move,
          ).then(
            () => 'ok',
            (error: { kind: string }) => error.kind,
          ),
        );
      }

      expect(kinds).toEqual([
        'cannot_reschedule',
        'slot_unavailable',
        'outside_availability',
        'invalid_request',
      ]);
    });

    it('reads a timeout, a 500 and a 403 as their own kinds', async () => {
      const kindFor = async (
        outcome: typeof fake.scheduling.rescheduleOutcome,
      ) => {
        fake.scheduling.rescheduleOutcome = outcome;
        return rescheduleLesson(
          backend(),
          accessToken,
          FAKE_LESSON_ID,
          move,
        ).then(
          () => 'ok',
          (error: { kind: string }) => error.kind,
        );
      };

      expect(await kindFor('timeout')).toBe('timeout');
      expect(
        await kindFor({ status: 500, text: 'failed to reschedule session' }),
      ).toBe('unavailable');
      expect(await kindFor({ status: 403, text: 'access denied' })).toBe(
        'forbidden',
      );
    });
  });

  describe('localDateIn', () => {
    it.each([
      ['2026-06-03T04:00:00+14:00', 'America/New_York', '2026-06-02'],
      ['2026-06-02T14:00:00Z', 'America/New_York', '2026-06-02'],
      ['2026-06-02T14:00:00Z', 'Pacific/Kiritimati', '2026-06-03'],
      ['2026-06-02T23:30:00-04:00', 'UTC', '2026-06-03'],
    ])('%s in %s is %s', (instant, zone, date) => {
      expect(localDateIn(instant, zone)).toBe(date);
    });

    it('treats a time zone it cannot use as an unexpected reply', () => {
      expect(() =>
        localDateIn('2026-06-02T14:00:00Z', 'Mars/Phobos'),
      ).toThrowError(expect.objectContaining({ kind: 'unexpected_response' }));
    });
  });

  describe('ianaTimeZoneSchema', () => {
    it.each([
      'America/New_York',
      'UTC',
      'Africa/Lagos',
      'America/Argentina/Buenos_Aires',
    ])('accepts %s', (zone) => {
      expect(ianaTimeZoneSchema.safeParse(zone).success).toBe(true);
    });

    it.each([
      'Mars/Phobos',
      '+01:00',
      'america/new_york',
      '',
      'America/New_York; DROP',
      `America/${'A'.repeat(70)}`,
    ])('rejects %j', (zone) => {
      expect(ianaTimeZoneSchema.safeParse(zone).success).toBe(false);
    });
  });
});
