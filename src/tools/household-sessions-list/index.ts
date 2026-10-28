import { defineTool } from '../define-tool.js';
import { SHOW_LOCAL_TIMES } from '../local-time.js';
import { householdSessionsListHandler } from './handler.js';
import {
  householdSessionsListInputSchema,
  householdSessionsListOutputSchema,
} from './schemas.js';

export const householdSessionsListTool = defineTool({
  name: 'household_sessions_list',
  title: 'List the household’s lessons',
  description: `Lists the tutoring lessons of every learner in the signed-in person's household: lessonId, learnerId, subjects, start and end (UTC) with whenLocal (the same time ready to read), minutes, status, and whether it can be rescheduled or cancelled. It has no names: use household_learners to turn a learnerId into a child's name. Optional filters: status, startAfter and startBefore (ISO 8601 with an offset), page (from 0) and pageSize (1 to 50, default 20). The id of a tutoring class is always lessonId. The signed-in person comes from the request’s sign-in. Read-only. ${SHOW_LOCAL_TIMES}`,
  input: householdSessionsListInputSchema,
  output: householdSessionsListOutputSchema,
  hints: { readOnly: true, destructive: false },
  handler: householdSessionsListHandler,
  errorMessages: {
    forbidden: 'Not allowed to access this household.',
    not_found: 'Household not found.',
  },
});
