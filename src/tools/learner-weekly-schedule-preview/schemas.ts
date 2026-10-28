import { z } from 'zod';
import { ianaTimeZoneSchema } from '@/external/mssuize/scheduling-api.js';

// 24-hour HH:MM only. The backend also accepts HH:MM:SS, but a window is a range of minutes.
const clockSchema = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d$/,
    'Use HH:MM in 24-hour time, for example 16:00',
  );

// There is no status, notes, date range or extra range here on purpose: this tool can only move
// the windows, never change what a window means. A kept window carries its other settings over.
export const windowInputSchema = z
  .object({
    windowId: z.uuid().optional(),
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: clockSchema,
    endTime: clockSchema,
    timezone: ianaTimeZoneSchema.optional(),
  })
  .strict();

// The rules for the whole list of windows, shared with learner_weekly_schedule_update so the two
// can never disagree: an end after the start, no duplicate day and times, no repeated windowId.
export function checkWindows(
  windows: readonly z.output<typeof windowInputSchema>[],
  context: z.core.$RefinementCtx,
): void {
  const slots = new Set<string>();
  const ids = new Set<string>();
  windows.forEach((window, index) => {
    if (window.endTime <= window.startTime) {
      context.addIssue({
        code: 'custom',
        path: ['windows', index, 'endTime'],
        message: 'endTime must be after startTime',
      });
    }
    // The backend rejects two windows with the same day and times, whatever their time zone.
    const slot = `${window.dayOfWeek}|${window.startTime}|${window.endTime}`;
    if (slots.has(slot)) {
      context.addIssue({
        code: 'custom',
        path: ['windows', index],
        message:
          'duplicate window: the same day, startTime and endTime appear twice',
      });
    }
    slots.add(slot);
    if (window.windowId !== undefined) {
      const id = window.windowId.toLowerCase();
      if (ids.has(id)) {
        context.addIssue({
          code: 'custom',
          path: ['windows', index, 'windowId'],
          message: 'the same windowId appears twice',
        });
      }
      ids.add(id);
    }
  });
}

export const windowsFieldSchema = z.array(windowInputSchema).min(1).max(14);

// No subjectPreferences here on purpose: the tool sends the learner's current ones unchanged, so
// the model can never change a subject or how often it is taught.
export const learnerWeeklySchedulePreviewInputSchema = z
  .object({
    sessionId: z.string().min(1).max(256),
    learnerId: z.uuid(),
    windows: windowsFieldSchema,
  })
  .strict()
  .superRefine((input, context) => checkWindows(input.windows, context));

// No tutor id or name and no learner name: only the lesson, its old and new time, and why.
export const previewEntryOutputSchema = z
  .object({
    lessonId: z.string(),
    subjects: z.array(z.string()),
    oldStart: z.string(),
    oldEnd: z.string(),
    oldWhenLocal: z.string(),
    action: z.string(),
    newStart: z.string().optional(),
    newEnd: z.string().optional(),
    newWhenLocal: z.string().optional(),
    reason: z.string().nullable(),
  })
  .strict();

export const learnerWeeklySchedulePreviewOutputSchema = z
  .object({
    learnerId: z.string(),
    timezone: z.string(),
    totalScanned: z.number().int(),
    affectedCount: z.number().int(),
    rescheduleCount: z.number().int(),
    cancelCount: z.number().int(),
    entries: z.array(previewEntryOutputSchema),
  })
  .strict();
