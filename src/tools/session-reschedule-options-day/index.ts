import { defineTool } from '../define-tool.js';
import { SHOW_LOCAL_TIMES } from '../local-time.js';
import { sessionRescheduleOptionsDayHandler } from './handler.js';
import {
  sessionRescheduleOptionsDayInputSchema,
  sessionRescheduleOptionsDayOutputSchema,
} from './schemas.js';

export const sessionRescheduleOptionsDayTool = defineTool({
  name: 'session_reschedule_options_day',
  title: 'Free times for moving a lesson on one day',
  description: `Previews when a lesson could move to on one day: the free time slots on targetDate (YYYY-MM-DD) with the lesson's current time and length. It only previews and does not move, book or change anything. Without a timezone the family's own time zone is used; give an IANA name such as America/New_York to see another. The id of a tutoring class is always lessonId. The signed-in person comes from the request’s sign-in. ${SHOW_LOCAL_TIMES}`,
  input: sessionRescheduleOptionsDayInputSchema,
  output: sessionRescheduleOptionsDayOutputSchema,
  hints: { readOnly: true, destructive: false },
  handler: sessionRescheduleOptionsDayHandler,
  errorMessages: {
    forbidden: 'Not allowed to access this learner or lesson.',
    not_found: 'Lesson not found.',
    invalid_request: 'That date is not valid.',
  },
});
