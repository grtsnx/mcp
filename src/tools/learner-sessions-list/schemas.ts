import { z } from 'zod';
import { lessonStatuses } from '@/external/mssuize/scheduling-api.js';

// No householdId here on purpose: the household always comes from the session.
// The backend silently ignores a status or a date it cannot read, which would look like "no
// filter", so every value is checked here before a backend call is made.
export const learnerSessionsListInputSchema = z
  .object({
    sessionId: z.string().min(1).max(256),
    learnerId: z.uuid(),
    status: z.enum(lessonStatuses).optional(),
    startAfter: z.iso.datetime({ offset: true }).optional(),
    startBefore: z.iso.datetime({ offset: true }).optional(),
    page: z.number().int().min(0).optional(),
    pageSize: z.number().int().min(1).max(50).default(20),
  })
  .strict();

const lessonOutputSchema = z
  .object({
    lessonId: z.string(),
    tutorName: z.string().nullable(),
    learnerName: z.string().nullable(),
    subjects: z.array(z.string()),
    scheduledStart: z.string(),
    scheduledEnd: z.string(),
    whenLocal: z.string(),
    durationMinutes: z.number().int(),
    status: z.string(),
    canReschedule: z.boolean(),
    canCancel: z.boolean(),
  })
  .strict();

export const learnerSessionsListOutputSchema = z
  .object({
    timezone: z.string(),
    lessons: z.array(lessonOutputSchema),
    totalCount: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  })
  .strict();
