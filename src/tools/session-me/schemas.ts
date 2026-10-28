import { z } from 'zod';

export const sessionMeInputSchema = z
  .object({ sessionId: z.string().min(1).max(256) })
  .strict();

export const sessionMeOutputSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    role: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    status: z.string(),
    householdId: z.string().nullable(),
  })
  .strict();
