import { z } from 'zod';
import { bearerHeader } from './auth-api.js';
import type { BackendApi, BackendErrorPhrase } from './backend-client.js';
import { BackendError } from './backend-error.js';

// The roles ms-backend allows on the guardian-facing scheduling routes.
export const schedulingRoles = ['guardian', 'delegate', 'admin'] as const;

export const lessonStatuses = [
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
] as const;

export type LessonStatus = (typeof lessonStatuses)[number];

// Only the fields the scheduling tools return are listed. Zod drops everything else the backend
// sends (signed photo links, the tutor's email and ids, event payloads, video and meeting fields)
// when the reply is parsed, so it never reaches a tool. Go sends null for an empty list, so every
// array is nullish.

const lessonListItemSchema = z.object({
  id: z.string(),
  tutorName: z.string().nullish(),
  learnerName: z.string().nullish(),
  subjects: z.array(z.string()).nullish(),
  scheduledStart: z.string(),
  scheduledEnd: z.string(),
  status: z.string(),
  canReschedule: z.boolean().nullish(),
  canCancel: z.boolean().nullish(),
});

export type LessonListItem = z.infer<typeof lessonListItemSchema>;

const lessonListSchema = z.object({
  sessions: z.array(lessonListItemSchema).nullish(),
  totalCount: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export type LessonList = z.infer<typeof lessonListSchema>;

const personNameSchema = z
  .object({
    first_name: z.string().nullish(),
    last_name: z.string().nullish(),
  })
  .nullish();

const lessonDetailSchema = z.object({
  session: z.object({
    id: z.string(),
    // Read only so a tutor-change request can name the tutor; no tool returns it.
    tutorId: z.string().nullish(),
    learnerId: z.string(),
    subjects: z.array(z.string()).nullish(),
    scheduledStart: z.string(),
    scheduledEnd: z.string(),
    status: z.string(),
    canReschedule: z.boolean().nullish(),
    canCancel: z.boolean().nullish(),
  }),
  tutor: personNameSchema,
  learner: personNameSchema,
  events: z
    .array(
      z.object({
        event_type: z.string(),
        occurred_at: z.string(),
        actor_role: z.string().nullish(),
      }),
    )
    .nullish(),
});

export type LessonDetail = z.infer<typeof lessonDetailSchema>;

const reschedulePreviewSchema = z.object({
  session_id: z.string(),
  target_date: z.string(),
  timezone: z.string(),
  duration_minutes: z.number(),
  current_start: z.string(),
  current_end: z.string(),
  slots: z.array(z.object({ start: z.string(), end: z.string() })).nullish(),
});

export type ReschedulePreview = z.infer<typeof reschedulePreviewSchema>;

const weekPreviewSchema = z.object({
  session_id: z.string(),
  timezone: z.string(),
  duration_minutes: z.number(),
  current_start: z.string(),
  current_end: z.string(),
  days: z
    .array(
      z.object({
        date: z.string(),
        slots: z
          .array(z.object({ start: z.string(), end: z.string() }))
          .nullish(),
      }),
    )
    .nullish(),
});

export type RescheduleWeekPreview = z.infer<typeof weekPreviewSchema>;

// The household list has no tutor or learner names, only ids.
const householdLessonItemSchema = z.object({
  id: z.string(),
  learnerId: z.string(),
  subjects: z.array(z.string()).nullish(),
  scheduledStart: z.string(),
  scheduledEnd: z.string(),
  status: z.string(),
  canReschedule: z.boolean().nullish(),
  canCancel: z.boolean().nullish(),
});

const householdLessonListSchema = z.object({
  sessions: z.array(householdLessonItemSchema).nullish(),
  totalCount: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export type HouseholdLessonList = z.infer<typeof householdLessonListSchema>;

const rescheduleReplySchema = z.object({ message: z.string() });

// Fragile: these match the wording of ms-backend's 400 replies for a reschedule (read in its
// RescheduleSession handler). If the backend rewords them, a 400 falls back to the generic
// "not accepted" kind. Order matters: the first phrase found wins.
export const rescheduleErrorPhrases: readonly BackendErrorPhrase[] = [
  { phrase: 'cannot reschedule', kind: 'cannot_reschedule' },
  { phrase: 'selected time slot', kind: 'slot_unavailable' },
  { phrase: 'learner availability', kind: 'outside_availability' },
];

// IANA names are Area/Location with capital letters; Intl alone would also accept "+01:00" and
// lowercase names, which the backend then refuses.
const IANA_SHAPE = /^[A-Z][A-Za-z0-9_+-]*(?:\/[A-Z][A-Za-z0-9_+-]*)*$/;

function isTimeZone(value: string): boolean {
  if (!IANA_SHAPE.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const ianaTimeZoneSchema = z
  .string()
  .max(64)
  .refine(isTimeZone, { error: 'Not a valid IANA time zone name' });

// A learner's weekly windows are RANGES the family offers (for example 16:00 to 18:00); the backend
// places lessons inside them. They are not lesson times. Only active windows and preferences come
// back. The notes, date range and preferred subject are kept so a preview can send them back
// unchanged, and are never returned by a tool.
const weeklyWindowSchema = z.object({
  id: z.string(),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string(),
  endTime: z.string(),
  extraStartTime: z.string().nullish(),
  extraEndTime: z.string().nullish(),
  timezone: z.string().nullish(),
  status: z.string(),
  effectiveFrom: z.string().nullish(),
  effectiveTo: z.string().nullish(),
  notes: z.string().nullish(),
});

const weeklyPreferenceSchema = z.object({
  id: z.string(),
  learnerSubjectId: z.string(),
  subject: z.string(),
  preferredSubject: z.string().nullish(),
  preferredDuration: z.number().int(),
  sessionsPerWeek: z.number().int(),
  status: z.string(),
  notes: z.string().nullish(),
});

export const weeklyScheduleSchema = z.object({
  learnerId: z.string(),
  windows: z.array(weeklyWindowSchema).nullish(),
  subjectPreferences: z.array(weeklyPreferenceSchema).nullish(),
});

export type WeeklySchedule = z.infer<typeof weeklyScheduleSchema>;
export type WeeklyWindow = z.infer<typeof weeklyWindowSchema>;
export type WeeklyPreference = z.infer<typeof weeklyPreferenceSchema>;

// The preview reply also names the tutor and the learner; those fields are dropped here.
const weeklyPreviewSchema = z.object({
  total_scanned: z.number().int(),
  affected_count: z.number().int(),
  reschedule_count: z.number().int(),
  cancel_count: z.number().int(),
  entries: z
    .array(
      z.object({
        session_id: z.string(),
        subjects: z.array(z.string()).nullish(),
        old_start: z.string(),
        old_end: z.string(),
        action: z.string(),
        new_start: z.string().nullish(),
        new_end: z.string().nullish(),
        reason: z.string().nullish(),
      }),
    )
    .nullish(),
});

export type WeeklyPreview = z.infer<typeof weeklyPreviewSchema>;

// The body of a weekly-schedule preview. It is the FULL new set: a window left out is removed, and
// a window without an id is new. Times are HH:MM or HH:MM:SS; dates are RFC 3339.
export interface WeeklyPreviewWindow {
  id?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  extraStartTime?: string;
  extraEndTime?: string;
  timezone?: string;
  status?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  notes?: string;
}

export interface WeeklyPreviewPreference {
  id?: string;
  learnerSubjectId: string;
  preferredSubject?: string;
  preferredDuration: number;
  sessionsPerWeek: number;
  status?: string;
  notes?: string;
}

export interface WeeklyPreviewRequest {
  windows: WeeklyPreviewWindow[];
  subjectPreferences: WeeklyPreviewPreference[];
}

const cancelReplySchema = z.object({ message: z.string() });

// dayOfWeek 0 is Sunday and 6 is Saturday. The backend matches a window by comparing
// int(localStart.Weekday()) with dayOfWeek, in the window's own time zone (Go's Sunday-first weeks).
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export function weekdayName(dayOfWeek: number): string {
  const name = WEEKDAY_NAMES[dayOfWeek];
  if (name === undefined) throw new BackendError('unexpected_response');
  return name;
}

export interface LessonListFilters {
  status?: LessonStatus;
  startAfter?: string;
  startBefore?: string;
  page?: number;
  pageSize?: number;
}

// The list's own durationMinutes is 0 even for a 60 minute class, so the length comes from the times.
export function minutesBetween(start: string, end: string): number {
  const minutes = (Date.parse(end) - Date.parse(start)) / 60_000;
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new BackendError('unexpected_response');
  }
  return Math.round(minutes);
}

function lessonFilterQuery(filters: LessonListFilters): string {
  const query = new URLSearchParams();
  if (filters.page !== undefined) query.set('page', String(filters.page));
  if (filters.pageSize !== undefined) {
    query.set('page_size', String(filters.pageSize));
  }
  if (filters.status !== undefined) query.set('status', filters.status);
  if (filters.startAfter !== undefined) {
    query.set('start_after', filters.startAfter);
  }
  if (filters.startBefore !== undefined) {
    query.set('start_before', filters.startBefore);
  }
  return query.size > 0 ? `?${query}` : '';
}

export function fetchLearnerLessons(
  backend: BackendApi,
  accessToken: string,
  householdId: string,
  learnerId: string,
  filters: LessonListFilters = {},
): Promise<LessonList> {
  return backend.request({
    method: 'GET',
    path: `/api/v1/households/${encodeURIComponent(householdId)}/learners/${encodeURIComponent(learnerId)}/scheduled-sessions${lessonFilterQuery(filters)}`,
    headers: bearerHeader(accessToken),
    response: lessonListSchema,
  });
}

// An unknown status makes this route answer 500, so callers restrict it before calling.
export function fetchHouseholdLessons(
  backend: BackendApi,
  accessToken: string,
  householdId: string,
  filters: LessonListFilters = {},
): Promise<HouseholdLessonList> {
  return backend.request({
    method: 'GET',
    path: `/api/v1/households/${encodeURIComponent(householdId)}/sessions${lessonFilterQuery(filters)}`,
    headers: bearerHeader(accessToken),
    response: householdLessonListSchema,
  });
}

export function fetchLesson(
  backend: BackendApi,
  accessToken: string,
  lessonId: string,
): Promise<LessonDetail> {
  return backend.request({
    method: 'GET',
    path: `/api/v1/sessions/${encodeURIComponent(lessonId)}`,
    headers: bearerHeader(accessToken),
    response: lessonDetailSchema,
  });
}

// A preview: the backend reads the lesson and the tutor's free times and changes nothing. Without a
// timezone the backend uses the family's own, so none is sent unless the caller gave one.
export function previewLessonReschedule(
  backend: BackendApi,
  accessToken: string,
  lessonId: string,
  options: { targetDate: string; timezone?: string },
): Promise<ReschedulePreview> {
  return backend.request({
    method: 'POST',
    path: `/api/v1/sessions/${encodeURIComponent(lessonId)}/reschedule-preview`,
    headers: bearerHeader(accessToken),
    body:
      options.timezone === undefined
        ? { target_date: options.targetDate }
        : { target_date: options.targetDate, timezone: options.timezone },
    response: reschedulePreviewSchema,
  });
}

// The next six days with today left out, as free times for moving one lesson. A read.
export function fetchRescheduleWeek(
  backend: BackendApi,
  accessToken: string,
  lessonId: string,
  timezone?: string,
): Promise<RescheduleWeekPreview> {
  const query =
    timezone === undefined ? '' : `?${new URLSearchParams({ timezone })}`;
  return backend.request({
    method: 'GET',
    path: `/api/v1/sessions/${encodeURIComponent(lessonId)}/reschedule-week-preview${query}`,
    headers: bearerHeader(accessToken),
    errorPhrases: rescheduleErrorPhrases,
    response: weekPreviewSchema,
  });
}

// A WRITE: it moves a real lesson, and the backend may notify the tutor and sync calendars. There
// is no retry key on this route, so nothing in this code may send it twice for one decision.
// The body has exactly these three fields. The backend also has a `force` field that it ignores
// for guardians; it is never sent.
export function rescheduleLesson(
  backend: BackendApi,
  accessToken: string,
  lessonId: string,
  move: { newStart: string; newEnd: string; reason: string },
): Promise<{ message: string }> {
  return backend.request({
    method: 'POST',
    path: `/api/v1/sessions/${encodeURIComponent(lessonId)}/reschedule`,
    headers: bearerHeader(accessToken),
    body: {
      new_start: move.newStart,
      new_end: move.newEnd,
      reason: move.reason,
    },
    errorPhrases: rescheduleErrorPhrases,
    response: rescheduleReplySchema,
  });
}

// The calendar date (YYYY-MM-DD) of an instant in a time zone.
export function localDateIn(instant: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(instant));
  } catch {
    throw new BackendError('unexpected_response');
  }
}

export function fetchWeeklySchedule(
  backend: BackendApi,
  accessToken: string,
  learnerId: string,
): Promise<WeeklySchedule> {
  return backend.request({
    method: 'GET',
    path: `/api/v1/learners/${encodeURIComponent(learnerId)}/weekly-schedule-v2`,
    headers: bearerHeader(accessToken),
    response: weeklyScheduleSchema,
  });
}

// A PREVIEW: the backend works out which upcoming lessons would move, and changes nothing. This
// path ends in /preview on purpose: the same path without it is the call that SAVES a schedule,
// and no tool in this service makes that call. (The backend code behind this route was read and
// makes no write; see CLAUDE.md.)
export function previewWeeklySchedule(
  backend: BackendApi,
  accessToken: string,
  learnerId: string,
  request: WeeklyPreviewRequest,
): Promise<WeeklyPreview> {
  return backend.request({
    method: 'POST',
    path: `/api/v1/learners/${encodeURIComponent(learnerId)}/weekly-schedule-v2/preview`,
    headers: bearerHeader(accessToken),
    body: request,
    response: weeklyPreviewSchema,
  });
}

// A WRITE that cannot be undone with these tools: it cancels a real lesson and the backend
// notifies the household and the tutor. The body is exactly { reason }. The backend answers 403
// for "not allowed" and 500 for EVERY other failure, so a 500 says nothing about whether it
// happened; callers read the lesson back. There is no retry key, so it is never sent twice.
export function cancelLesson(
  backend: BackendApi,
  accessToken: string,
  lessonId: string,
  cancellation: { reason: string },
): Promise<{ message: string }> {
  return backend.request({
    method: 'POST',
    path: `/api/v1/sessions/${encodeURIComponent(lessonId)}/cancel`,
    headers: bearerHeader(accessToken),
    body: { reason: cancellation.reason },
    response: cancelReplySchema,
  });
}
