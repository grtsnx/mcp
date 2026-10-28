import { defineTool } from '../define-tool.js';
import { SHOW_LOCAL_TIMES } from '../local-time.js';
import { learnerSessionsListHandler } from './handler.js';
import {
  learnerSessionsListInputSchema,
  learnerSessionsListOutputSchema,
} from './schemas.js';

export const learnerSessionsListTool = defineTool({
  name: 'learner_sessions_list',
  title: 'List a learner’s lessons',
  description: `Lists a learner's tutoring lessons in the signed-in person's household: lessonId, tutor and learner names, subjects, start and end (UTC) with whenLocal (the same time ready to read), minutes, status, and whether it can be rescheduled or cancelled. Optional filters: status, startAfter and startBefore (ISO 8601 with an offset), page (from 0) and pageSize (1 to 50, default 20). The id of a tutoring class is always lessonId. The signed-in person comes from the request’s sign-in. Read-only. ${SHOW_LOCAL_TIMES}`,
  input: learnerSessionsListInputSchema,
  output: learnerSessionsListOutputSchema,
  hints: { readOnly: true, destructive: false },
  handler: learnerSessionsListHandler,
  errorMessages: {
    forbidden: 'Not allowed to access this learner or lesson.',
    not_found: 'Learner not found.',
  },
});
