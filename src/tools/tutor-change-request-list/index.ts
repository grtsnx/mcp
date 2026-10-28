import { defineTool } from '../define-tool.js';
import { tutorChangeRequestListHandler } from './handler.js';
import {
  tutorChangeRequestListInputSchema,
  tutorChangeRequestListOutputSchema,
} from './schemas.js';

export const tutorChangeRequestListTool = defineTool({
  name: 'tutor_change_request_list',
  title: 'List tutor-change requests',
  description:
    "Lists the tutor-change requests filed for the learners of the signed-in household, newest first: the learner, the tutor's name, the reason, the status (pending until the school's staff decide) and when it was filed. Use it to see whether a request is pending, including after tutor_change_request_create says the result is unknown. The school's staff decide requests; a pending request has not changed the tutor. If the answer is that no household could be found, say so plainly: it is a limit of the school's system for this account, not proof that nothing was filed. The signed-in person comes from the request’s sign-in. Read-only.",
  input: tutorChangeRequestListInputSchema,
  output: tutorChangeRequestListOutputSchema,
  hints: { readOnly: true, destructive: false },
  handler: tutorChangeRequestListHandler,
  errorMessages: {
    forbidden: 'Not allowed to access this household.',
    household_not_found:
      "No household could be found for this account's tutor-change requests.",
  },
});
