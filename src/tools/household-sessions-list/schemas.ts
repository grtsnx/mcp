import { z } from 'zod';
import { lessonStatuses } from '@/external/mssuize/scheduling-api.js';

// No householdId here on purpose: the household always comes from the session.
// A made-up status makes the backend answer 500, and a date it cannot read is silently ignored,
// so every filter is checked here before a backend call is made.
export const householdSessionsListInputSchema = z
  .object({
    sessionId: z.string().min(1).max(256),
    status: z.enum(lessonStatuses).optional(),
    startAfter: z.iso.datetime({ offset: true }).optional(),
    startBefore: z.iso.datetime({ offset: true }).optional(),
    page: z.number().int().min(0).optional(),
    pageSize: z.number().int().min(1).max(50).default(20),
  })
  .strict();

// No tutor or learner names: the backend does not send them on this route.
const lessonOutputSchema = z
  .object({
    lessonId: z.string(),
    learnerId: z.string(),
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

export const householdSessionsListOutputSchema = z
  .object({
    timezone: z.string(),
    lessons: z.array(lessonOutputSchema),
    totalCount: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  })
  .strict();
