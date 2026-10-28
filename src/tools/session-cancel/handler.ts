import type { z } from 'zod';
import {
  fetchLesson,
  cancelLesson,
  minutesBetween,
  schedulingRoles,
} from '@/external/mssuize/scheduling-api.js';
import { ToolError, type ToolContext } from '../define-tool.js';
import { householdClock } from '../local-time.js';
import type {
  sessionCancelInputSchema,
  sessionCancelOutputSchema,
} from './schemas.js';

type Input = z.output<typeof sessionCancelInputSchema>;
type Output = z.input<typeof sessionCancelOutputSchema>;

const NOT_SCHEDULED =
  'This lesson is not scheduled, so it cannot be cancelled.';
const CANNOT_CANCEL = 'This lesson cannot be cancelled.';
const INCOMPLETE = 'The proposal is missing a field.';
const DAY_MS = 24 * 60 * 60 * 1000;

// A fixed sentence: no amount, and no claim that a fee is charged.
const LATE_NOTICE =
  'Cancelling less than 24 hours before the start may incur a late-cancellation fee.';

// Only when the cancel was sent and then timed out, failed on the network or got a 5xx, and the
// lesson could not be read back either.
const UNKNOWN_OUTCOME =
  "The result is unknown: the lesson may or may not be cancelled. Do not try to cancel again. Call session_get to see the lesson's real status before telling the parent anything.";
const NOT_CANCELLED =
  'The cancellation did not go through: the lesson is still scheduled. Tell the parent, and do not try again without asking them.';
const UNCONFIRMED =
  "The backend accepted the cancellation, but the lesson does not show as cancelled yet. Call session_get to check the lesson's real status before telling the parent anything.";

// Nothing is changed here. It checks that the lesson can be cancelled, then remembers the request.
async function propose(input: Input, context: ToolContext): Promise<Output> {
  const { backend, sessions } = context;
  const { sessionId, lessonId, reason } = input;
  if (lessonId === undefined || reason === undefined) {
    throw new ToolError(INCOMPLETE);
  }

  const detail = await sessions.withAccessToken(sessionId, (accessToken) =>
    fetchLesson(backend, accessToken, lessonId),
  );
  const lesson = detail.session;
  if (lesson.status !== 'scheduled') throw new ToolError(NOT_SCHEDULED);
  if (lesson.canCancel !== true) throw new ToolError(CANNOT_CANCEL);

  const { confirmationToken, expiresInSeconds } = sessions.createProposal(
    sessionId,
    { action: 'cancel', lessonId, reason },
  );
  const clock = await householdClock(context, sessionId);
  // A lesson that has already started counts as under 24 hours.
  const late = Date.parse(lesson.scheduledStart) - sessions.nowMs() < DAY_MS;
  return {
    status: 'proposed',
    confirmationToken,
    lessonId,
    timezone: clock.timezone,
    scheduledStart: lesson.scheduledStart,
    scheduledEnd: lesson.scheduledEnd,
    whenLocal: clock.between(lesson.scheduledStart, lesson.scheduledEnd),
    durationMinutes: minutesBetween(lesson.scheduledStart, lesson.scheduledEnd),
    reason,
    expiresInSeconds,
    ...(late ? { lateCancellationNotice: LATE_NOTICE } : {}),
  };
}

// Reads the lesson once. Null when it could not be read.
async function readStatus(
  lessonId: string,
  sessionId: string,
  { backend, sessions }: ToolContext,
): Promise<string | null> {
  try {
    const readBack = await sessions.withAccessToken(sessionId, (accessToken) =>
      fetchLesson(backend, accessToken, lessonId),
    );
    return readBack.session.status;
  } catch {
    return null;
  }
}

// Sends exactly one cancel. The token is used up before the backend is called, so a repeat can
// never send a second one, and nothing here retries the cancel.
async function confirm(input: Input, context: ToolContext): Promise<Output> {
  const { backend, sessions } = context;
  const { sessionId, confirmationToken } = input;
  if (confirmationToken === undefined) throw new ToolError(INCOMPLETE);
  const proposal = sessions.takeProposal(
    sessionId,
    confirmationToken,
    'cancel',
  );

  // After a 401 only, the session service refreshes the token and sends it once more.
  const sent = await sessions.sendWrite(sessionId, (accessToken) =>
    cancelLesson(backend, accessToken, proposal.lessonId, {
      reason: proposal.reason,
    }),
  );
  const status = await readStatus(proposal.lessonId, sessionId, context);

  if (sent.status === 'unknown') {
    // The backend answers 500 for every failure, so only the lesson itself says what happened.
    if (status === 'cancelled') {
      return { status: 'cancelled', lessonId: proposal.lessonId };
    }
    if (status === 'scheduled') throw new ToolError(NOT_CANCELLED);
    throw new ToolError(UNKNOWN_OUTCOME);
  }
  if (status === 'cancelled') {
    return { status: 'cancelled', lessonId: proposal.lessonId };
  }
  // The cancel was accepted, so a failed read-back is not a failed cancel.
  return {
    status: 'unconfirmed',
    lessonId: proposal.lessonId,
    message: UNCONFIRMED,
  };
}

export async function sessionCancelHandler(
  input: Input,
  context: ToolContext,
): Promise<Output> {
  context.sessions.assertRole(input.sessionId, schedulingRoles);
  return input.step === 'propose'
    ? propose(input, context)
    : confirm(input, context);
}
