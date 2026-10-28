import { defineTool } from '../define-tool.js';
import { SHOW_LOCAL_TIMES } from '../local-time.js';
import { sessionRescheduleOptionsWeekHandler } from './handler.js';
import {
  sessionRescheduleOptionsWeekInputSchema,
  sessionRescheduleOptionsWeekOutputSchema,
} from './schemas.js';

export const sessionRescheduleOptionsWeekTool = defineTool({
  name: 'session_reschedule_options_week',
  title: 'Free times for moving a lesson this week',
  description: `Previews when a lesson could move to over the next 6 days (today is left out): for each day, the free time slots, plus the lesson's current time and length. It only previews and does not move, book or change anything. Without a timezone the family's own time zone is used; give an IANA name such as America/New_York to see another. The id of a tutoring class is always lessonId. The signed-in person comes from the request’s sign-in. ${SHOW_LOCAL_TIMES}`,
  input: sessionRescheduleOptionsWeekInputSchema,
  output: sessionRescheduleOptionsWeekOutputSchema,
  hints: { readOnly: true, destructive: false },
  handler: sessionRescheduleOptionsWeekHandler,
  errorMessages: {
    forbidden: 'Not allowed to access this learner or lesson.',
    not_found: 'Lesson not found.',
    cannot_reschedule:
      'This lesson cannot be rescheduled (its status or timing does not allow it).',
    invalid_request: 'The request was not accepted.',
  },
});
