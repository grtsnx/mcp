import { z } from 'zod';

export const sessionGetInputSchema = z
  .object({
    sessionId: z.string().min(1).max(256),
    lessonId: z.uuid(),
  })
  .strict();

const personSchema = z
  .object({
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
  })
  .strict();

// No tutor email, no tutor id, no photo link, no actor id and no event payload.
export const sessionGetOutputSchema = z
  .object({
    timezone: z.string(),
    lesson: z
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
      .strict(),
    tutor: personSchema,
    learner: personSchema,
    recentEvents: z.array(
      z
        .object({
          eventType: z.string(),
          occurredAt: z.string(),
          actorRole: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
