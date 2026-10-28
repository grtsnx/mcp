import { z } from 'zod';
import { twoStepRefinement } from '../define-tool.js';
import {
  preferenceOutputSchema,
  windowOutputSchema,
} from '../learner-weekly-schedule-get/schemas.js';
import {
  checkWindows,
  previewEntryOutputSchema,
  windowsFieldSchema,
} from '../learner-weekly-schedule-preview/schemas.js';

const PROPOSE_FIELDS = ['learnerId', 'windows', 'reason'];

// MCP needs one plain object at the root, so both steps share this object and a refinement decides
// which fields each step needs. The windows are the same as in learner_weekly_schedule_preview;
// there is still no subjectPreferences, status, notes or date field, and no householdId.
// `reason` is kept with the proposal for the record; the save itself carries only the schedule.
export const learnerWeeklyScheduleUpdateInputSchema = z
  .object({
    step: z.enum(['propose', 'confirm']),
    sessionId: z.string().min(1).max(256),
    learnerId: z.uuid().optional(),
    windows: windowsFieldSchema.optional(),
    reason: z.string().trim().min(1).max(500).optional(),
    confirmationToken: z.string().min(1).max(256).optional(),
    parentAcknowledgesLessonsMayBeChanged: z.literal(true).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    twoStepRefinement(PROPOSE_FIELDS)(input, context);
    if (input.windows !== undefined) checkWindows(input.windows, context);
    const field = 'parentAcknowledgesLessonsMayBeChanged';
    if (input.step === 'propose' && input[field] !== undefined) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: `${field} is only for step confirm`,
      });
    }
    if (input.step === 'confirm' && input[field] !== true) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: `${field} must be true when step is confirm: the parent must have been told lessons may be moved or cancelled`,
      });
    }
  });

// A window of the proposal may be new, so it can have no id yet.
const windowViewSchema = windowOutputSchema.partial({ windowId: true });

// One flat object for all three outcomes; `status` says which fields are present.
export const learnerWeeklyScheduleUpdateOutputSchema = z
  .object({
    status: z.enum(['proposed', 'updated', 'unconfirmed']),
    learnerId: z.string(),
    confirmationToken: z.string().optional(),
    timezone: z.string().optional(),
    currentWindows: z.array(windowViewSchema).optional(),
    newWindows: z.array(windowViewSchema).optional(),
    affectedLessons: z.array(previewEntryOutputSchema).optional(),
    previewIsIncomplete: z.boolean().optional(),
    warning: z.string().optional(),
    expiresInSeconds: z.number().int().optional(),
    windows: z.array(windowViewSchema).optional(),
    // The windows before this save, so a mistake can be put back.
    previousWindows: z.array(windowViewSchema).optional(),
    subjectPreferences: z.array(preferenceOutputSchema).optional(),
    message: z.string().optional(),
  })
  .strict();
