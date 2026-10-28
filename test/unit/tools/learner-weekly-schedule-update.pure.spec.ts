import { describe, expect, it } from 'vitest';
import type {
  WeeklyPreview,
  WeeklyPreviewRequest,
  WeeklySchedule,
} from '@/external/mssuize/scheduling-api.js';
import {
  previewFingerprint,
  savedMatches,
  scheduleKey,
} from '@/tools/learner-weekly-schedule-update/handler.js';
import { fakeWeeklySchedule } from '../../helpers/fake-weekly.js';

const schedule = () => fakeWeeklySchedule('learner') as WeeklySchedule;

describe('scheduleKey', () => {
  it('is the same whatever order the backend lists windows and preferences in', () => {
    const a = schedule();
    const b = schedule();
    b.windows = [...(b.windows ?? [])].reverse();

    expect(scheduleKey(a)).toBe(scheduleKey(b));
  });

  it('treats a missing field and a null one as the same', () => {
    const a = schedule();
    const b = schedule();
    b.windows![1] = { ...b.windows![1]!, extraStartTime: null, notes: null };

    expect(scheduleKey(a)).toBe(scheduleKey(b));
  });

  it.each([
    [
      'a window time',
      (s: WeeklySchedule) => {
        s.windows![0]!.endTime = '18:30:00';
      },
    ],
    [
      'a window note',
      (s: WeeklySchedule) => {
        s.windows![0]!.notes = 'other';
      },
    ],
    [
      'a window removed',
      (s: WeeklySchedule) => {
        s.windows!.pop();
      },
    ],
    [
      'a window status',
      (s: WeeklySchedule) => {
        s.windows![0]!.status = 'paused';
      },
    ],
    [
      'a preference frequency',
      (s: WeeklySchedule) => {
        s.subjectPreferences![0]!.sessionsPerWeek = 5;
      },
    ],
    [
      'a preference removed',
      (s: WeeklySchedule) => {
        s.subjectPreferences!.pop();
      },
    ],
  ])('differs when %s differs', (_label, change) => {
    const changed = schedule();
    change(changed);

    expect(scheduleKey(changed)).not.toBe(scheduleKey(schedule()));
  });
});

describe('previewFingerprint', () => {
  const entry = (overrides: Record<string, unknown> = {}) => ({
    session_id: 'a',
    subjects: ['Math'],
    old_start: '2026-06-02T20:00:00Z',
    old_end: '2026-06-02T21:00:00Z',
    action: 'reschedule',
    new_start: '2026-06-03T20:00:00Z',
    new_end: '2026-06-03T21:00:00Z',
    reason: 'because',
    ...overrides,
  });
  const preview = (entries: unknown[], counts = {}): WeeklyPreview =>
    ({
      total_scanned: 3,
      affected_count: entries.length,
      reschedule_count: entries.length,
      cancel_count: 0,
      entries,
      ...counts,
    }) as WeeklyPreview;

  it('is stable against order, reasons and subjects', () => {
    const one = preview([entry(), entry({ session_id: 'b' })]);
    const two = preview([
      entry({ session_id: 'b', reason: 'x', subjects: ['Y'] }),
      entry({ reason: 'z' }),
    ]);

    expect(previewFingerprint(one)).toBe(previewFingerprint(two));
  });

  it('does not depend on how many lessons were scanned', () => {
    expect(previewFingerprint(preview([entry()]))).toBe(
      previewFingerprint(preview([entry()], { total_scanned: 9 })),
    );
  });

  it.each([
    ['an action', { action: 'cancel' }],
    ['an old time', { old_start: '2026-06-02T19:00:00Z' }],
    ['a new time', { new_end: '2026-06-03T22:00:00Z' }],
    ['a lesson', { session_id: 'other' }],
  ])('changes when %s changes', (_label, overrides) => {
    expect(previewFingerprint(preview([entry(overrides)]))).not.toBe(
      previewFingerprint(preview([entry()])),
    );
  });

  it('changes when an entry is added or the cancel count changes', () => {
    const base = previewFingerprint(preview([entry()]));

    expect(
      previewFingerprint(preview([entry(), entry({ session_id: 'b' })])),
    ).not.toBe(base);
    expect(
      previewFingerprint(preview([entry()], { cancel_count: 1 })),
    ).not.toBe(base);
    // The backend sends null for an empty list.
    expect(
      previewFingerprint({ ...preview([]), entries: null } as WeeklyPreview),
    ).toBe(previewFingerprint(preview([])));
  });
});

describe('savedMatches', () => {
  const sent = (): WeeklyPreviewRequest => ({
    windows: [
      {
        dayOfWeek: 2,
        startTime: '17:00:00',
        endTime: '19:00:00',
        timezone: 'America/New_York',
      },
      { dayOfWeek: 0, startTime: '09:00:00', endTime: '11:00:00' },
    ],
    subjectPreferences: [
      {
        learnerSubjectId: 'c1b2c3d4-4444-4222-8333-444455556666',
        preferredDuration: 60,
        sessionsPerWeek: 2,
      },
    ],
  });
  const saved = (): WeeklySchedule => ({
    learnerId: 'learner',
    windows: [
      {
        id: '1',
        dayOfWeek: 0,
        startTime: '09:00:00',
        endTime: '11:00:00',
        timezone: 'America/New_York',
        status: 'active',
      },
      {
        id: '2',
        dayOfWeek: 2,
        startTime: '17:00:00',
        endTime: '19:00:00',
        timezone: 'America/New_York',
        status: 'active',
      },
    ],
    subjectPreferences: [
      {
        id: 'p',
        learnerSubjectId: 'c1b2c3d4-4444-4222-8333-444455556666',
        subject: 'Math',
        preferredDuration: 60,
        sessionsPerWeek: 2,
        status: 'active',
      },
    ],
  });

  it('matches whatever the order, and ignores a timezone that was not sent', () => {
    expect(savedMatches(saved(), sent())).toBe(true);
  });

  it.each([
    [
      'a window time differs',
      (s: WeeklySchedule) => {
        s.windows![1]!.startTime = '17:30:00';
      },
    ],
    [
      'a window is missing',
      (s: WeeklySchedule) => {
        s.windows!.pop();
      },
    ],
    [
      'an extra window was saved',
      (s: WeeklySchedule) => {
        s.windows!.push({
          id: '3',
          dayOfWeek: 4,
          startTime: '08:00:00',
          endTime: '09:00:00',
          status: 'active',
        });
      },
    ],
    [
      'a sent timezone was not kept',
      (s: WeeklySchedule) => {
        s.windows![1]!.timezone = 'Africa/Lagos';
      },
    ],
    [
      'a preference frequency differs',
      (s: WeeklySchedule) => {
        s.subjectPreferences![0]!.sessionsPerWeek = 3;
      },
    ],
    [
      'a preference duration differs',
      (s: WeeklySchedule) => {
        s.subjectPreferences![0]!.preferredDuration = 45;
      },
    ],
    [
      'a preference is missing',
      (s: WeeklySchedule) => {
        s.subjectPreferences = [];
      },
    ],
    [
      'a preference is for another subject',
      (s: WeeklySchedule) => {
        s.subjectPreferences![0]!.learnerSubjectId = 'other';
      },
    ],
  ])('does not match when %s', (_label, change) => {
    const changed = saved();
    change(changed);

    expect(savedMatches(changed, sent())).toBe(false);
  });
});
