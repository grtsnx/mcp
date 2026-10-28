import { z } from 'zod';

// No householdId here on purpose: the household always comes from the session.
export const householdGetInputSchema = z
  .object({ sessionId: z.string().min(1).max(256) })
  .strict();

export const householdGetOutputSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    timezone: z.string(),
    currentLearnerId: z.string().nullable(),
    recordingConsent: z.boolean(),
  })
  .strict();
