import { defineTool } from '../define-tool.js';
import { tutorChangeRequestCreateHandler } from './handler.js';
import {
  tutorChangeRequestCreateInputSchema,
  tutorChangeRequestCreateOutputSchema,
} from './schemas.js';

export const tutorChangeRequestCreateTool = defineTool({
  name: 'tutor_change_request_create',
  title: 'Ask the school to change a learner’s tutor (two steps)',
  description:
    "Asks the school's staff to change a learner's tutor, in TWO steps. The request goes to the staff, who decide: it does NOT change the tutor by itself, and the staff are told by Slack and email. You never give a tutor id: the tutor is taken from a lesson. Step 'propose' (needs learnerId, the lessonId of one of that learner's lessons with the tutor in question, and a reason of 1 to 500 characters) changes NOTHING: it checks the lesson belongs to the learner and the learner is in the signed-in household, refuses if a request for that tutor is already pending, and returns the learner's and the tutor's first names with a confirmationToken that works once for 5 minutes. Show the parent who the request is about and the reason, and get an explicit yes BEFORE calling step 'confirm' (needs only the confirmationToken); never confirm on your own. Confirm sends exactly one request and is NEVER retried: if it says the result is unknown, do not try again; call tutor_change_request_list to see whether a pending request exists. The id of a tutoring class is always lessonId. The signed-in person comes from the request’s sign-in.",
  input: tutorChangeRequestCreateInputSchema,
  output: tutorChangeRequestCreateOutputSchema,
  hints: { readOnly: false, destructive: false, idempotent: false },
  handler: tutorChangeRequestCreateHandler,
  errorMessages: {
    forbidden: 'Not allowed to change this learner’s tutor.',
    not_found: 'Lesson not found.',
    invalid_request: 'The request was not accepted.',
    already_pending: 'A request for this tutor is already pending.',
  },
});
