import { z } from 'zod';
import { ianaTimeZoneSchema } from '@/external/mssuize/scheduling-api.js';

export const sessionRescheduleOptionsDayInputSchema = z
  .object({
    sessionId: z.string().min(1).max(256),
    lessonId: z.uuid(),
    targetDate: z.iso.date(),
    timezone: ianaTimeZoneSchema.optional(),
  })
  .strict();

export const sessionRescheduleOptionsDayOutputSchema = z
  .object({
    lessonId: z.string(),
    targetDate: z.string(),
    targetDateLocal: z.string(),
    timezone: z.string(),
    durationMinutes: z.number().int(),
    currentStart: z.string(),
    currentEnd: z.string(),
    currentWhenLocal: z.string(),
    slots: z.array(
      z
        .object({ start: z.string(), end: z.string(), whenLocal: z.string() })
        .strict(),
    ),
    count: z.number().int(),
  })
  .strict();
