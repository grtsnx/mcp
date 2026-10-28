import { defineTool } from '../define-tool.js';
import { SHOW_LOCAL_TIMES } from '../local-time.js';
import { sessionCancelHandler } from './handler.js';
import {
  sessionCancelInputSchema,
  sessionCancelOutputSchema,
} from './schemas.js';

export const sessionCancelTool = defineTool({
  name: 'session_cancel',
  title: 'Cancel a lesson (two steps)',
  description: `Cancels one tutoring lesson, in TWO steps. Step 'propose' (needs lessonId and a reason of 1 to 500 characters) changes NOTHING: it checks the lesson is scheduled and can be cancelled, then returns a confirmationToken that works once for 5 minutes, and a lateCancellationNotice when the lesson starts in under 24 hours. Cancelling cannot be undone with these tools, and the tutor and the household are notified. Show the proposal (lesson, time, reason, and any notice) to the parent in plain words and get an explicit yes BEFORE calling step 'confirm' (needs only the confirmationToken); never confirm on your own. Confirm sends exactly one cancellation and is NEVER retried: if it says the result is unknown, do not try again; call session_get to see the lesson's real status first. The id of a tutoring class is always lessonId. The signed-in person comes from the request’s sign-in. ${SHOW_LOCAL_TIMES}`,
  input: sessionCancelInputSchema,
  output: sessionCancelOutputSchema,
  hints: { readOnly: false, destructive: true, idempotent: false },
  handler: sessionCancelHandler,
  errorMessages: {
    forbidden: 'Not allowed to change this lesson.',
    not_found: 'Lesson not found.',
  },
});
