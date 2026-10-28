import type { z } from 'zod';
import { assertLearnerInHousehold } from '@/external/mssuize/household-api.js';
import {
  fetchWeeklySchedule,
  previewWeeklySchedule,
  schedulingRoles,
  type WeeklyPreview,
  type WeeklyPreviewRequest,
  type WeeklyPreviewWindow,
  type WeeklySchedule,
} from '@/external/mssuize/scheduling-api.js';
import { ToolError, type ToolContext } from '../define-tool.js';
import { householdClock, type LocalClock } from '../local-time.js';
import type {
  learnerWeeklySchedulePreviewInputSchema,
  learnerWeeklySchedulePreviewOutputSchema,
} from './schemas.js';

type Input = z.output<typeof learnerWeeklySchedulePreviewInputSchema>;
type Output = z.input<typeof learnerWeeklySchedulePreviewOutputSchema>;
export type WindowEdit = Input['windows'][number];

const UNKNOWN_WINDOW =
  "That windowId is not one of this learner's current windows. Use the windowId values from learner_weekly_schedule_get, or leave windowId out for a new window.";

// The backend wants a date as an RFC 3339 timestamp, but sends it as YYYY-MM-DD.
function asTimestamp(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00Z` : date;
}

// The new schedule, as the full set the backend expects. A window the model keeps by windowId
// carries over everything the tool cannot change (extra range, status, dates, notes), so keeping
// a window as it is really is no change. A new window has only what the model gave. The learner's
// current subject preferences go back exactly as they are.
export function buildWeeklyPreviewRequest(
  current: WeeklySchedule,
  edits: readonly WindowEdit[],
): WeeklyPreviewRequest {
  const currentWindows = current.windows ?? [];
  const byId = new Map(
    currentWindows.map((window) => [window.id.toLowerCase(), window]),
  );
  // A new window with no time zone of its own takes the learner's, when they all share one.
  const zones = new Set(
    currentWindows.flatMap((window) =>
      window.timezone ? [window.timezone] : [],
    ),
  );
  const sharedZone = zones.size === 1 ? [...zones][0] : undefined;

  const windows = edits.map((edit): WeeklyPreviewWindow => {
    const kept =
      edit.windowId === undefined
        ? undefined
        : byId.get(edit.windowId.toLowerCase());
    if (edit.windowId !== undefined && kept === undefined) {
      throw new ToolError(UNKNOWN_WINDOW);
    }
    const timezone = edit.timezone ?? kept?.timezone ?? sharedZone ?? undefined;
    return {
      ...(kept ? { id: kept.id } : {}),
      dayOfWeek: edit.dayOfWeek,
      startTime: `${edit.startTime}:00`,
      endTime: `${edit.endTime}:00`,
      ...(timezone ? { timezone } : {}),
      ...(kept?.extraStartTime && kept.extraEndTime
        ? {
            extraStartTime: kept.extraStartTime,
            extraEndTime: kept.extraEndTime,
          }
        : {}),
      ...(kept ? { status: kept.status } : {}),
      ...(kept?.effectiveFrom
        ? { effectiveFrom: asTimestamp(kept.effectiveFrom) }
        : {}),
      ...(kept?.effectiveTo
        ? { effectiveTo: asTimestamp(kept.effectiveTo) }
        : {}),
      ...(kept?.notes ? { notes: kept.notes } : {}),
    };
  });

  const subjectPreferences = (current.subjectPreferences ?? []).map(
    (preference) => ({
      id: preference.id,
      learnerSubjectId: preference.learnerSubjectId,
      ...(preference.preferredSubject
        ? { preferredSubject: preference.preferredSubject }
        : {}),
      preferredDuration: preference.preferredDuration,
      sessionsPerWeek: preference.sessionsPerWeek,
      status: preference.status,
      ...(preference.notes ? { notes: preference.notes } : {}),
    }),
  );

  return { windows, subjectPreferences };
}

export interface WeeklyPreviewResult {
  current: WeeklySchedule;
  request: WeeklyPreviewRequest;
  preview: WeeklyPreview;
}

// The ownership check, the current schedule and the backend's preview for the new windows, in
// that order. All reads or the preview, which saves nothing, so a retry after a 401 repeats
// nothing that matters. learner_weekly_schedule_update uses this too, so it can never preview
// anything different from what this tool shows.
export function loadWeeklyPreview(
  { backend, sessions }: ToolContext,
  sessionId: string,
  learnerId: string,
  edits: readonly WindowEdit[],
): Promise<WeeklyPreviewResult> {
  return sessions.withHousehold(sessionId, async (accessToken, householdId) => {
    // The backend does not check that this learner is the caller's, so it is checked first.
    await assertLearnerInHousehold(
      backend,
      accessToken,
      householdId,
      learnerId,
    );
    const current = await fetchWeeklySchedule(backend, accessToken, learnerId);
    const request = buildWeeklyPreviewRequest(current, edits);
    const preview = await previewWeeklySchedule(
      backend,
      accessToken,
      learnerId,
      request,
    );
    return { current, request, preview };
  });
}

// Lessons are instants, so they are written in the family's zone, not in any window's own zone.
export function previewEntriesOutput(
  preview: WeeklyPreview,
  clock: LocalClock,
): Output['entries'] {
  return (preview.entries ?? []).map((entry) => ({
    lessonId: entry.session_id,
    subjects: entry.subjects ?? [],
    oldStart: entry.old_start,
    oldEnd: entry.old_end,
    oldWhenLocal: clock.between(entry.old_start, entry.old_end),
    action: entry.action,
    ...(entry.new_start ? { newStart: entry.new_start } : {}),
    ...(entry.new_end ? { newEnd: entry.new_end } : {}),
    ...(entry.new_start && entry.new_end
      ? { newWhenLocal: clock.between(entry.new_start, entry.new_end) }
      : {}),
    reason: entry.reason ?? null,
  }));
}

export async function learnerWeeklySchedulePreviewHandler(
  input: Input,
  context: ToolContext,
): Promise<Output> {
  context.sessions.assertRole(input.sessionId, schedulingRoles);
  const { preview } = await loadWeeklyPreview(
    context,
    input.sessionId,
    input.learnerId,
    input.windows,
  );
  const clock = await householdClock(context, input.sessionId);
  return {
    learnerId: input.learnerId,
    timezone: clock.timezone,
    totalScanned: preview.total_scanned,
    affectedCount: preview.affected_count,
    rescheduleCount: preview.reschedule_count,
    cancelCount: preview.cancel_count,
    entries: previewEntriesOutput(preview, clock),
  };
}
