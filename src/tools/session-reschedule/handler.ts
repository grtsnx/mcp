import type { z } from 'zod';
import {
  fetchLesson,
  localDateIn,
  type LessonDetail,
  minutesBetween,
  previewLessonReschedule,
  rescheduleLesson,
  schedulingRoles,
} from '@/external/mssuize/scheduling-api.js';
import { ToolError, type ToolContext } from '../define-tool.js';
import { householdClock, localClock } from '../local-time.js';
import type {
  sessionRescheduleInputSchema,
  sessionRescheduleOutputSchema,
} from './schemas.js';

type Input = z.output<typeof sessionRescheduleInputSchema>;
type Output = z.input<typeof sessionRescheduleOutputSchema>;

const NOT_SCHEDULED = 'This lesson is not scheduled, so it cannot be moved.';
const CANNOT_RESCHEDULE =
  'This lesson cannot be rescheduled (its status or timing does not allow it).';
const END_BEFORE_START = 'The end time must be after the start time.';
const NOT_OFFERED =
  'That time is not one of the offered times for that day. Use session_reschedule_options_day or session_reschedule_options_week to see the times that are available.';
const INCOMPLETE = 'The proposal is missing a field.';

// Only for a move request that was sent and then timed out, failed on the network or got a 5xx:
// the backend may have saved the new time before answering, so the outcome cannot be known.
const UNKNOWN_OUTCOME =
  "The result is unknown: the move may or may not have happened. Do not try the move again. Call session_get to see the lesson's real current time before telling the parent anything.";
const UNCONFIRMED =
  "The backend accepted the move, but the lesson does not show the new time yet. Call session_get to check the lesson's real current time before telling the parent anything.";

function sameInstant(a: string, b: string): boolean {
  return Date.parse(a) === Date.parse(b);
}

// Nothing is changed here. It checks that the move can work, then remembers it for confirmation.
async function propose(
  input: Input,
  { backend, sessions }: ToolContext,
): Promise<Output> {
  const { sessionId, lessonId, newStart, newEnd, reason } = input;
  if (
    lessonId === undefined ||
    newStart === undefined ||
    newEnd === undefined ||
    reason === undefined
  ) {
    throw new ToolError(INCOMPLETE);
  }

  const detail = await sessions.withAccessToken(sessionId, (accessToken) =>
    fetchLesson(backend, accessToken, lessonId),
  );
  const lesson = detail.session;
  if (lesson.status !== 'scheduled') throw new ToolError(NOT_SCHEDULED);
  if (lesson.canReschedule !== true) throw new ToolError(CANNOT_RESCHEDULE);

  const lessonMinutes = minutesBetween(
    lesson.scheduledStart,
    lesson.scheduledEnd,
  );
  const lessonMs =
    Date.parse(lesson.scheduledEnd) - Date.parse(lesson.scheduledStart);
  const askedMs = Date.parse(newEnd) - Date.parse(newStart);
  if (!(askedMs > 0)) throw new ToolError(END_BEFORE_START);
  if (askedMs !== lessonMs) {
    throw new ToolError(
      `The new time must keep the lesson's length of ${lessonMinutes} minutes.`,
    );
  }

  const preview = (targetDate: string) =>
    sessions.withAccessToken(sessionId, (accessToken) =>
      previewLessonReschedule(backend, accessToken, lessonId, { targetDate }),
    );
  // The day the person means is the one in the family's zone, which only the backend knows.
  const writtenDate = newStart.slice(0, 10);
  let day = await preview(writtenDate);
  const familyDate = localDateIn(newStart, day.timezone);
  if (familyDate !== writtenDate) day = await preview(familyDate);

  const slot = (day.slots ?? []).find(
    (offered) =>
      sameInstant(offered.start, newStart) && sameInstant(offered.end, newEnd),
  );
  if (slot === undefined) throw new ToolError(NOT_OFFERED);

  const { confirmationToken, expiresInSeconds } = sessions.createProposal(
    sessionId,
    {
      action: 'reschedule',
      lessonId,
      newStart: slot.start,
      newEnd: slot.end,
      reason,
      currentStart: day.current_start,
      currentEnd: day.current_end,
    },
  );
  // The day preview is in the family's zone, so its zone needs no second read.
  const clock = localClock(day.timezone);
  return {
    status: 'proposed',
    confirmationToken,
    lessonId,
    ...whose(detail),
    timezone: clock.timezone,
    currentStart: day.current_start,
    currentEnd: day.current_end,
    currentWhenLocal: clock.between(day.current_start, day.current_end),
    newStart: slot.start,
    newEnd: slot.end,
    newWhenLocal: clock.between(slot.start, slot.end),
    durationMinutes: lessonMinutes,
    reason,
    expiresInSeconds,
  };
}

// Sends exactly one move. The token is used up before the backend is called, so a repeat can never
// send a second one, and nothing here retries the move.
async function confirm(input: Input, context: ToolContext): Promise<Output> {
  const { backend, sessions } = context;
  const { sessionId, confirmationToken } = input;
  if (confirmationToken === undefined) throw new ToolError(INCOMPLETE);
  const proposal = sessions.takeProposal(
    sessionId,
    confirmationToken,
    'reschedule',
  );

  // The write is sent once. After a 401 only, the session service refreshes the token and sends it
  // once more; after a timeout, a network error, a 5xx or anything else, nothing is sent again.
  const sent = await sessions.sendWrite(sessionId, (accessToken) =>
    rescheduleLesson(backend, accessToken, proposal.lessonId, {
      newStart: proposal.newStart,
      newEnd: proposal.newEnd,
      reason: proposal.reason,
    }),
  );
  // It was sent but the backend may have saved the move before it failed, so the result is unknown.
  if (sent.status === 'unknown') throw new ToolError(UNKNOWN_OUTCOME);

  const unconfirmed: Output = {
    status: 'unconfirmed',
    lessonId: proposal.lessonId,
    message: UNCONFIRMED,
  };
  try {
    const readBack = await sessions.withAccessToken(sessionId, (accessToken) =>
      fetchLesson(backend, accessToken, proposal.lessonId),
    );
    const { scheduledStart, scheduledEnd } = readBack.session;
    if (
      !sameInstant(scheduledStart, proposal.newStart) ||
      !sameInstant(scheduledEnd, proposal.newEnd)
    ) {
      return unconfirmed;
    }
    const clock = await householdClock(context, sessionId);
    return {
      status: 'rescheduled',
      lessonId: proposal.lessonId,
      ...whose(readBack),
      timezone: clock.timezone,
      currentStart: proposal.currentStart,
      currentEnd: proposal.currentEnd,
      currentWhenLocal: clock.between(
        proposal.currentStart,
        proposal.currentEnd,
      ),
      newStart: scheduledStart,
      newEnd: scheduledEnd,
      newWhenLocal: clock.between(scheduledStart, scheduledEnd),
    };
  } catch {
    // The move was accepted, so a failed read-back is not a failed move.
    return unconfirmed;
  }
}

// The learner's full name and the lesson's subjects, when the lesson detail has them.
function whose(detail: LessonDetail): Pick<Output, 'learnerName' | 'subjects'> {
  const learnerName = [detail.learner?.first_name, detail.learner?.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
  const subjects = detail.session.subjects ?? [];
  return {
    ...(learnerName && { learnerName }),
    ...(subjects.length > 0 && { subjects }),
  };
}

export async function sessionRescheduleHandler(
  input: Input,
  context: ToolContext,
): Promise<Output> {
  context.sessions.assertRole(input.sessionId, schedulingRoles);
  return input.step === 'propose'
    ? propose(input, context)
    : confirm(input, context);
}
