import { z } from 'zod';

// No householdId and no paging here on purpose: the household comes from the session, and the
// backend's route for a parent has no paging or filter parameters.
export const tutorChangeRequestListInputSchema = z
  .object({
    sessionId: z.string().min(1).max(256),
  })
  .strict();

// Only these fields. The tutors' ids, the staff's names and notes, the household id and whether
// the parent was told are dropped. The backend's parent list does not send a learner name, a
// review time or a new tutor, so those are null unless a later version sends them.
const requestOutputSchema = z
  .object({
    requestId: z.string(),
    learnerId: z.string(),
    learnerName: z.string().nullable(),
    currentTutorName: z.string().nullable(),
    status: z.string(),
    reason: z.string().nullable(),
    createdAt: z.string(),
    reviewedAt: z.string().nullable(),
    newTutorName: z.string().nullable(),
  })
  .strict();

export const tutorChangeRequestListOutputSchema = z
  .object({
    requests: z.array(requestOutputSchema),
    total: z.number().int(),
    page: z.number().int().optional(),
    pageSize: z.number().int().optional(),
  })
  .strict();
