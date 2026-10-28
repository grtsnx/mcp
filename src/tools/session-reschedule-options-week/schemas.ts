import { z } from 'zod';
import { ianaTimeZoneSchema } from '@/external/mssuize/scheduling-api.js';

export const sessionRescheduleOptionsWeekInputSchema = z
  .object({
    sessionId: z.string().min(1).max(256),
    lessonId: z.uuid(),
    timezone: ianaTimeZoneSchema.optional(),
  })
  .strict();

const daySchema = z
  .object({
    date: z.string(),
    dateLocal: z.string(),
    slots: z.array(
      z
        .object({ start: z.string(), end: z.string(), whenLocal: z.string() })
        .strict(),
    ),
    count: z.number().int(),
  })
  .strict();

// No tutor id or name and no learner name: only the lesson's own id, length and free times.
export const sessionRescheduleOptionsWeekOutputSchema = z
  .object({
    lessonId: z.string(),
    timezone: z.string(),
    durationMinutes: z.number().int(),
    currentStart: z.string(),
    currentEnd: z.string(),
    currentWhenLocal: z.string(),
    days: z.array(daySchema),
    totalSlots: z.number().int(),
  })
  .strict();
