import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { assertLearnerInHousehold } from '@/external/mssuize/household-api.js';
import {
  fetchWeeklySchedule,
  previewWeeklySchedule,
  schedulingRoles,
  weekdayName,
  type WeeklyPreview,
  type WeeklyPreviewRequest,
  type WeeklyPreviewWindow,
  type WeeklySchedule,
} from '@/external/mssuize/scheduling-api.js';
import { updateWeeklySchedule } from '@/external/mssuize/weekly-update-api.js';
import { ToolError, type ToolContext } from '../define-tool.js';
import { householdClock, windowLocal } from '../local-time.js';
import {
  preferenceOutput,
  windowOutput,
} from '../learner-weekly-schedule-get/handler.js';
import {
  loadWeeklyPreview,
  previewEntriesOutput,
} from '../learner-weekly-schedule-preview/handler.js';
import type {
  learnerWeeklyScheduleUpdateInputSchema,
  learnerWeeklyScheduleUpdateOutputSchema,
} from './schemas.js';

type Input = z.output<typeof learnerWeeklyScheduleUpdateInputSchema>;
type Output = z.input<typeof learnerWeeklyScheduleUpdateOutputSchema>;

const INCOMPLETE = 'The proposal is missing a field.';
const CHANGED =
  'Things changed since the proposal. Make a new proposal and ask the parent again.';

// Fixed, and always shown: the backend's preview is not a promise. For a learner's own save it
// only ever lists lessons it would MOVE, and it leaves out lessons it would keep where they are.
const WARNING =
  "The backend's preview may not list every lesson that could be moved or cancelled, and cancelled lessons cannot be restored with these tools, so tell the parent this in plain words and get an explicit yes before confirming.";

// On every result of a confirm that reached the backend.
const LESSONS_SEPARATELY =
  "The backend adjusts the learner's upcoming lessons separately, and the family and the tutor may be told about moved lessons. Check the lessons with learner_sessions_list.";

// Only when the save was sent and then timed out, failed on the network or got a 5xx: the backend
// may have saved it, and may have moved lessons, before it failed.
const UNKNOWN_OUTCOME =
  'The result is unknown: the schedule may or may not have been saved, and lessons may or may not have been moved. Do not try the save again. Call learner_weekly_schedule_get to see the saved schedule first, then learner_sessions_list to check the lessons, before telling the parent anything.';
const UNCONFIRMED = `The backend accepted the save, but the schedule it now shows does not match what was proposed. Call learner_weekly_schedule_get and learner_sessions_list to see the real schedule and lessons before telling the parent anything. ${LESSONS_SEPARATELY}`;

type WindowLike = Pick<
  WeeklyPreviewWindow,
  'dayOfWeek' | 'startTime' | 'endTime'
> &
  Partial<WeeklyPreviewWindow>;

type WindowView = NonNullable<Output['newWindows']>[number];

function windowView(window: WindowLike): WindowView {
  return {
    ...(window.id ? { windowId: window.id } : {}),
    dayOfWeek: window.dayOfWeek,
    dayName: weekdayName(window.dayOfWeek),
    startTime: window.startTime,
    endTime: window.endTime,
    timezone: window.timezone ?? null,
    status: window.status ?? 'active',
    whenLocal: windowLocal(window),
    ...(window.extraStartTime && window.extraEndTime
      ? {
          extraStartTime: window.extraStartTime,
          extraEndTime: window.extraEndTime,
        }
      : {}),
  };
}

// A stable text for any value: keys sorted, and a missing field the same as a null one.
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, field]) => field !== null && field !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, field]) => `${JSON.stringify(key)}:${stable(field)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

// The learner's schedule as one comparable string, whatever order the backend listed it in.
export function scheduleKey(schedule: WeeklySchedule): string {
  const byId = <T extends { id: string }>(
    items: readonly T[] | null | undefined,
  ) => [...(items ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1));
  return stable({
    windows: byId(schedule.windows),
    subjectPreferences: byId(schedule.subjectPreferences),
  });
}

// A short summary of what the backend's preview says would happen to lessons. Only the lessons,
// their old and new times and the action count; the free text and the names do not.
export function previewFingerprint(preview: WeeklyPreview): string {
  const entries = (preview.entries ?? [])
    .map((entry) => [
      entry.session_id,
      entry.action,
      entry.old_start,
      entry.old_end,
      entry.new_start ?? null,
      entry.new_end ?? null,
    ])
    .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1));
  return createHash('sha256')
    .update(
      stable([
        preview.affected_count,
        preview.reschedule_count,
        preview.cancel_count,
        entries,
      ]),
    )
    .digest('hex');
}

// Whether the saved schedule is what was sent: the same windows (day, times, and timezone when one
// was sent) and the same subject preferences.
export function savedMatches(
  saved: WeeklySchedule,
  sent: WeeklyPreviewRequest,
): boolean {
  const windows = [...(saved.windows ?? [])];
  if (windows.length !== sent.windows.length) return false;
  for (const wanted of sent.windows) {
    const at = windows.findIndex(
      (window) =>
        window.dayOfWeek === wanted.dayOfWeek &&
        window.startTime === wanted.startTime &&
        window.endTime === wanted.endTime &&
        (wanted.timezone === undefined || window.timezone === wanted.timezone),
    );
    if (at < 0) return false;
    windows.splice(at, 1);
  }

  const preferences = saved.subjectPreferences ?? [];
  if (preferences.length !== sent.subjectPreferences.length) return false;
  return sent.subjectPreferences.every((wanted) =>
    preferences.some(
      (preference) =>
        preference.learnerSubjectId === wanted.learnerSubjectId &&
        preference.preferredDuration === wanted.preferredDuration &&
        preference.sessionsPerWeek === wanted.sessionsPerWeek,
    ),
  );
}

// Nothing is changed here. It previews the new windows exactly as learner_weekly_schedule_preview
// does, then remembers the request, the current schedule and the preview for confirmation.
async function propose(input: Input, context: ToolContext): Promise<Output> {
  const { sessionId, learnerId, windows, reason } = input;
  if (
    learnerId === undefined ||
    windows === undefined ||
    reason === undefined
  ) {
    throw new ToolError(INCOMPLETE);
  }

  const { current, request, preview } = await loadWeeklyPreview(
    context,
    sessionId,
    learnerId,
    windows,
  );
  const clock = await householdClock(context, sessionId);
  const { confirmationToken, expiresInSeconds } =
    context.sessions.createProposal(sessionId, {
      action: 'weekly_update',
      learnerId,
      reason,
      request,
      current,
      previewFingerprint: previewFingerprint(preview),
    });
  return {
    status: 'proposed',
    confirmationToken,
    learnerId,
    timezone: clock.timezone,
    currentWindows: (current.windows ?? []).map(windowOutput),
    newWindows: request.windows.map(windowView),
    affectedLessons: previewEntriesOutput(preview, clock),
    previewIsIncomplete: true,
    warning: WARNING,
    expiresInSeconds,
  };
}

// Sends exactly one save. The token is used up first, and before anything is sent the schedule
// and the preview are checked again: if either is not what the parent was shown, nothing is sent.
async function confirm(input: Input, context: ToolContext): Promise<Output> {
  const { backend, sessions } = context;
  const { sessionId, confirmationToken } = input;
  if (confirmationToken === undefined) throw new ToolError(INCOMPLETE);
  const proposal = sessions.takeProposal(
    sessionId,
    confirmationToken,
    'weekly_update',
  );
  const { learnerId } = proposal;

  await sessions.withHousehold(sessionId, async (accessToken, householdId) => {
    await assertLearnerInHousehold(
      backend,
      accessToken,
      householdId,
      learnerId,
    );
    const current = await fetchWeeklySchedule(backend, accessToken, learnerId);
    if (scheduleKey(current) !== scheduleKey(proposal.current)) {
      throw new ToolError(CHANGED);
    }
    const preview = await previewWeeklySchedule(
      backend,
      accessToken,
      learnerId,
      proposal.request,
    );
    if (previewFingerprint(preview) !== proposal.previewFingerprint) {
      throw new ToolError(CHANGED);
    }
  });

  // After a 401 only, the session service refreshes the token and sends it once more.
  const sent = await sessions.sendWrite(sessionId, (accessToken) =>
    updateWeeklySchedule(backend, accessToken, learnerId, proposal.request),
  );
  // It was sent but the backend may have saved it before it failed, so the result is unknown.
  if (sent.status === 'unknown') throw new ToolError(UNKNOWN_OUTCOME);

  const unconfirmed: Output = {
    status: 'unconfirmed',
    learnerId,
    message: UNCONFIRMED,
  };
  try {
    const saved = await sessions.withAccessToken(sessionId, (accessToken) =>
      fetchWeeklySchedule(backend, accessToken, learnerId),
    );
    if (!savedMatches(saved, proposal.request)) return unconfirmed;
    return {
      status: 'updated',
      learnerId,
      windows: (saved.windows ?? []).map(windowOutput),
      previousWindows: (proposal.current.windows ?? []).map(windowOutput),
      subjectPreferences: (saved.subjectPreferences ?? []).map(
        preferenceOutput,
      ),
      message: LESSONS_SEPARATELY,
    };
  } catch {
    // The save was accepted, so a failed read-back is not a failed save.
    return unconfirmed;
  }
}

export async function learnerWeeklyScheduleUpdateHandler(
  input: Input,
  context: ToolContext,
): Promise<Output> {
  context.sessions.assertRole(input.sessionId, schedulingRoles);
  return input.step === 'propose'
    ? propose(input, context)
    : confirm(input, context);
}
