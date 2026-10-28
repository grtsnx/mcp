import { defineTool } from '../define-tool.js';
import { SHOW_LOCAL_TIMES } from '../local-time.js';
import { learnerWeeklyScheduleUpdateHandler } from './handler.js';
import {
  learnerWeeklyScheduleUpdateInputSchema,
  learnerWeeklyScheduleUpdateOutputSchema,
} from './schemas.js';

export const learnerWeeklyScheduleUpdateTool = defineTool({
  name: 'learner_weekly_schedule_update',
  title: 'Change a learner’s weekly windows (two steps)',
  description: `Saves a new set of weekly windows for a learner, in TWO steps. A window is a RANGE the family offers (for example 16:00 to 18:00 on Tuesday), not a lesson time. Step 'propose' (needs learnerId, the COMPLETE new list of windows exactly as for learner_weekly_schedule_preview, and a reason of 1 to 500 characters) changes NOTHING: it shows the learner's current windows, the new windows, and the lessons the backend's preview says would be affected, then returns a confirmationToken that works once for 5 minutes. The preview is INCOMPLETE: it may not list every lesson that could be moved or cancelled, and cancelled lessons cannot be restored with these tools, so tell the parent this in plain words. Show the WHOLE proposal (current windows, new windows, affected lessons and the warning) to the parent and get an explicit yes BEFORE calling step 'confirm' (needs only the confirmationToken and parentAcknowledgesLessonsMayBeChanged: true, which you may set only after the parent has said yes knowing lessons may be moved or cancelled); never confirm on your own. Confirm checks again that the schedule and the preview are unchanged and sends nothing if they are not; otherwise it sends exactly one save and is NEVER retried: if it says the result is unknown, do not try again; call learner_weekly_schedule_get first, then learner_sessions_list. The backend adjusts upcoming lessons separately after a save, so check them with learner_sessions_list. Subjects and how often they are taught are never changed here. Needs the learner's id (from household_learners). The signed-in person comes from the request’s sign-in. ${SHOW_LOCAL_TIMES}`,
  input: learnerWeeklyScheduleUpdateInputSchema,
  output: learnerWeeklyScheduleUpdateOutputSchema,
  hints: { readOnly: false, destructive: true, idempotent: false },
  handler: learnerWeeklyScheduleUpdateHandler,
  errorMessages: {
    forbidden: 'Not allowed to change this learner’s schedule.',
    not_found: 'Learner not found.',
    invalid_request: 'The schedule was not accepted.',
  },
});
