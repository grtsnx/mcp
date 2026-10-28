import { defineTool } from '../define-tool.js';
import { SHOW_LOCAL_TIMES } from '../local-time.js';
import { learnerWeeklyScheduleGetHandler } from './handler.js';
import {
  learnerWeeklyScheduleGetInputSchema,
  learnerWeeklyScheduleGetOutputSchema,
} from './schemas.js';

export const learnerWeeklyScheduleGetTool = defineTool({
  name: 'learner_weekly_schedule_get',
  title: 'Get a learner’s weekly schedule',
  description: `Returns a learner's weekly schedule: the time windows the family offers and the subjects with how long and how often each is wanted. A window is a RANGE the family is available in (for example 16:00 to 18:00 on Tuesday), not a lesson time: the backend places lessons inside these ranges. dayOfWeek 0 is Sunday, 1 Monday, up to 6 Saturday (dayName says it in words), and times are in the window's own timezone. Needs the learner's id (from household_learners). The signed-in person comes from the request’s sign-in. Read-only. ${SHOW_LOCAL_TIMES}`,
  input: learnerWeeklyScheduleGetInputSchema,
  output: learnerWeeklyScheduleGetOutputSchema,
  hints: { readOnly: true, destructive: false },
  handler: learnerWeeklyScheduleGetHandler,
  errorMessages: {
    forbidden: 'Not allowed to access this learner.',
    not_found: 'Learner not found.',
  },
});
