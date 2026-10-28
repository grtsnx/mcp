import type { Tool } from './define-tool.js';
import { householdGetTool } from './household-get/index.js';
import { householdLearnersTool } from './household-learners/index.js';
import { householdMembersTool } from './household-members/index.js';
import { householdSessionsListTool } from './household-sessions-list/index.js';
import { learnerSessionsListTool } from './learner-sessions-list/index.js';
import { learnerWeeklyScheduleGetTool } from './learner-weekly-schedule-get/index.js';
import { learnerWeeklyScheduleUpdateTool } from './learner-weekly-schedule-update/index.js';
import { learnerWeeklySchedulePreviewTool } from './learner-weekly-schedule-preview/index.js';
import { pingTool } from './ping/index.js';
import { sessionCancelTool } from './session-cancel/index.js';
import { sessionGetTool } from './session-get/index.js';
import { sessionMeTool } from './session-me/index.js';
import { sessionRescheduleTool } from './session-reschedule/index.js';
import { sessionRescheduleOptionsWeekTool } from './session-reschedule-options-week/index.js';
import { sessionRescheduleOptionsDayTool } from './session-reschedule-options-day/index.js';
import { tutorChangeRequestCreateTool } from './tutor-change-request-create/index.js';
import { tutorChangeRequestListTool } from './tutor-change-request-list/index.js';

// The only place a tool is registered: add one line here, nothing else needs editing.
export const tools: readonly Tool[] = [
  pingTool,
  sessionMeTool,
  householdGetTool,
  householdLearnersTool,
  householdMembersTool,
  learnerSessionsListTool,
  sessionGetTool,
  sessionRescheduleOptionsDayTool,
  sessionRescheduleOptionsWeekTool,
  householdSessionsListTool,
  sessionRescheduleTool,
  learnerWeeklyScheduleGetTool,
  learnerWeeklySchedulePreviewTool,
  sessionCancelTool,
  learnerWeeklyScheduleUpdateTool,
  tutorChangeRequestCreateTool,
  tutorChangeRequestListTool,
];
