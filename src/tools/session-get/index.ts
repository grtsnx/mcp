import { defineTool } from '../define-tool.js';
import { SHOW_LOCAL_TIMES } from '../local-time.js';
import { sessionGetHandler } from './handler.js';
import { sessionGetInputSchema, sessionGetOutputSchema } from './schemas.js';

export const sessionGetTool = defineTool({
  name: 'session_get',
  title: 'Get a lesson',
  description: `Returns one tutoring lesson: its id, learner id, subjects, start and end (UTC) with whenLocal (the same time ready to read), minutes, status, whether it can be rescheduled or cancelled, the tutor and learner first and last names, and up to the 10 most recent events (type, time, who acted). The id of a tutoring class is always lessonId. The signed-in person comes from the request’s sign-in. Read-only. ${SHOW_LOCAL_TIMES}`,
  input: sessionGetInputSchema,
  output: sessionGetOutputSchema,
  hints: { readOnly: true, destructive: false },
  handler: sessionGetHandler,
  errorMessages: {
    forbidden: 'Not allowed to access this learner or lesson.',
    not_found: 'Lesson not found.',
  },
});
