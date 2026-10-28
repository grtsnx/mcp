// Copied from tool.template.spec.ts. The preview must change nothing; the request it sends is
// checked field by field because it is a full replacement of the learner's schedule.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FAKE_LEARNER_ID,
  FAKE_LESSON_ID,
  FAKE_OTHER_LEARNER_ID,
} from '../../helpers/fake-lessons-data.js';
import { TOKEN_MARKER } from '../../helpers/fake-mssuize.js';
import {
  LEARNER_NAME_MARKER,
  LEARNER_SUBJECT_ID,
  NOTES_MARKER,
  PREFERENCE_ID,
  TUTOR_NAME_MARKER,
  WINDOW_SUNDAY_ID,
  WINDOW_TUESDAY_ID,
  fakeWeeklyPreview,
} from '../../helpers/fake-weekly.js';
import { textOf } from '../../helpers/tool-harness.js';
import {
  createWeeklyFixture,
  weeklyRequests,
} from '../../helpers/weekly-fixture.js';

// The learner's windows exactly as they are now, which a harmless preview sends back.
const SAME_WINDOWS = [
  {
    windowId: WINDOW_TUESDAY_ID,
    dayOfWeek: 2,
    startTime: '16:00',
    endTime: '18:00',
  },
  {
    windowId: WINDOW_SUNDAY_ID,
    dayOfWeek: 0,
    startTime: '09:00',
    endTime: '11:00',
  },
];

describe('learner_weekly_schedule_preview tool', () => {
  let fixture: Awaited<ReturnType<typeof createWeeklyFixture>>;

  beforeEach(async () => {
    fixture = await createWeeklyFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  const run = async (windows: unknown, extra: Record<string, unknown> = {}) => {
    const sessionId = await fixture.signIn();
    return fixture.preview({
      sessionId,
      learnerId: FAKE_LEARNER_ID,
      windows,
      ...extra,
    });
  };

  it('returns the counts and entries with exactly the documented fields', async () => {
    fixture.fake.weekly.preview = fakeWeeklyPreview;

    const result = await run(SAME_WINDOWS);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      learnerId: FAKE_LEARNER_ID,
      timezone: 'America/New_York',
      totalScanned: 4,
      affectedCount: 2,
      rescheduleCount: 1,
      cancelCount: 1,
      entries: [
        {
          lessonId: FAKE_LESSON_ID,
          subjects: ['Math'],
          oldStart: '2026-06-02T20:00:00Z',
          oldEnd: '2026-06-02T21:00:00Z',
          oldWhenLocal: 'Tuesday 2 June 2026, 4:00 PM to 5:00 PM',
          action: 'reschedule',
          newStart: '2026-06-02T21:00:00Z',
          newEnd: '2026-06-02T22:00:00Z',
          newWhenLocal: 'Tuesday 2 June 2026, 5:00 PM to 6:00 PM',
          reason: 'outside the new window',
        },
        {
          lessonId: '0f1e2d3c-4b5a-4968-8776-655443322110',
          subjects: ['Science'],
          oldStart: '2026-06-03T20:00:00Z',
          oldEnd: '2026-06-03T20:30:00Z',
          oldWhenLocal: 'Wednesday 3 June 2026, 4:00 PM to 4:30 PM',
          action: 'cancel',
          reason: 'no slot fits',
        },
      ],
    });
  });

  it('drops tutor and learner names and ids, and never leaks a token', async () => {
    fixture.fake.weekly.preview = fakeWeeklyPreview;

    const result = await run(SAME_WINDOWS);

    const text = JSON.stringify(result);
    expect(text).not.toContain(TUTOR_NAME_MARKER);
    expect(text).not.toContain(LEARNER_NAME_MARKER);
    expect(text).not.toContain('tutor_id');
    expect(text).not.toContain('learner_name');
    expect(text).not.toContain(TOKEN_MARKER);
  });

  it('reports an empty preview as zero counts and no entries', async () => {
    const result = await run(SAME_WINDOWS);

    expect(result.structuredContent).toEqual({
      learnerId: FAKE_LEARNER_ID,
      timezone: 'America/New_York',
      totalScanned: 0,
      affectedCount: 0,
      rescheduleCount: 0,
      cancelCount: 0,
      entries: [],
    });
  });

  describe('the request it sends', () => {
    it('sends the current subject preferences exactly as they are', async () => {
      await run(SAME_WINDOWS);

      const body = fixture.fake.weekly.previewBodies[0] as {
        subjectPreferences: unknown[];
      };
      expect(body.subjectPreferences).toEqual([
        {
          id: PREFERENCE_ID,
          learnerSubjectId: LEARNER_SUBJECT_ID,
          preferredSubject: 'Algebra',
          preferredDuration: 60,
          sessionsPerWeek: 2,
          status: 'active',
          notes: NOTES_MARKER,
        },
      ]);
    });

    it('keeps a kept window as it is, with its extra range, status, dates and notes', async () => {
      await run(SAME_WINDOWS);

      const body = fixture.fake.weekly.previewBodies[0] as {
        windows: unknown[];
      };
      expect(body.windows).toEqual([
        {
          id: WINDOW_TUESDAY_ID,
          dayOfWeek: 2,
          startTime: '16:00:00',
          endTime: '18:00:00',
          timezone: 'America/New_York',
          extraStartTime: '19:00:00',
          extraEndTime: '20:00:00',
          status: 'active',
          effectiveFrom: '2026-05-01T00:00:00Z',
          effectiveTo: '2026-12-31T00:00:00Z',
          notes: NOTES_MARKER,
        },
        {
          id: WINDOW_SUNDAY_ID,
          dayOfWeek: 0,
          startTime: '09:00:00',
          endTime: '11:00:00',
          timezone: 'America/New_York',
          status: 'active',
        },
      ]);
    });

    it('changes only the day and times of a kept window, and a given timezone', async () => {
      await run([
        {
          windowId: WINDOW_TUESDAY_ID,
          dayOfWeek: 4,
          startTime: '17:30',
          endTime: '19:00',
          timezone: 'Africa/Lagos',
        },
      ]);

      const body = fixture.fake.weekly.previewBodies[0] as {
        windows: Record<string, unknown>[];
      };
      expect(body.windows).toHaveLength(1);
      expect(body.windows[0]).toMatchObject({
        id: WINDOW_TUESDAY_ID,
        dayOfWeek: 4,
        startTime: '17:30:00',
        endTime: '19:00:00',
        timezone: 'Africa/Lagos',
        extraStartTime: '19:00:00',
        status: 'active',
        notes: NOTES_MARKER,
      });
    });

    it('sends a new window with only what was given, and the learner’s shared timezone', async () => {
      await run([
        ...SAME_WINDOWS,
        { dayOfWeek: 5, startTime: '14:00', endTime: '15:00' },
      ]);

      const body = fixture.fake.weekly.previewBodies[0] as {
        windows: Record<string, unknown>[];
      };
      expect(body.windows[2]).toEqual({
        dayOfWeek: 5,
        startTime: '14:00:00',
        endTime: '15:00:00',
        timezone: 'America/New_York',
      });
    });

    it('sends no timezone for a new window when the current windows disagree', async () => {
      fixture.fake.weekly.schedule = (learnerId) => ({
        learnerId,
        windows: [
          {
            id: WINDOW_TUESDAY_ID,
            dayOfWeek: 2,
            startTime: '16:00:00',
            endTime: '18:00:00',
            timezone: 'America/New_York',
            status: 'active',
          },
          {
            id: WINDOW_SUNDAY_ID,
            dayOfWeek: 0,
            startTime: '09:00:00',
            endTime: '11:00:00',
            timezone: 'Africa/Lagos',
            status: 'active',
          },
        ],
        subjectPreferences: [],
      });

      await run([{ dayOfWeek: 5, startTime: '14:00', endTime: '15:00' }]);

      const body = fixture.fake.weekly.previewBodies[0] as {
        windows: Record<string, unknown>[];
      };
      expect(body.windows[0]).toEqual({
        dayOfWeek: 5,
        startTime: '14:00:00',
        endTime: '15:00:00',
      });
    });

    it('leaves a current window out of the request when the model leaves it out', async () => {
      await run([SAME_WINDOWS[0]]);

      const body = fixture.fake.weekly.previewBodies[0] as {
        windows: { id: string }[];
      };
      expect(body.windows.map((window) => window.id)).toEqual([
        WINDOW_TUESDAY_ID,
      ]);
    });

    it('refuses a windowId that is not one of the learner’s windows, before the preview', async () => {
      const result = await run([
        {
          windowId: 'd1b2c3d4-9999-4222-8333-444455556666',
          dayOfWeek: 2,
          startTime: '16:00',
          endTime: '18:00',
        },
      ]);

      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(
        /not one of this learner's current windows/,
      );
      expect(fixture.fake.weekly.previewBodies).toEqual([]);
    });

    it('reads the current schedule first, then sends exactly one preview and nothing else', async () => {
      await run(SAME_WINDOWS);

      expect(weeklyRequests(fixture.fake)).toEqual([
        `GET /api/v1/learners/${FAKE_LEARNER_ID}/weekly-schedule-v2`,
        `POST /api/v1/learners/${FAKE_LEARNER_ID}/weekly-schedule-v2/preview`,
      ]);
    });
  });

  describe('input checked before any backend call', () => {
    const win = { dayOfWeek: 2, startTime: '16:00', endTime: '18:00' };

    it.each([
      ['no windows', []],
      [
        'more than 14 windows',
        Array.from({ length: 15 }, (_, i) => ({
          dayOfWeek: i % 7,
          startTime: `0${i % 9}:00`,
          endTime: `0${i % 9}:30`,
        })),
      ],
      ['a duplicate window', [win, { ...win }]],
      [
        'a duplicate with another timezone',
        [win, { ...win, timezone: 'Africa/Lagos' }],
      ],
      ['an endTime equal to the startTime', [{ ...win, endTime: '16:00' }]],
      ['an endTime before the startTime', [{ ...win, endTime: '15:00' }]],
      ['a day of 7', [{ ...win, dayOfWeek: 7 }]],
      ['a day of -1', [{ ...win, dayOfWeek: -1 }]],
      ['a time with seconds', [{ ...win, startTime: '16:00:00' }]],
      ['an hour of 24', [{ ...win, startTime: '24:00', endTime: '24:30' }]],
      ['a made-up timezone', [{ ...win, timezone: 'Mars/Olympus' }]],
      ['a windowId that is not a UUID', [{ ...win, windowId: 'w-1' }]],
      [
        'the same windowId twice',
        [
          { ...win, windowId: WINDOW_TUESDAY_ID },
          {
            dayOfWeek: 3,
            startTime: '16:00',
            endTime: '18:00',
            windowId: WINDOW_TUESDAY_ID.toUpperCase(),
          },
        ],
      ],
      ['a status on a window', [{ ...win, status: 'inactive' }]],
      ['notes on a window', [{ ...win, notes: 'hello' }]],
      ['a date range on a window', [{ ...win, effectiveFrom: '2026-01-01' }]],
      [
        'an extra range on a window',
        [{ ...win, extraStartTime: '19:00', extraEndTime: '20:00' }],
      ],
    ])('rejects %s', async (_label, windows) => {
      const sessionId = await fixture.signIn();
      const before = fixture.fake.requests.length;

      const refused = await fixture
        .preview({ sessionId, learnerId: FAKE_LEARNER_ID, windows })
        .then((result) => result.isError === true)
        .catch(() => true);

      expect(refused).toBe(true);
      expect(fixture.fake.requests).toHaveLength(before);
    });

    it.each([
      ['subjectPreferences', { subjectPreferences: [] }],
      ['a householdId', { householdId: 'house-1' }],
      ['a learnerId that is not a UUID', { learnerId: 'learner-1' }],
    ])('rejects %s', async (_label, extra) => {
      const sessionId = await fixture.signIn();
      const before = fixture.fake.requests.length;

      const refused = await fixture
        .preview({
          sessionId,
          learnerId: FAKE_LEARNER_ID,
          windows: [win],
          ...extra,
        })
        .then((result) => result.isError === true)
        .catch(() => true);

      expect(refused).toBe(true);
      expect(fixture.fake.requests).toHaveLength(before);
    });

    it('accepts 14 distinct windows and two that differ only in the day', async () => {
      const windows = Array.from({ length: 14 }, (_, index) => ({
        dayOfWeek: index % 7,
        startTime: index < 7 ? '08:00' : '09:00',
        endTime: index < 7 ? '09:00' : '10:00',
      }));

      const result = await run(windows);

      expect(result.isError).toBeUndefined();
    });
  });

  describe('who may preview', () => {
    it('refuses a learner that is not in the household, without touching the weekly routes', async () => {
      const sessionId = await fixture.signIn();

      const result = await fixture.preview({
        sessionId,
        learnerId: FAKE_OTHER_LEARNER_ID,
        windows: SAME_WINDOWS,
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe('Not allowed to access this learner.');
      expect(weeklyRequests(fixture.fake)).toEqual([]);
    });

    it('does one refresh and carries on after an expired access token', async () => {
      const sessionId = await fixture.signIn();
      fixture.fake.expireAccessTokens();

      const result = await fixture.preview({
        sessionId,
        learnerId: FAKE_LEARNER_ID,
        windows: SAME_WINDOWS,
      });

      expect(result.isError).toBeUndefined();
      expect(fixture.fake.refreshCalls).toBe(1);
    });

    it('uses only the guardian-facing routes', async () => {
      await run(SAME_WINDOWS);

      expect(
        fixture.fake.requests.some((request) =>
          request.path.includes('/agent/'),
        ),
      ).toBe(false);
    });
  });
});
