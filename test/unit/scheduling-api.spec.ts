import { beforeEach, describe, expect, it } from 'vitest';
import {
  fetchLearnerLessons,
  fetchLesson,
  lessonStatuses,
  minutesBetween,
  previewLessonReschedule,
  schedulingRoles,
} from '@/external/mssuize/scheduling-api.js';
import {
  createFakeMssuizeApi,
  type FakeMssuize,
} from '../helpers/fake-mssuize.js';
import {
  FAKE_LEARNER_ID,
  FAKE_LESSON_ID,
  FAKE_OTHER_LEARNER_ID,
  FAKE_OTHER_LESSON_ID,
  FAKE_UNKNOWN_LEARNER_ID,
  FAKE_UNKNOWN_LESSON_ID,
} from '../helpers/fake-scheduling.js';
import { createApiFixture } from '../helpers/scheduling-api-fixture.js';

describe('scheduling-api', () => {
  let fake: FakeMssuize;
  let accessToken: string;
  const backend = () => createFakeMssuizeApi(fake);
  const lastRequest = () => fake.requests.at(-1)!;

  beforeEach(() => {
    ({ fake, accessToken } = createApiFixture());
  });

  it('knows the roles the backend allows and the five lesson statuses', () => {
    expect([...schedulingRoles]).toEqual(['guardian', 'delegate', 'admin']);
    expect([...lessonStatuses]).toEqual([
      'scheduled',
      'in_progress',
      'completed',
      'cancelled',
      'no_show',
    ]);
  });

  describe('fetchLearnerLessons', () => {
    it('sends no query and a bearer header when there are no filters', async () => {
      await fetchLearnerLessons(
        backend(),
        accessToken,
        'house-1',
        FAKE_LEARNER_ID,
      );

      expect(lastRequest()).toMatchObject({
        method: 'GET',
        path: `/api/v1/households/house-1/learners/${FAKE_LEARNER_ID}/scheduled-sessions`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
    });

    it('sends every filter under the name the backend reads', async () => {
      await fetchLearnerLessons(
        backend(),
        accessToken,
        'house-1',
        FAKE_LEARNER_ID,
        {
          page: 0,
          pageSize: 20,
          status: 'in_progress',
          startAfter: '2026-06-01T00:00:00+01:00',
          startBefore: '2026-06-30T00:00:00Z',
        },
      );

      const url = new URL(lastRequest().path, 'http://x');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        page: '0',
        page_size: '20',
        status: 'in_progress',
        start_after: '2026-06-01T00:00:00+01:00',
        start_before: '2026-06-30T00:00:00Z',
      });
    });

    it('encodes the ids so they cannot change the path', async () => {
      await fetchLearnerLessons(backend(), accessToken, 'a/b', 'c?d=e').catch(
        (error: unknown) => error,
      );

      expect(lastRequest().path).toBe(
        '/api/v1/households/a%2Fb/learners/c%3Fd%3De/scheduled-sessions',
      );
    });

    it('keeps only the fields the tools return', async () => {
      const list = await fetchLearnerLessons(
        backend(),
        accessToken,
        'house-1',
        FAKE_LEARNER_ID,
      );

      expect(Object.keys(list).sort()).toEqual([
        'page',
        'pageSize',
        'sessions',
        'totalCount',
      ]);
      expect(Object.keys(list.sessions![0]!).sort()).toEqual([
        'canCancel',
        'canReschedule',
        'id',
        'learnerName',
        'scheduledEnd',
        'scheduledStart',
        'status',
        'subjects',
        'tutorName',
      ]);
    });

    it('accepts the null the backend sends for an empty list', async () => {
      const list = await fetchLearnerLessons(
        backend(),
        accessToken,
        'house-1',
        FAKE_LEARNER_ID,
        {
          status: 'no_show',
        },
      );

      expect(list.sessions).toBeNull();
      expect(list.totalCount).toBe(0);
    });

    it('maps 403 to forbidden, 404 to not_found and 401 to unauthorized', async () => {
      await expect(
        fetchLearnerLessons(
          backend(),
          accessToken,
          'house-1',
          FAKE_OTHER_LEARNER_ID,
        ),
      ).rejects.toMatchObject({ kind: 'forbidden' });
      await expect(
        fetchLearnerLessons(
          backend(),
          accessToken,
          'house-1',
          FAKE_UNKNOWN_LEARNER_ID,
        ),
      ).rejects.toMatchObject({ kind: 'not_found' });
      fake.expireAccessTokens();
      await expect(
        fetchLearnerLessons(backend(), accessToken, 'house-1', FAKE_LEARNER_ID),
      ).rejects.toMatchObject({ kind: 'unauthorized' });
    });
  });

  describe('fetchLesson', () => {
    it('reads GET /sessions/{id} with a bearer header', async () => {
      await fetchLesson(backend(), accessToken, FAKE_LESSON_ID);

      expect(lastRequest()).toMatchObject({
        method: 'GET',
        path: `/api/v1/sessions/${FAKE_LESSON_ID}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
    });

    it('drops the tutor email and the tutor block’s id, photo link, actor ids and payloads when parsing; only the session’s tutorId is kept, for tutor_change_request_create, and no tool returns it', async () => {
      const detail = await fetchLesson(backend(), accessToken, FAKE_LESSON_ID);

      expect(Object.keys(detail.tutor ?? {}).sort()).toEqual([
        'first_name',
        'last_name',
      ]);
      expect(Object.keys(detail.learner ?? {}).sort()).toEqual([
        'first_name',
        'last_name',
      ]);
      expect(Object.keys(detail.events![0]!).sort()).toEqual([
        'actor_role',
        'event_type',
        'occurred_at',
      ]);
      expect(Object.keys(detail.session).sort()).toEqual([
        'canCancel',
        'canReschedule',
        'id',
        'learnerId',
        'scheduledEnd',
        'scheduledStart',
        'status',
        'subjects',
        'tutorId',
      ]);
    });

    it('maps 403 to forbidden and 404 to not_found', async () => {
      await expect(
        fetchLesson(backend(), accessToken, FAKE_OTHER_LESSON_ID),
      ).rejects.toMatchObject({
        kind: 'forbidden',
      });
      await expect(
        fetchLesson(backend(), accessToken, FAKE_UNKNOWN_LESSON_ID),
      ).rejects.toMatchObject({
        kind: 'not_found',
      });
    });
  });

  describe('previewLessonReschedule', () => {
    it('posts only the date when there is no timezone, so the backend picks the family zone', async () => {
      await previewLessonReschedule(backend(), accessToken, FAKE_LESSON_ID, {
        targetDate: '2026-06-02',
      });

      expect(lastRequest()).toMatchObject({
        method: 'POST',
        path: `/api/v1/sessions/${FAKE_LESSON_ID}/reschedule-preview`,
        body: { target_date: '2026-06-02' },
      });
      expect(Object.keys(lastRequest().body as object)).toEqual([
        'target_date',
      ]);
    });

    it('posts the timezone too when one is given', async () => {
      await previewLessonReschedule(backend(), accessToken, FAKE_LESSON_ID, {
        targetDate: '2026-06-02',
        timezone: 'Africa/Lagos',
      });

      expect(lastRequest().body).toEqual({
        target_date: '2026-06-02',
        timezone: 'Africa/Lagos',
      });
    });

    it('keeps only the fields the tool returns', async () => {
      const preview = await previewLessonReschedule(
        backend(),
        accessToken,
        FAKE_LESSON_ID,
        {
          targetDate: '2026-06-02',
        },
      );

      expect(Object.keys(preview).sort()).toEqual([
        'current_end',
        'current_start',
        'duration_minutes',
        'session_id',
        'slots',
        'target_date',
        'timezone',
      ]);
    });

    it('maps a backend 400 to invalid_request, 403 to forbidden and 404 to not_found', async () => {
      await expect(
        previewLessonReschedule(backend(), accessToken, FAKE_LESSON_ID, {
          targetDate: '2026-02-30',
        }),
      ).rejects.toMatchObject({ kind: 'invalid_request' });
      await expect(
        previewLessonReschedule(backend(), accessToken, FAKE_OTHER_LESSON_ID, {
          targetDate: '2026-06-02',
        }),
      ).rejects.toMatchObject({ kind: 'forbidden' });
      await expect(
        previewLessonReschedule(
          backend(),
          accessToken,
          FAKE_UNKNOWN_LESSON_ID,
          { targetDate: '2026-06-02' },
        ),
      ).rejects.toMatchObject({ kind: 'not_found' });
    });
  });

  describe('minutesBetween', () => {
    it.each([
      ['2026-06-01T14:00:00Z', '2026-06-01T15:00:00Z', 60],
      ['2026-06-01T14:00:00Z', '2026-06-01T14:45:00Z', 45],
      ['2026-06-01T14:00:00Z', '2026-06-01T14:30:30Z', 31],
      ['2026-06-01T10:00:00-04:00', '2026-06-01T15:00:00Z', 60],
      ['2026-06-01T14:00:00Z', '2026-06-01T14:00:00Z', 0],
    ])('%s to %s is %i minutes', (start, end, minutes) => {
      expect(minutesBetween(start, end)).toBe(minutes);
    });

    it.each([
      [
        'an end before the start',
        '2026-06-01T15:00:00Z',
        '2026-06-01T14:00:00Z',
      ],
      ['an unreadable start', 'soon', '2026-06-01T14:00:00Z'],
      ['an unreadable end', '2026-06-01T14:00:00Z', ''],
    ])('treats %s as an unexpected backend reply', (_name, start, end) => {
      expect(() => minutesBetween(start, end)).toThrowError(
        expect.objectContaining({
          name: 'BackendError',
          kind: 'unexpected_response',
        }),
      );
    });
  });
});
