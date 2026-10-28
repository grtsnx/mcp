// Copied from tool.template.spec.ts. This file covers the confirm step when the save works: the
// schedule and the preview are checked again first, exactly one PUT is sent with exactly the
// windows and the unchanged subject preferences, and the saved schedule is read back. The token is
// single-use, short-lived, and tied to the sign-in session and the action. Failures are in
// learner-weekly-schedule-update.failures.spec.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FAKE_LEARNER_ID,
  FAKE_LESSON_ID,
} from '../../helpers/fake-lessons-data.js';
import { TOKEN_MARKER } from '../../helpers/fake-mssuize.js';
import {
  LEARNER_SUBJECT_ID,
  NOTES_MARKER,
  PREFERENCE_ID,
  WINDOW_SUNDAY_ID,
  WINDOW_TUESDAY_ID,
  fakeWeeklySchedule,
} from '../../helpers/fake-weekly.js';
import { signInViaTool } from '../../helpers/household-fixtures.js';
import { textOf } from '../../helpers/tool-harness.js';
import {
  LESSONS_SEPARATELY,
  createUpdateFixture,
  putRequests,
  weeklyWrites,
} from '../../helpers/weekly-update-fixture.js';

const REFUSED =
  'That confirmation is not valid any more. Make a new proposal and ask the parent to confirm it.';

describe('learner_weekly_schedule_update tool, step confirm', () => {
  let fx: Awaited<ReturnType<typeof createUpdateFixture>>;

  beforeEach(async () => {
    fx = await createUpdateFixture();
  });

  afterEach(async () => {
    await fx.close();
  });

  it('sends exactly one PUT with exactly windows and subjectPreferences, and reports the saved schedule', async () => {
    const { sessionId, token } = await fx.proposed();

    const result = await fx.confirm(sessionId, token);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      status: 'updated',
      learnerId: FAKE_LEARNER_ID,
      // The schedule before the save, so a mistake can be put back.
      previousWindows: [
        expect.objectContaining({
          dayName: 'Tuesday',
          startTime: '16:00:00',
          endTime: '18:00:00',
        }),
        expect.objectContaining({ dayName: 'Sunday', startTime: '09:00:00' }),
      ],
      windows: [
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
      message: LESSONS_SEPARATELY,
    });
    const sent = putRequests(fx.fake);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.path).toBe(
      `/api/v1/learners/${FAKE_LEARNER_ID}/weekly-schedule-v2`,
    );
    expect(Object.keys(sent[0]?.body as object).sort()).toEqual([
      'subjectPreferences',
      'windows',
    ]);
    expect(weeklyWrites(fx.fake)).toEqual([
      `PUT /api/v1/learners/${FAKE_LEARNER_ID}/weekly-schedule-v2`,
    ]);
  });

  it('sends the proposed windows, carrying over what the tool cannot change, and the unchanged subject preferences', async () => {
    const { sessionId, token } = await fx.proposed();

    await fx.confirm(sessionId, token);

    expect(putRequests(fx.fake)[0]?.body).toEqual({
      windows: [
        {
          id: WINDOW_TUESDAY_ID,
          dayOfWeek: 2,
          startTime: '17:00:00',
          endTime: '19:00:00',
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
      ],
      subjectPreferences: [
        {
          id: PREFERENCE_ID,
          learnerSubjectId: LEARNER_SUBJECT_ID,
          preferredSubject: 'Algebra',
          preferredDuration: 60,
          sessionsPerWeek: 2,
          status: 'active',
          notes: NOTES_MARKER,
        },
      ],
    });
  });

  it('sends the same subject preferences the preview was given, so nothing about subjects can change', async () => {
    const { sessionId, token } = await fx.proposed();
    await fx.confirm(sessionId, token);

    const put = putRequests(fx.fake)[0]?.body as {
      subjectPreferences: unknown[];
    };
    const previewed = fx.fake.weekly.previewBodies[0] as {
      subjectPreferences: unknown[];
    };

    expect(put.subjectPreferences).toEqual(previewed.subjectPreferences);
  });

  it('checks the schedule and the preview again before it saves, and reads the schedule back after', async () => {
    const { sessionId, token } = await fx.proposed();
    fx.fake.requests.length = 0;

    await fx.confirm(sessionId, token);

    const weekly = fx.fake.requests
      .filter((request) => request.path.includes('/weekly-schedule'))
      .map(
        (request) =>
          `${request.method} ${request.path.replace(FAKE_LEARNER_ID, '{id}')}`,
      );
    expect(weekly).toEqual([
      'GET /api/v1/learners/{id}/weekly-schedule-v2',
      'POST /api/v1/learners/{id}/weekly-schedule-v2/preview',
      'PUT /api/v1/learners/{id}/weekly-schedule-v2',
      'GET /api/v1/learners/{id}/weekly-schedule-v2',
    ]);
  });

  it('says the backend adjusts lessons separately and to check them with learner_sessions_list', async () => {
    const { sessionId, token } = await fx.proposed();

    const result = await fx.confirm(sessionId, token);

    expect(textOf(result)).toMatch(
      /adjusts the learner's upcoming lessons separately/,
    );
    expect(textOf(result)).toMatch(/learner_sessions_list/);
  });

  it('returns no token, no notes and no backend message', async () => {
    const { sessionId, token } = await fx.proposed();

    const text = JSON.stringify(await fx.confirm(sessionId, token));

    expect(text).not.toContain(token);
    expect(text).not.toContain(TOKEN_MARKER);
    expect(text).not.toContain(NOTES_MARKER);
  });

  describe('the acknowledgement that lessons may be changed', () => {
    it.each([
      ['missing', { parentAcknowledgesLessonsMayBeChanged: undefined }],
      ['false', { parentAcknowledgesLessonsMayBeChanged: false }],
      ['the string "true"', { parentAcknowledgesLessonsMayBeChanged: 'true' }],
    ])(
      'is refused when it is %s, with nothing sent and the token still good',
      async (_label, overrides) => {
        const { sessionId, token } = await fx.proposed();
        const before = fx.fake.requests.length;

        const refused = await fx
          .confirm(sessionId, token, overrides)
          .then((result) => result.isError === true)
          .catch(() => true);

        expect(refused).toBe(true);
        expect(fx.fake.requests).toHaveLength(before);
        const accepted = await fx.confirm(sessionId, token);
        expect(accepted.structuredContent).toMatchObject({ status: 'updated' });
      },
    );
  });

  describe('what the read-back finds', () => {
    it('says unconfirmed, pointing at both reads, when the saved schedule is not what was sent', async () => {
      const { sessionId, token } = await fx.proposed();
      fx.fake.weekly.applyPut = false;

      const result = await fx.confirm(sessionId, token);

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({
        status: 'unconfirmed',
        learnerId: FAKE_LEARNER_ID,
      });
      expect(textOf(result)).toMatch(/learner_weekly_schedule_get/);
      expect(textOf(result)).toMatch(/learner_sessions_list/);
      expect(textOf(result)).toMatch(
        /adjusts the learner's upcoming lessons separately/,
      );
      expect(putRequests(fx.fake)).toHaveLength(1);
    });

    it('says unconfirmed, not failed, when the save went through but the read-back failed', async () => {
      const { sessionId, token } = await fx.proposed();
      fx.state.failReadBack = true;

      const result = await fx.confirm(sessionId, token);

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toMatchObject({ status: 'unconfirmed' });
      expect(putRequests(fx.fake)).toHaveLength(1);
    });

    it('does not say updated when only the windows match and a subject preference differs', async () => {
      const { sessionId, token } = await fx.proposed();
      const original = fx.fake.weekly.putBodies;
      fx.fake.weekly.schedule = fakeWeeklySchedule;
      // The backend saves the windows but answers with a different frequency afterwards.
      const realCurrent = fx.fake.weekly.current.bind(fx.fake.weekly);
      fx.fake.weekly.current = (learnerId: string) => {
        const schedule = realCurrent(learnerId) as ReturnType<
          typeof fakeWeeklySchedule
        >;
        return original.length > 0
          ? {
              ...schedule,
              subjectPreferences: schedule.subjectPreferences.map((p) => ({
                ...p,
                sessionsPerWeek: 1,
              })),
            }
          : schedule;
      };

      const result = await fx.confirm(sessionId, token);

      expect(result.structuredContent).toMatchObject({ status: 'unconfirmed' });
    });
  });

  describe('the confirmation token', () => {
    it('works once: a repeat is refused and sends nothing', async () => {
      const { sessionId, token } = await fx.proposed();
      await fx.confirm(sessionId, token);

      const again = await fx.confirm(sessionId, token);

      expect(again.isError).toBe(true);
      expect(textOf(again)).toBe(REFUSED);
      expect(putRequests(fx.fake)).toHaveLength(1);
    });

    it('gives the same error for an unknown, used, expired and another session’s token', async () => {
      const used = await fx.proposed();
      const expired = await fx.proposed();
      const other = await fx.proposed();
      const stranger = await signInViaTool(fx.connection.client);
      await fx.confirm(used.sessionId, used.token);
      fx.clock.advance(5 * 60_000 + 1);

      const texts = [
        textOf(await fx.confirm(used.sessionId, used.token)),
        textOf(await fx.confirm(expired.sessionId, expired.token)),
        textOf(await fx.confirm(stranger, other.token)),
        textOf(await fx.confirm(other.sessionId, 'not-a-real-token')),
      ];

      expect(new Set(texts)).toEqual(new Set([REFUSED]));
      expect(putRequests(fx.fake)).toHaveLength(1);
    });

    it('is still good one millisecond before 5 minutes and refused at 5 minutes, with nothing sent', async () => {
      const early = await fx.proposed();
      fx.clock.advance(5 * 60_000 - 1);
      expect(
        (await fx.confirm(early.sessionId, early.token)).structuredContent,
      ).toMatchObject({ status: 'updated' });

      const late = await fx.proposed();
      fx.clock.advance(5 * 60_000);
      const refused = await fx.confirm(late.sessionId, late.token);

      expect(textOf(refused)).toBe(REFUSED);
      expect(putRequests(fx.fake)).toHaveLength(1);
    });

    it('cannot be used by another sign-in session, and still works for its own', async () => {
      const { sessionId, token } = await fx.proposed();
      const stranger = await signInViaTool(fx.connection.client);

      expect((await fx.confirm(stranger, token)).isError).toBe(true);
      expect(putRequests(fx.fake)).toHaveLength(0);
      expect(
        (await fx.confirm(sessionId, token)).structuredContent,
      ).toMatchObject({ status: 'updated' });
    });

    it('is not a token for a cancel, and a cancel token is not one for a save', async () => {
      const { sessionId, token } = await fx.proposed();
      const { confirmationToken: cancelToken } =
        fx.connection.sessions.createProposal(sessionId, {
          action: 'cancel',
          lessonId: FAKE_LESSON_ID,
          reason: 'x',
        });

      const refused = await fx.confirm(sessionId, cancelToken);

      expect(textOf(refused)).toBe(REFUSED);
      expect(putRequests(fx.fake)).toHaveLength(0);
      expect(
        (await fx.confirm(sessionId, token)).structuredContent,
      ).toMatchObject({ status: 'updated' });
    });

    it('stops working when the person signs out', async () => {
      const { sessionId, token } = await fx.proposed();
      await fx.connection.sessions.logout(sessionId);

      const result = await fx.confirm(sessionId, token);

      expect(result.isError).toBe(true);
      expect(putRequests(fx.fake)).toHaveLength(0);
    });

    it('saves the windows that were proposed, whatever is sent with the confirm', async () => {
      const { sessionId, token } = await fx.proposed();

      const refused = await fx
        .confirm(sessionId, token, {
          windows: [{ dayOfWeek: 1, startTime: '08:00', endTime: '09:00' }],
          learnerId: FAKE_LEARNER_ID,
          reason: 'different',
        })
        .then((result) => result.isError === true)
        .catch(() => true);

      expect(refused).toBe(true);
      expect(putRequests(fx.fake)).toHaveLength(0);
      await fx.confirm(sessionId, token);
      const body = putRequests(fx.fake)[0]?.body as {
        windows: { startTime: string }[];
      };
      expect(body.windows[0]?.startTime).toBe('17:00:00');
    });
  });

  it.each([
    ['no token', { confirmationToken: undefined }],
    ['an empty token', { confirmationToken: '' }],
    ['a token of 257 characters', { confirmationToken: 'x'.repeat(257) }],
  ])('rejects %s before any backend call', async (_label, overrides) => {
    const sessionId = await signInViaTool(fx.connection.client);
    const before = fx.fake.requests.length;

    const refused = await fx
      .confirm(sessionId, 'placeholder', overrides)
      .then((result) => result.isError === true)
      .catch(() => true);

    expect(refused).toBe(true);
    expect(fx.fake.requests).toHaveLength(before);
  });
});
