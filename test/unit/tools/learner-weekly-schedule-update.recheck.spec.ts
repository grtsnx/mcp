// Copied from tool.template.spec.ts. This file covers the re-check that learner_weekly_schedule_update
// confirm makes before it saves: the schedule against the snapshot, and the preview against its
// fingerprint. If either differs, or the learner is no longer in the household, nothing is sent.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TUTOR_NAME_MARKER,
  fakeWeeklyPreview,
  fakeWeeklySchedule,
} from '../../helpers/fake-weekly.js';
import { textOf } from '../../helpers/tool-harness.js';
import {
  CHANGED,
  createUpdateFixture,
  putRequests,
} from '../../helpers/weekly-update-fixture.js';

const REFUSED =
  'That confirmation is not valid any more. Make a new proposal and ask the parent to confirm it.';

describe('learner_weekly_schedule_update tool, the re-check before the save', () => {
  let fx: Awaited<ReturnType<typeof createUpdateFixture>>;

  beforeEach(async () => {
    fx = await createUpdateFixture();
  });

  afterEach(async () => {
    await fx.close();
  });

  it('refuses, and sends no save, when the learner’s schedule changed since the proposal', async () => {
    const { sessionId, token } = await fx.proposed();
    fx.fake.weekly.schedule = (learnerId) => {
      const schedule = fakeWeeklySchedule(learnerId);
      schedule.windows[1]!.endTime = '12:00:00';
      return schedule;
    };

    const result = await fx.confirm(sessionId, token);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(CHANGED);
    expect(putRequests(fx.fake)).toHaveLength(0);
  });

  it('refuses when only a subject preference changed', async () => {
    const { sessionId, token } = await fx.proposed();
    fx.fake.weekly.schedule = (learnerId) => {
      const schedule = fakeWeeklySchedule(learnerId);
      schedule.subjectPreferences[0]!.sessionsPerWeek = 3;
      return schedule;
    };

    const result = await fx.confirm(sessionId, token);

    expect(textOf(result)).toBe(CHANGED);
    expect(putRequests(fx.fake)).toHaveLength(0);
  });

  it('refuses, and sends no save, when the preview changed since the proposal', async () => {
    const { sessionId, token } = await fx.proposed();
    fx.fake.weekly.preview = fakeWeeklyPreview;

    const result = await fx.confirm(sessionId, token);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(CHANGED);
    expect(putRequests(fx.fake)).toHaveLength(0);
  });

  it('refuses when the preview lost an entry it had', async () => {
    fx.fake.weekly.preview = fakeWeeklyPreview;
    const { sessionId, token } = await fx.proposed();
    fx.fake.weekly.preview = {
      ...fakeWeeklyPreview,
      entries: fakeWeeklyPreview.entries.slice(0, 1),
    };

    const result = await fx.confirm(sessionId, token);

    expect(textOf(result)).toBe(CHANGED);
    expect(putRequests(fx.fake)).toHaveLength(0);
  });

  it('refuses when an entry’s new time changed', async () => {
    fx.fake.weekly.preview = fakeWeeklyPreview;
    const { sessionId, token } = await fx.proposed();
    fx.fake.weekly.preview = {
      ...fakeWeeklyPreview,
      entries: fakeWeeklyPreview.entries.map((entry, index) =>
        index === 0 ? { ...entry, new_start: '2026-06-02T22:00:00Z' } : entry,
      ),
    };

    const result = await fx.confirm(sessionId, token);

    expect(textOf(result)).toBe(CHANGED);
    expect(putRequests(fx.fake)).toHaveLength(0);
  });

  it('does not refuse for what is not about the lessons: names, reasons and the order of entries', async () => {
    fx.fake.weekly.preview = fakeWeeklyPreview;
    const { sessionId, token } = await fx.proposed();
    fx.fake.weekly.preview = {
      ...fakeWeeklyPreview,
      entries: [...fakeWeeklyPreview.entries].reverse().map((entry) => ({
        ...entry,
        tutor_name: `${TUTOR_NAME_MARKER}-2`,
        reason: 'reworded',
      })),
    };

    const result = await fx.confirm(sessionId, token);

    expect(result.structuredContent).toMatchObject({ status: 'updated' });
    expect(putRequests(fx.fake)).toHaveLength(1);
  });

  it('uses the token up first: after a refusal the same token is refused and nothing is sent', async () => {
    const { sessionId, token } = await fx.proposed();
    fx.fake.weekly.preview = fakeWeeklyPreview;
    await fx.confirm(sessionId, token);

    const again = await fx.confirm(sessionId, token);

    expect(textOf(again)).toBe(REFUSED);
    expect(putRequests(fx.fake)).toHaveLength(0);
  });

  it('refuses a learner that has left the household since the proposal, and sends no save', async () => {
    const { sessionId, token } = await fx.proposed();
    fx.fake.learners = [];

    const result = await fx.confirm(sessionId, token);

    expect(result.isError).toBe(true);
    expect(putRequests(fx.fake)).toHaveLength(0);
  });
});
