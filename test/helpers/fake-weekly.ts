import type { FakeRequest } from './fake-mssuize.js';
import {
  FAKE_LEARNER_ID,
  FAKE_LESSON_ID,
  FAKE_TUTOR_ID,
} from './fake-lessons-data.js';

interface FakeReply {
  status: number;
  body?: unknown;
  /** The backend never answers, so the caller times out. */
  neverRespond?: boolean;
}

export const WINDOW_TUESDAY_ID = 'a1b2c3d4-1111-4222-8333-444455556666';
export const WINDOW_SUNDAY_ID = 'a1b2c3d4-2222-4222-8333-444455556666';
export const PREFERENCE_ID = 'b1b2c3d4-3333-4222-8333-444455556666';
export const LEARNER_SUBJECT_ID = 'c1b2c3d4-4444-4222-8333-444455556666';
export const NOTES_MARKER = 'private-note-SHOULD-NOT-LEAK';
export const TUTOR_NAME_MARKER = 'Tutor-Name-SHOULD-NOT-LEAK';
export const LEARNER_NAME_MARKER = 'Learner-Name-SHOULD-NOT-LEAK';

export function fakeWeeklySchedule(learnerId: string) {
  return {
    learnerId,
    windows: [
      {
        id: WINDOW_TUESDAY_ID,
        dayOfWeek: 2,
        startTime: '16:00:00',
        endTime: '18:00:00',
        extraStartTime: '19:00:00',
        extraEndTime: '20:00:00',
        timezone: 'America/New_York',
        status: 'active',
        effectiveFrom: '2026-05-01',
        effectiveTo: '2026-12-31',
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
        subject: 'Math',
        preferredSubject: 'Algebra',
        preferredDuration: 60,
        sessionsPerWeek: 2,
        status: 'active',
        notes: NOTES_MARKER,
      },
    ],
  };
}

// A reply with a reschedule and a cancel entry, and the tutor and learner names that must stay hidden.
export const fakeWeeklyPreview = {
  total_scanned: 4,
  affected_count: 2,
  reschedule_count: 1,
  cancel_count: 1,
  entries: [
    {
      session_id: FAKE_LESSON_ID,
      tutor_id: FAKE_TUTOR_ID,
      tutor_name: TUTOR_NAME_MARKER,
      learner_id: FAKE_LEARNER_ID,
      learner_name: LEARNER_NAME_MARKER,
      subjects: ['Math'],
      old_start: '2026-06-02T20:00:00Z',
      old_end: '2026-06-02T21:00:00Z',
      action: 'reschedule',
      new_start: '2026-06-02T21:00:00Z',
      new_end: '2026-06-02T22:00:00Z',
      reason: 'outside the new window',
    },
    {
      session_id: '0f1e2d3c-4b5a-4968-8776-655443322110',
      tutor_id: FAKE_TUTOR_ID,
      tutor_name: TUTOR_NAME_MARKER,
      learner_id: FAKE_LEARNER_ID,
      learner_name: LEARNER_NAME_MARKER,
      subjects: ['Science'],
      old_start: '2026-06-03T20:00:00Z',
      old_end: '2026-06-03T20:30:00Z',
      action: 'cancel',
      reason: 'no slot fits',
    },
  ],
};

// The learner's weekly schedule routes of ms-backend. Like the backend, they never check that the
// learner belongs to the caller, so the tool has to. Only the read and the preview exist here: any
// other weekly-schedule route answers 404, so a call to the saving route would show up as a failure.
export type WeeklySaveOutcome =
  'success' | 'timeout' | { status: number; text: string };

export class FakeWeekly {
  /** What the schedule read returns until a save; a test can replace it. */
  schedule: (learnerId: string) => unknown = fakeWeeklySchedule;
  /** How the save answers: success, a timeout, or a status with the error text it would carry. */
  putOutcome: WeeklySaveOutcome = 'success';
  /** When true, a save that answers with a failure or a timeout has still been saved. */
  putSavedDespiteFailure = false;
  /** When false, a successful save leaves the schedule as it was, as if it had not stuck. */
  applyPut = true;
  /** The body of every save request, in order. */
  readonly putBodies: unknown[] = [];
  private readonly saved = new Map<string, unknown>();
  /** What the preview returns; a test can replace it. */
  preview: unknown = {
    total_scanned: 0,
    affected_count: 0,
    reschedule_count: 0,
    cancel_count: 0,
    entries: null,
  };
  /** The body of every preview request, in order. */
  readonly previewBodies: unknown[] = [];

  handle(
    request: FakeRequest,
    url: URL,
    tokenIsValid: boolean,
  ): FakeReply | undefined {
    const route = `${request.method} ${url.pathname}`;
    const read = /^GET \/api\/v1\/learners\/([^/]+)\/weekly-schedule-v2$/.exec(
      route,
    );
    const preview =
      /^POST \/api\/v1\/learners\/([^/]+)\/weekly-schedule-v2\/preview$/.exec(
        route,
      );
    const save = /^PUT \/api\/v1\/learners\/([^/]+)\/weekly-schedule-v2$/.exec(
      route,
    );
    if (!read && !preview && !save) return undefined;
    if (!tokenIsValid) return { status: 401, body: { error: 'unauthorized' } };
    if (read) return { status: 200, body: this.current(read[1]!) };
    if (save) return this.save(save[1]!, request.body);
    this.previewBodies.push(request.body);
    return { status: 200, body: this.preview };
  }

  /** The schedule the read returns now: the last save, or the starting one. */
  current(learnerId: string): unknown {
    return this.saved.get(learnerId) ?? this.schedule(learnerId);
  }

  /** Puts the schedule back as it started and forgets every request. */
  reset(): void {
    this.saved.clear();
    this.putBodies.length = 0;
    this.previewBodies.length = 0;
    this.putOutcome = 'success';
    this.putSavedDespiteFailure = false;
    this.applyPut = true;
  }

  // The save. The backend marks windows and preferences left out of the body inactive and the read
  // returns active ones only, so the saved schedule is exactly the body.
  private save(learnerId: string, body: unknown): FakeReply {
    this.putBodies.push(body);
    const outcome = this.putOutcome;
    if (outcome !== 'success') {
      if (this.putSavedDespiteFailure) this.apply(learnerId, body);
      if (outcome === 'timeout') return { status: 0, neverRespond: true };
      return { status: outcome.status, body: { error: outcome.text } };
    }
    if (this.applyPut) this.apply(learnerId, body);
    return { status: 200, body: this.current(learnerId) };
  }

  private apply(learnerId: string, body: unknown): void {
    const sent = body as {
      windows?: Record<string, unknown>[];
      subjectPreferences?: Record<string, unknown>[];
    };
    const before = this.current(learnerId) as {
      subjectPreferences?: { learnerSubjectId: string; subject: string }[];
    };
    let made = 0;
    this.saved.set(learnerId, {
      learnerId,
      windows: (sent.windows ?? []).map((window) => ({
        ...window,
        id: window.id ?? `a1b2c3d4-9000-4222-8333-44445555000${(made += 1)}`,
        status: window.status ?? 'active',
      })),
      subjectPreferences: (sent.subjectPreferences ?? []).map((preference) => ({
        ...preference,
        id: preference.id ?? 'b1b2c3d4-9000-4222-8333-444455556666',
        status: preference.status ?? 'active',
        subject:
          before.subjectPreferences?.find(
            (old) => old.learnerSubjectId === preference.learnerSubjectId,
          )?.subject ?? 'Math',
      })),
    });
  }
}

// A preview with every kind of action, to prove a tool treats anything that is not clearly
// "unchanged" as a possible change and drops none of them. Today the backend sends only
// "reschedule" for a learner's own save; the others are here because the tool must not rely on that.
export const fakeWeeklyPreviewWithActions = {
  total_scanned: 6,
  affected_count: 5,
  reschedule_count: 1,
  cancel_count: 0,
  entries: [
    'reschedule',
    'cancel',
    'unchanged',
    'unmatch',
    'something-new',
  ].map((action, index) => ({
    session_id: `0f1e2d3c-4b5a-4968-8776-65544332211${index}`,
    tutor_id: FAKE_TUTOR_ID,
    tutor_name: TUTOR_NAME_MARKER,
    learner_id: FAKE_LEARNER_ID,
    learner_name: LEARNER_NAME_MARKER,
    subjects: ['Math'],
    old_start: `2026-06-0${index + 1}T20:00:00Z`,
    old_end: `2026-06-0${index + 1}T21:00:00Z`,
    action,
    ...(action === 'reschedule'
      ? {
          new_start: '2026-06-09T20:00:00Z',
          new_end: '2026-06-09T21:00:00Z',
        }
      : {}),
    reason: `why-${action}`,
  })),
};
