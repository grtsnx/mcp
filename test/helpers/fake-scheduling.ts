import type { FakeRequest } from './fake-mssuize.js';

interface FakeReply {
  status: number;
  body?: unknown;
  /** The backend never answers, so the caller times out. */
  neverRespond?: boolean;
}

import {
  FAKE_LEARNER_ID,
  FAKE_OTHER_LEARNER_ID,
  FAKE_OTHER_LESSON_ID,
  FAKE_TUTOR_ID,
  fakeLessons,
  knownLessons,
  lessonDetail,
} from './fake-lessons-data.js';

export * from './fake-lessons-data.js';

const OFFSETS: Record<string, { text: string; minutes: number }> = {
  'America/New_York': { text: '-04:00', minutes: -240 },
  'Africa/Lagos': { text: '+01:00', minutes: 60 },
};

function isRealDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  return new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}

function isTimeZone(value: string): boolean {
  if (!/^[A-Z][A-Za-z0-9_+-]*(?:\/[A-Z][A-Za-z0-9_+-]*)*$/.test(value)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function atOffset(utc: string, offset: { text: string; minutes: number }) {
  const shifted = new Date(Date.parse(utc) + offset.minutes * 60_000);
  return `${shifted.toISOString().slice(0, 19)}${offset.text}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export type RescheduleOutcome =
  'success' | 'timeout' | { status: number; text: string };

// The scheduling routes of ms-backend, as the dev backend behaves.
export class FakeScheduling {
  /** What the learner list returns; a test can replace it. */
  lessons: unknown[] = fakeLessons;
  /** What an unknown lesson id answers; the real backend answers 500, not 404. */
  unknownLessonStatus = 404;
  /** When true, every scheduling route answers 403, as for a person the backend turns away. */
  forbidden = false;
  /** What a preview reports as duration_minutes; 0 makes the tool compute it from the times. */
  previewDurationMinutes = 60;
  /** How the move answers: success, a timeout, or a status with the error text it would carry. */
  rescheduleOutcome: RescheduleOutcome = 'success';
  /** When false, a successful move leaves the lesson's time unchanged, as if it had not stuck. */
  applyReschedule = true;
  /** How the cancel answers: success, a timeout, or a status with the error text it would carry. */
  cancelOutcome: RescheduleOutcome = 'success';
  /** When true, a cancel that answers with a failure or a timeout has still been saved. */
  cancelSavedDespiteFailure = false;
  /** When true, the lesson detail leaves the tutor id out, as a lesson with no tutor would. */
  omitTutorId = false;
  /** When false, a successful cancel leaves the lesson scheduled, as if it had not stuck. */
  applyCancel = true;

  private readonly cancelled = new Set<string>();
  private readonly moved = new Map<string, { start: string; end: string }>();

  constructor(private readonly householdId: string) {}

  /** Puts every lesson back as it started: not cancelled, not moved. */
  resetLessons(): void {
    this.cancelled.clear();
    this.moved.clear();
  }

  /** The status the backend would now report for a lesson. */
  statusOf(lessonId: string): string {
    if (this.cancelled.has(lessonId)) return 'cancelled';
    return knownLessons.find((lesson) => lesson.id === lessonId)!.status;
  }

  /** The start and end the backend would now report for a lesson. */
  timesOf(lessonId: string): { start: string; end: string } {
    const known = knownLessons.find((lesson) => lesson.id === lessonId)!;
    return (
      this.moved.get(lessonId) ?? {
        start: known.scheduledStart,
        end: known.scheduledEnd,
      }
    );
  }

  handle(
    request: FakeRequest,
    url: URL,
    tokenIsValid: boolean,
  ): FakeReply | undefined {
    const route = `${request.method} ${url.pathname}`;
    const list =
      /^GET \/api\/v1\/households\/([^/]+)\/learners\/([^/]+)\/scheduled-sessions$/.exec(
        route,
      );
    const householdList = /^GET \/api\/v1\/households\/([^/]+)\/sessions$/.exec(
      route,
    );
    const detail = /^GET \/api\/v1\/sessions\/([^/]+)$/.exec(route);
    const preview =
      /^POST \/api\/v1\/sessions\/([^/]+)\/reschedule-preview$/.exec(route);
    const week =
      /^GET \/api\/v1\/sessions\/([^/]+)\/reschedule-week-preview$/.exec(route);
    const move = /^POST \/api\/v1\/sessions\/([^/]+)\/reschedule$/.exec(route);
    const cancel = /^POST \/api\/v1\/sessions\/([^/]+)\/cancel$/.exec(route);
    if (
      !list &&
      !householdList &&
      !detail &&
      !preview &&
      !week &&
      !move &&
      !cancel
    ) {
      return undefined;
    }

    if (!tokenIsValid) return { status: 401, body: { error: 'unauthorized' } };
    if (this.forbidden)
      return { status: 403, body: { error: 'access denied' } };
    if (list) return this.list(list[1]!, list[2]!, url);
    if (householdList) return this.householdList(householdList[1]!, url);
    if (detail) return this.detail(detail[1]!);
    if (week) return this.week(week[1]!, url);
    if (move) return this.reschedule(move[1]!, request.body);
    if (cancel) return this.cancel(cancel[1]!);
    return this.preview(preview![1]!, request.body);
  }

  private filtered(url: URL) {
    const params = url.searchParams;
    let lessons = this.lessons as { status: string; scheduledStart: string }[];
    const status = params.get('status');
    if (status) lessons = lessons.filter((lesson) => lesson.status === status);
    // Like the backend: a date it cannot parse is ignored, not an error.
    const after = Date.parse(params.get('start_after') ?? '');
    const before = Date.parse(params.get('start_before') ?? '');
    if (!Number.isNaN(after)) {
      lessons = lessons.filter(
        (lesson) => Date.parse(lesson.scheduledStart) > after,
      );
    }
    if (!Number.isNaN(before)) {
      lessons = lessons.filter(
        (lesson) => Date.parse(lesson.scheduledStart) < before,
      );
    }
    const page = Number(params.get('page') ?? 0);
    const pageSize = Number(
      params.get('page_size') ?? params.get('pageSize') ?? 20,
    );
    return { lessons, page, pageSize };
  }

  private list(householdId: string, learnerId: string, url: URL): FakeReply {
    if (
      householdId !== this.householdId ||
      learnerId === FAKE_OTHER_LEARNER_ID
    ) {
      return { status: 403, body: { error: 'access denied' } };
    }
    if (learnerId !== FAKE_LEARNER_ID) {
      return { status: 404, body: { error: 'learner not found' } };
    }
    const { lessons, page, pageSize } = this.filtered(url);
    const slice = lessons.slice(page * pageSize, (page + 1) * pageSize);
    return {
      status: 200,
      // Go sends null, not [], for an empty list.
      body: {
        sessions: slice.length > 0 ? slice : null,
        totalCount: lessons.length,
        page,
        pageSize,
      },
    };
  }

  // The household list has no tutor or learner names, and a made-up status makes it answer 500.
  private householdList(householdId: string, url: URL): FakeReply {
    if (householdId !== this.householdId) {
      return { status: 403, body: { error: 'access denied' } };
    }
    const status = url.searchParams.get('status');
    if (
      status &&
      ![
        'scheduled',
        'in_progress',
        'completed',
        'cancelled',
        'no_show',
      ].includes(status)
    ) {
      return { status: 500, body: { error: 'failed to list sessions' } };
    }
    const { lessons, page, pageSize } = this.filtered(url);
    const slice = lessons.slice(page * pageSize, (page + 1) * pageSize);
    const items = (slice as Record<string, unknown>[]).map((lesson) => ({
      id: lesson.id,
      tutorId: FAKE_TUTOR_ID,
      learnerId: lesson.learnerId,
      subjects: lesson.subjects,
      scheduledStart: lesson.scheduledStart,
      scheduledEnd: lesson.scheduledEnd,
      durationMinutes: 0,
      status: lesson.status,
      meetingProvider: 'zoom',
      recordingPreference: 'always',
      canReschedule: lesson.canReschedule,
      canCancel: lesson.canCancel,
      videoProvider: 'zoom',
    }));
    return {
      status: 200,
      body: {
        sessions: items.length > 0 ? items : null,
        totalCount: lessons.length,
        page,
        pageSize,
      },
    };
  }

  private lessonOrError(lessonId: string): FakeReply | undefined {
    if (lessonId === FAKE_OTHER_LESSON_ID) {
      return { status: 403, body: { error: 'access denied' } };
    }
    if (!knownLessons.some((lesson) => lesson.id === lessonId)) {
      return {
        status: this.unknownLessonStatus,
        body: { error: 'session not found' },
      };
    }
    return undefined;
  }

  private detail(lessonId: string): FakeReply {
    const refusal = this.lessonOrError(lessonId);
    if (refusal) return refusal;
    const body = lessonDetail(
      lessonId,
      this.timesOf(lessonId),
      this.statusOf(lessonId),
    );
    if (this.omitTutorId) delete (body.session as { tutorId?: string }).tutorId;
    return { status: 200, body };
  }

  // A lesson that is not scheduled, or is too close to its start, cannot be previewed or moved.
  private cannotMove(lessonId: string): boolean {
    const lesson = knownLessons.find((item) => item.id === lessonId)!;
    return lesson.status !== 'scheduled' || !lesson.canReschedule;
  }

  private zoneOffset(zone: string) {
    return OFFSETS[zone] ?? { text: '+00:00', minutes: 0 };
  }

  private preview(lessonId: string, body: unknown): FakeReply {
    const refusal = this.lessonOrError(lessonId);
    if (refusal) return refusal;
    if (this.cannotMove(lessonId)) {
      return { status: 400, body: { error: 'cannot reschedule this session' } };
    }
    const { target_date: targetDate, timezone } = (body ?? {}) as {
      target_date?: unknown;
      timezone?: string;
    };
    if (!isRealDate(targetDate)) {
      return { status: 400, body: { error: 'invalid target date' } };
    }
    if (timezone !== undefined && !isTimeZone(timezone)) {
      return { status: 400, body: { error: 'invalid timezone' } };
    }
    // Without a timezone the family's own zone is used.
    const zone = timezone ?? 'America/New_York';
    const offset = this.zoneOffset(zone);
    const current = this.timesOf(lessonId);
    const hourAt = (hour: number) =>
      `${targetDate}T${pad(hour)}:00:00${offset.text}`;
    const slots = [10, 15].map((hour) => ({
      start: hourAt(hour),
      end: hourAt(hour + 1),
    }));
    return {
      status: 200,
      body: {
        session_id: lessonId,
        tutor_id: FAKE_TUTOR_ID,
        tutor_name: 'Grace Hopper',
        learner_id: FAKE_LEARNER_ID,
        learner_name: 'Byron Lovelace',
        target_date: targetDate,
        timezone: zone,
        duration_minutes: this.previewDurationMinutes,
        current_start: atOffset(current.start, offset),
        current_end: atOffset(current.end, offset),
        slots,
        count: slots.length,
      },
    };
  }

  // Six days, today left out: the dates here are fixed so tests can name them.
  private week(lessonId: string, url: URL): FakeReply {
    const refusal = this.lessonOrError(lessonId);
    if (refusal) return refusal;
    if (this.cannotMove(lessonId)) {
      return { status: 400, body: { error: 'cannot reschedule this session' } };
    }
    const timezone = url.searchParams.get('timezone') ?? undefined;
    if (timezone !== undefined && !isTimeZone(timezone)) {
      return { status: 400, body: { error: 'invalid timezone' } };
    }
    const zone = timezone ?? 'America/New_York';
    const offset = this.zoneOffset(zone);
    const current = this.timesOf(lessonId);
    const days = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 5, 2 + index))
        .toISOString()
        .slice(0, 10);
      const hourAt = (hour: number) =>
        `${date}T${pad(hour)}:00:00${offset.text}`;
      const slots = [10, 15].map((hour) => ({
        start: hourAt(hour),
        end: hourAt(hour + 1),
      }));
      return { date, slots, count: slots.length };
    });
    return {
      status: 200,
      body: {
        session_id: lessonId,
        tutor_id: FAKE_TUTOR_ID,
        tutor_name: 'Grace Hopper',
        learner_id: FAKE_LEARNER_ID,
        learner_name: 'Byron Lovelace',
        timezone: zone,
        duration_minutes: this.previewDurationMinutes,
        current_start: atOffset(current.start, offset),
        current_end: atOffset(current.end, offset),
        days,
        total_slots: days.length * 2,
      },
    };
  }

  // The move. Its outcome is whatever the test set; a success changes the lesson's time.
  private reschedule(lessonId: string, body: unknown): FakeReply {
    const refusal = this.lessonOrError(lessonId);
    if (refusal) return refusal;
    const outcome = this.rescheduleOutcome;
    if (outcome === 'timeout') return { status: 0, neverRespond: true };
    if (outcome !== 'success') {
      return { status: outcome.status, body: { error: outcome.text } };
    }
    const move = (body ?? {}) as { new_start?: unknown; new_end?: unknown };
    if (
      this.applyReschedule &&
      typeof move.new_start === 'string' &&
      typeof move.new_end === 'string'
    ) {
      const asUtc = (value: string) =>
        new Date(value).toISOString().replace('.000Z', 'Z');
      this.moved.set(lessonId, {
        start: asUtc(move.new_start),
        end: asUtc(move.new_end),
      });
    }
    return {
      status: 200,
      body: { message: 'session rescheduled successfully' },
    };
  }

  // The cancel. Like the backend: 403 for a lesson that is not the caller's, and 500 for every
  // other failure, including a lesson that is not scheduled.
  private cancel(lessonId: string): FakeReply {
    const refusal = this.lessonOrError(lessonId);
    if (refusal) return refusal;
    const outcome = this.cancelOutcome;
    if (outcome !== 'success') {
      if (this.cancelSavedDespiteFailure) this.cancelled.add(lessonId);
      if (outcome === 'timeout') return { status: 0, neverRespond: true };
      return { status: outcome.status, body: { error: outcome.text } };
    }
    if (this.statusOf(lessonId) !== 'scheduled') {
      return { status: 500, body: { error: 'failed to cancel session' } };
    }
    if (this.applyCancel) this.cancelled.add(lessonId);
    return {
      status: 200,
      body: { message: 'session cancelled successfully' },
    };
  }
}
