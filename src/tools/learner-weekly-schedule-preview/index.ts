import { defineTool } from '../define-tool.js';
import { SHOW_LOCAL_TIMES } from '../local-time.js';
import { learnerWeeklySchedulePreviewHandler } from './handler.js';
import {
  learnerWeeklySchedulePreviewInputSchema,
  learnerWeeklySchedulePreviewOutputSchema,
} from './schemas.js';

export const learnerWeeklySchedulePreviewTool = defineTool({
  name: 'learner_weekly_schedule_preview',
  title: 'Preview a change to a learner’s weekly windows',
  description: `Shows what WOULD happen to a learner's upcoming lessons if their weekly windows were changed. It only previews and changes nothing: no window and no lesson is saved or moved. Give the COMPLETE new list of windows (1 to 14): each is a range the family offers, with dayOfWeek (0 Sunday to 6 Saturday), startTime and endTime as HH:MM in 24-hour time, an optional IANA timezone, and the windowId from learner_weekly_schedule_get to keep an existing window with all its other settings. A current window you leave out is removed in the preview, and a window without windowId is new. Subjects and how often they are taught are never changed here. Returns how many lessons were scanned and would be affected, and for each its old and new time and the reason. A non-zero cancelCount means lessons would be cancelled, and the parent must be told. Lessons the backend would leave where they are, including ones that would no longer fit the new windows, are not listed, so an empty list does not prove every lesson fits. Needs the learner's id (from household_learners). lessonId in the result is a tutoring class. The signed-in person comes from the request’s sign-in. ${SHOW_LOCAL_TIMES}`,
  input: learnerWeeklySchedulePreviewInputSchema,
  output: learnerWeeklySchedulePreviewOutputSchema,
  hints: { readOnly: true, destructive: false },
  handler: learnerWeeklySchedulePreviewHandler,
  errorMessages: {
    forbidden: 'Not allowed to access this learner.',
    not_found: 'Learner not found.',
    invalid_request: 'The schedule was not accepted.',
  },
});
