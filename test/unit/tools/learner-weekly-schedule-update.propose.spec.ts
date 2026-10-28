// Copied from tool.template.spec.ts. learner_weekly_schedule_update is a write tool: this file
// covers the propose step, which must never change anything; the confirm step is in the sibling
// specs.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FAKE_LEARNER_ID,
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
  fakeWeeklyPreviewWithActions,
} from '../../helpers/fake-weekly.js';
import {
  openSession,
  signInViaTool,
} from '../../helpers/household-fixtures.js';
import { textOf } from '../../helpers/tool-harness.js';
import {
  UPDATE_REASON,
  createUpdateFixture,
  putRequests,
  weeklyWrites,
} from '../../helpers/weekly-update-fixture.js';
import { weeklyRequests } from '../../helpers/weekly-fixture.js';

const WARNING =
  "The backend's preview may not list every lesson that could be moved or cancelled, and cancelled lessons cannot be restored with these tools, so tell the parent this in plain words and get an explicit yes before confirming.";

describe('learner_weekly_schedule_update tool, step propose', () => {
  let fx: Awaited<ReturnType<typeof createUpdateFixture>>;

  beforeEach(async () => {
    fx = await createUpdateFixture();
  });

  afterEach(async () => {
    await fx.close();
  });

  const signIn = () => signInViaTool(fx.connection.client);

  it('is listed as one plain object, not read-only, destructive, not idempotent', async () => {
    const { tools } = await fx.connection.client.listTools();
    const tool = tools.find(
      (candidate) => candidate.name === 'learner_weekly_schedule_update',
    );
    const schema = tool?.inputSchema as Record<string, unknown>;

    expect(schema.type).toBe('object');
    expect(schema).not.toHaveProperty('oneOf');
    expect(schema).not.toHaveProperty('anyOf');
    expect(schema).toMatchObject({
      required: ['step'],
      additionalProperties: false,
    });
    expect(Object.keys((schema.properties ?? {}) as object).sort()).toEqual([
      'confirmationToken',
      'learnerId',
      'parentAcknowledgesLessonsMayBeChanged',
      'reason',
      'step',
      'windows',
    ]);
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
  });

  it('tells the model to show the whole proposal, get an explicit yes, and never to confirm alone', async () => {
    const { tools } = await fx.connection.client.listTools();
    const description =
      tools.find(
        (candidate) => candidate.name === 'learner_weekly_schedule_update',
      )?.description ?? '';

    expect(description).toMatch(/Show the WHOLE proposal/);
    expect(description).toMatch(/explicit yes BEFORE calling step 'confirm'/);
    expect(description).toMatch(/never confirm on your own/);
    expect(description).toMatch(/INCOMPLETE/);
    expect(description).toMatch(
      /cancelled lessons cannot be restored with these tools/,
    );
    expect(description).toMatch(/parentAcknowledgesLessonsMayBeChanged: true/);
    expect(description).toMatch(/NEVER retried/);
    expect(description).toMatch(/learner_weekly_schedule_get/);
    expect(description).toMatch(/learner_sessions_list/);
    expect(description).toMatch(/comes from the request’s sign-in/);
  });

  it('proposes with exactly the documented fields, and changes NOTHING', async () => {
    const sessionId = await signIn();

    const result = await fx.propose(sessionId);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      status: 'proposed',
      confirmationToken: expect.stringMatching(/^[A-Za-z0-9_-]{43,}$/),
      learnerId: FAKE_LEARNER_ID,
      timezone: 'America/New_York',
      currentWindows: [
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
      newWindows: [
        {
          windowId: WINDOW_TUESDAY_ID,
          dayOfWeek: 2,
          dayName: 'Tuesday',
          startTime: '17:00:00',
          endTime: '19:00:00',
          timezone: 'America/New_York',
          status: 'active',
          whenLocal:
            'Tuesday, 5:00 PM to 7:00 PM and 7:00 PM to 8:00 PM (America/New_York)',
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
      affectedLessons: [],
      previewIsIncomplete: true,
      warning: WARNING,
      expiresInSeconds: 300,
    });
    expect(putRequests(fx.fake)).toHaveLength(0);
    expect(weeklyWrites(fx.fake)).toEqual([]);
    // The schedule is exactly where it was.
    expect(JSON.stringify(fx.fake.weekly.current(FAKE_LEARNER_ID))).toBe(
      JSON.stringify(fx.fake.weekly.schedule(FAKE_LEARNER_ID)),
    );
  });

  it('reads, then previews the new windows once, and sends nothing else', async () => {
    const sessionId = await signIn();

    await fx.propose(sessionId);

    expect(weeklyRequests(fx.fake)).toEqual([
      `GET /api/v1/learners/${FAKE_LEARNER_ID}/weekly-schedule-v2`,
      `POST /api/v1/learners/${FAKE_LEARNER_ID}/weekly-schedule-v2/preview`,
    ]);
  });

  it('previews the same request the preview tool would, with the current subject preferences unchanged', async () => {
    const sessionId = await signIn();

    await fx.propose(sessionId);

    const body = fx.fake.weekly.previewBodies[0] as {
      windows: Record<string, unknown>[];
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
    expect(body.windows[0]).toMatchObject({
      id: WINDOW_TUESDAY_ID,
      startTime: '17:00:00',
      endTime: '19:00:00',
      extraStartTime: '19:00:00',
      notes: NOTES_MARKER,
    });
  });

  it('shows every entry the backend previews, whatever its action, and says the preview is incomplete', async () => {
    fx.fake.weekly.preview = fakeWeeklyPreviewWithActions;
    const sessionId = await signIn();

    const result = await fx.propose(sessionId);

    const body = result.structuredContent as {
      affectedLessons: { action: string; reason: string }[];
      previewIsIncomplete: boolean;
      warning: string;
    };
    expect(body.affectedLessons.map((entry) => entry.action)).toEqual([
      'reschedule',
      'cancel',
      'unchanged',
      'unmatch',
      'something-new',
    ]);
    expect(body.previewIsIncomplete).toBe(true);
    expect(body.warning).toBe(WARNING);
  });

  it('says the preview is incomplete even when it lists nothing, and when it lists a cancel', async () => {
    const empty = (await fx.propose(await signIn()))
      .structuredContent as Record<string, unknown>;
    fx.fake.weekly.preview = fakeWeeklyPreview;
    const full = (await fx.propose(await signIn())).structuredContent as Record<
      string,
      unknown
    >;

    for (const body of [empty, full]) {
      expect(body.previewIsIncomplete).toBe(true);
      expect(body.warning).toBe(WARNING);
    }
    expect((full.affectedLessons as unknown[]).length).toBe(2);
  });

  it('states what the warning must: may not list every lesson, cancelled lessons cannot be restored, tell the parent in plain words', () => {
    expect(WARNING).toMatch(
      /may not list every lesson that could be moved or cancelled/,
    );
    expect(WARNING).toMatch(
      /cancelled lessons cannot be restored with these tools/,
    );
    expect(WARNING).toMatch(/tell the parent this in plain words/);
  });

  it('leaves out notes, tutor and learner names, and tokens', async () => {
    fx.fake.weekly.preview = fakeWeeklyPreview;

    const text = JSON.stringify(await fx.propose(await signIn()));

    expect(text).not.toContain(NOTES_MARKER);
    expect(text).not.toContain(TUTOR_NAME_MARKER);
    expect(text).not.toContain(LEARNER_NAME_MARKER);
    expect(text).not.toContain('tutor_id');
    expect(text).not.toContain(TOKEN_MARKER);
  });

  it('gives a new token each time and still changes nothing', async () => {
    const sessionId = await signIn();

    const first = (await fx.propose(sessionId)).structuredContent as {
      confirmationToken: string;
    };
    const second = (await fx.propose(sessionId)).structuredContent as {
      confirmationToken: string;
    };

    expect(first.confirmationToken).not.toBe(second.confirmationToken);
    expect(weeklyWrites(fx.fake)).toEqual([]);
  });

  it('refuses a windowId that is not the learner’s, before the preview, and gives no token', async () => {
    const result = await fx.propose(await signIn(), {
      windows: [
        {
          windowId: 'd1b2c3d4-9999-4222-8333-444455556666',
          dayOfWeek: 2,
          startTime: '16:00',
          endTime: '18:00',
        },
      ],
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('confirmationToken');
    expect(fx.fake.weekly.previewBodies).toEqual([]);
  });

  describe('who may propose', () => {
    it('refuses a learner that is not in the household, without touching the weekly routes', async () => {
      const result = await fx.propose(await signIn(), {
        learnerId: FAKE_OTHER_LEARNER_ID,
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe(
        'Not allowed to change this learner’s schedule.',
      );
      expect(weeklyRequests(fx.fake)).toEqual([]);
    });

    it('refuses a tutor before any backend call', async () => {
      const sessionId = openSession(
        fx.fake,
        fx.connection.sessions,
        'house-1',
        'tutor',
      );
      const before = fx.fake.requests.length;

      const result = await fx.propose(sessionId);

      expect(result.isError).toBe(true);
      expect(fx.fake.requests).toHaveLength(before);
    });

    it('refuses a session with no household without reading the schedule', async () => {
      const sessionId = openSession(fx.fake, fx.connection.sessions, null);

      const result = await fx.propose(sessionId);

      expect(result.isError).toBe(true);
      expect(weeklyRequests(fx.fake)).toEqual([]);
    });

    it('refuses an unknown session before any backend call', async () => {
      const before = fx.fake.requests.length;

      const result = await fx.propose('no-such-session');

      expect(result.isError).toBe(true);
      expect(fx.fake.requests).toHaveLength(before);
    });

    it('uses only the guardian-facing routes', async () => {
      await fx.propose(await signIn());

      expect(
        fx.fake.requests.some((request) => request.path.includes('/agent/')),
      ).toBe(false);
    });
  });

  describe('input checked before any backend call', () => {
    const win = { dayOfWeek: 2, startTime: '16:00', endTime: '18:00' };

    it.each([
      ['no windows', { windows: [] }],
      ['no windows field', { windows: undefined }],
      [
        'more than 14 windows',
        {
          windows: Array.from({ length: 15 }, (_, i) => ({
            dayOfWeek: i % 7,
            startTime: `0${i % 9}:00`,
            endTime: `0${i % 9}:30`,
          })),
        },
      ],
      ['a duplicate window', { windows: [win, { ...win }] }],
      [
        'a duplicate with another timezone',
        { windows: [win, { ...win, timezone: 'Africa/Lagos' }] },
      ],
      [
        'an endTime equal to the startTime',
        { windows: [{ ...win, endTime: '16:00' }] },
      ],
      [
        'an endTime before the startTime',
        { windows: [{ ...win, endTime: '15:00' }] },
      ],
      ['a day of 7', { windows: [{ ...win, dayOfWeek: 7 }] }],
      ['a time with seconds', { windows: [{ ...win, startTime: '16:00:00' }] }],
      [
        'a made-up timezone',
        { windows: [{ ...win, timezone: 'Mars/Olympus' }] },
      ],
      [
        'the same windowId twice',
        {
          windows: [
            { ...win, windowId: WINDOW_TUESDAY_ID },
            {
              dayOfWeek: 3,
              startTime: '16:00',
              endTime: '18:00',
              windowId: WINDOW_TUESDAY_ID.toUpperCase(),
            },
          ],
        },
      ],
      ['a status on a window', { windows: [{ ...win, status: 'inactive' }] }],
      ['notes on a window', { windows: [{ ...win, notes: 'hello' }] }],
      [
        'a date range on a window',
        { windows: [{ ...win, effectiveFrom: '2026-01-01' }] },
      ],
      ['subjectPreferences', { subjectPreferences: [] }],
      ['a householdId', { householdId: 'house-1' }],
      ['a learnerId that is not a UUID', { learnerId: 'learner-1' }],
      ['a missing learnerId', { learnerId: undefined }],
      ['a missing reason', { reason: undefined }],
      ['an empty reason', { reason: '' }],
      ['a reason of only spaces', { reason: '   ' }],
      ['a reason of 501 characters', { reason: 'x'.repeat(501) }],
      ['a confirmationToken on a propose', { confirmationToken: 'abc' }],
      [
        'the acknowledgement on a propose',
        { parentAcknowledgesLessonsMayBeChanged: true },
      ],
      ['an unknown step', { step: 'maybe' }],
    ])('rejects %s', async (_label, overrides) => {
      const sessionId = await signIn();
      const before = fx.fake.requests.length;

      const refused = await fx
        .propose(sessionId, overrides)
        .then((result) => result.isError === true)
        .catch(() => true);

      expect(refused).toBe(true);
      expect(fx.fake.requests).toHaveLength(before);
    });

    it('accepts a reason of exactly 500 characters, trimmed, and 14 distinct windows', async () => {
      const windows = Array.from({ length: 14 }, (_, index) => ({
        dayOfWeek: index % 7,
        startTime: index < 7 ? '08:00' : '09:00',
        endTime: index < 7 ? '09:00' : '10:00',
      }));

      const result = await fx.propose(await signIn(), {
        windows,
        reason: `  ${'x'.repeat(500)}  `,
      });

      expect(result.isError).toBeUndefined();
    });
  });

  it('does not echo the reason back: it is kept with the proposal for the record', async () => {
    const result = await fx.propose(await signIn(), { reason: UPDATE_REASON });

    expect(JSON.stringify(result)).not.toContain(UPDATE_REASON);
  });
});
