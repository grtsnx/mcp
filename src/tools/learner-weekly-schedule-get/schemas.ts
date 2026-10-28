import { z } from 'zod';

// No householdId here on purpose: the household comes from the session.
export const learnerWeeklyScheduleGetInputSchema = z
  .object({
    sessionId: z.string().min(1).max(256),
    learnerId: z.uuid(),
  })
  .strict();

// No notes, date range or preferred subject: they are free text or detail the model does not need.
export const windowOutputSchema = z
  .object({
    windowId: z.string(),
    dayOfWeek: z.number().int(),
    dayName: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    timezone: z.string().nullable(),
    status: z.string(),
    whenLocal: z.string(),
    extraStartTime: z.string().optional(),
    extraEndTime: z.string().optional(),
  })
  .strict();

export const preferenceOutputSchema = z
  .object({
    subjectPreferenceId: z.string(),
    learnerSubjectId: z.string(),
    subject: z.string(),
    preferredDuration: z.number().int(),
    sessionsPerWeek: z.number().int(),
    status: z.string(),
  })
  .strict();

export const learnerWeeklyScheduleGetOutputSchema = z
  .object({
    learnerId: z.string(),
    windows: z.array(windowOutputSchema),
    subjectPreferences: z.array(preferenceOutputSchema),
  })
  .strict();
