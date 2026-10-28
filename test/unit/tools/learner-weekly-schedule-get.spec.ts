// Copied from tool.template.spec.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FAKE_LEARNER_ID,
  FAKE_OTHER_LEARNER_ID,
} from '../../helpers/fake-lessons-data.js';
import { TOKEN_MARKER } from '../../helpers/fake-mssuize.js';
import {
  LEARNER_SUBJECT_ID,
  NOTES_MARKER,
  PREFERENCE_ID,
  WINDOW_SUNDAY_ID,
  WINDOW_TUESDAY_ID,
} from '../../helpers/fake-weekly.js';
import { openSession } from '../../helpers/household-fixtures.js';
import { textOf } from '../../helpers/tool-harness.js';
import {
  createWeeklyFixture,
  weeklyRequests,
} from '../../helpers/weekly-fixture.js';

describe('learner_weekly_schedule_get tool', () => {
  let fixture: Awaited<ReturnType<typeof createWeeklyFixture>>;

  beforeEach(async () => {
    fixture = await createWeeklyFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  it('returns exactly the documented fields, with a day name for each window', async () => {
    const sessionId = await fixture.signIn();

    const result = await fixture.get({ sessionId, learnerId: FAKE_LEARNER_ID });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      learnerId: FAKE_LEARNER_ID,
      windows: [
        {
          windowId: WINDOW_TUESDAY_ID,
          dayOfWeek: 2,
          dayName: 'Tuesday',
          startTime: '16:00:00',
          endTime: '18:00:00',
          timezone: 'America/New_York',
          status: 'active',
          whenLocal:
            'Tuesday, 4:00 PM to 6:00 PM and 7:00 PM to 8:00 PM (America/New_York)',
          extraStartTime: '19:00:00',
          extraEndTime: '20:00:00',
        },
        {
          windowId: WINDOW_SUNDAY_ID,
          dayOfWeek: 0,
          dayName: 'Sunday',
          startTime: '09:00:00',
          endTime: '11:00:00',
          timezone: 'America/New_York',
          status: 'active',
          whenLocal: 'Sunday, 9:00 AM to 11:00 AM (America/New_York)',
        },
      ],
      subjectPreferences: [
        {
          subjectPreferenceId: PREFERENCE_ID,
          learnerSubjectId: LEARNER_SUBJECT_ID,
          subject: 'Math',
          preferredDuration: 60,
          sessionsPerWeek: 2,
          status: 'active',
        },
      ],
    });
  });

  it.each([
    [0, 'Sunday'],
    [1, 'Monday'],
    [2, 'Tuesday'],
    [3, 'Wednesday'],
    [4, 'Thursday'],
    [5, 'Friday'],
    [6, 'Saturday'],
  ])('maps dayOfWeek %i to %s', async (dayOfWeek, dayName) => {
    fixture.fake.weekly.schedule = (learnerId) => ({
      learnerId,
      windows: [
        {
          id: WINDOW_SUNDAY_ID,
          dayOfWeek,
          startTime: '09:00:00',
          endTime: '10:00:00',
          status: 'active',
        },
      ],
      subjectPreferences: [],
    });
    const sessionId = await fixture.signIn();

    const result = await fixture.get({ sessionId, learnerId: FAKE_LEARNER_ID });

    const { windows } = result.structuredContent as {
      windows: { dayName: string; timezone: unknown }[];
    };
    expect(windows[0]?.dayName).toBe(dayName);
    expect(windows[0]?.timezone).toBeNull();
  });

  it('treats a day outside 0 to 6 from the backend as an unexpected response', async () => {
    fixture.fake.weekly.schedule = (learnerId) => ({
      learnerId,
      windows: [
        {
          id: WINDOW_SUNDAY_ID,
          dayOfWeek: 7,
          startTime: '09:00:00',
          endTime: '10:00:00',
          status: 'active',
        },
      ],
      subjectPreferences: [],
    });
    const sessionId = await fixture.signIn();

    const result = await fixture.get({ sessionId, learnerId: FAKE_LEARNER_ID });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/unexpected response/i);
  });

  it('gives empty lists when the backend sends null', async () => {
    fixture.fake.weekly.schedule = (learnerId) => ({
      learnerId,
      windows: null,
      subjectPreferences: null,
    });
    const sessionId = await fixture.signIn();

    const result = await fixture.get({ sessionId, learnerId: FAKE_LEARNER_ID });

    expect(result.structuredContent).toEqual({
      learnerId: FAKE_LEARNER_ID,
      windows: [],
      subjectPreferences: [],
    });
  });

  it('leaves out notes, dates and the preferred subject, and never leaks a token', async () => {
    const sessionId = await fixture.signIn();

    const result = await fixture.get({ sessionId, learnerId: FAKE_LEARNER_ID });

    const text = JSON.stringify(result);
    expect(text).not.toContain(NOTES_MARKER);
    expect(text).not.toContain('effectiveFrom');
    expect(text).not.toContain('Algebra');
    expect(text).not.toContain(TOKEN_MARKER);
  });

  it('checks the learner belongs to the household before it reads the schedule', async () => {
    const sessionId = await fixture.signIn();

    const result = await fixture.get({
      sessionId,
      learnerId: FAKE_OTHER_LEARNER_ID,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Not allowed to access this learner.');
    expect(weeklyRequests(fixture.fake)).toEqual([]);
  });

  it('refuses a tutor before any backend call', async () => {
    const sessionId = openSession(
      fixture.fake,
      fixture.connection.sessions,
      'house-1',
      'tutor',
    );
    const before = fixture.fake.requests.length;

    const result = await fixture.get({ sessionId, learnerId: FAKE_LEARNER_ID });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Not allowed to access this learner.');
    expect(fixture.fake.requests).toHaveLength(before);
  });

  it('refuses a session with no household without reading the schedule', async () => {
    const sessionId = openSession(
      fixture.fake,
      fixture.connection.sessions,
      null,
    );

    const result = await fixture.get({ sessionId, learnerId: FAKE_LEARNER_ID });

    expect(result.isError).toBe(true);
    expect(weeklyRequests(fixture.fake)).toEqual([]);
  });

  it.each([
    ['a learnerId that is not a UUID', { learnerId: 'learner-1' }],
    ['a householdId', { householdId: 'house-1' }],
    ['an unknown field', { extra: true }],
  ])('rejects %s before any backend call', async (_label, extra) => {
    const sessionId = await fixture.signIn();
    const before = fixture.fake.requests.length;

    const refused = await fixture
      .get({ sessionId, learnerId: FAKE_LEARNER_ID, ...extra })
      .then((result) => result.isError === true)
      .catch(() => true);

    expect(refused).toBe(true);
    expect(fixture.fake.requests).toHaveLength(before);
  });

  it('uses only the guardian-facing routes', async () => {
    const sessionId = await fixture.signIn();

    await fixture.get({ sessionId, learnerId: FAKE_LEARNER_ID });

    expect(fixture.fake.requests.some((r) => r.path.includes('/agent/'))).toBe(
      false,
    );
    expect(weeklyRequests(fixture.fake)).toEqual([
      `GET /api/v1/learners/${FAKE_LEARNER_ID}/weekly-schedule-v2`,
    ]);
  });
});
