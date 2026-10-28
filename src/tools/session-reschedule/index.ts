import { defineTool } from '../define-tool.js';
import { SHOW_LOCAL_TIMES } from '../local-time.js';
import { sessionRescheduleHandler } from './handler.js';
import {
  sessionRescheduleInputSchema,
  sessionRescheduleOutputSchema,
} from './schemas.js';

export const sessionRescheduleTool = defineTool({
  name: 'session_reschedule',
  title: 'Move a lesson to another time (two steps)',
  description: `Moves one tutoring lesson to another offered time, in TWO steps. Step 'propose' (needs lessonId, newStart, newEnd as ISO 8601 with an offset, and a reason of 1 to 500 characters) changes NOTHING: it checks the lesson is scheduled and can be moved, that the new time keeps the same length and is one of the offered times for that day, then returns a confirmationToken that works once for 5 minutes. Show the proposal (lesson, old time, new time, reason) to the parent in plain words and get an explicit yes BEFORE calling step 'confirm' (needs only the confirmationToken); never confirm on your own. Confirm sends exactly one move and is NEVER retried: if it says the result is unknown, do not try again; call session_get to see the lesson's real time first. The id of a tutoring class is always lessonId. The signed-in person comes from the request’s sign-in. ${SHOW_LOCAL_TIMES}`,
  input: sessionRescheduleInputSchema,
  output: sessionRescheduleOutputSchema,
  hints: { readOnly: false, destructive: false, idempotent: false },
  handler: sessionRescheduleHandler,
  // Fixed wording for the move's known 400 replies. The kinds come from matching the backend's
  // error text, which is fragile (see rescheduleErrorPhrases).
  errorMessages: {
    forbidden: 'Not allowed to change this lesson.',
    not_found: 'Lesson not found.',
    invalid_request: 'The request was not accepted.',
    cannot_reschedule:
      'This lesson cannot be rescheduled (its status or timing does not allow it).',
    slot_unavailable: 'That time is not available.',
    outside_availability: "That time is outside the learner's availability.",
  },
});
