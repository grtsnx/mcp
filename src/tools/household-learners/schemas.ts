import { z } from 'zod';
import { learnerStatuses } from '@/external/mssuize/household-api.js';

// No householdId here on purpose: the household always comes from the session.
// The backend answers an unknown status with an empty list, so the value is restricted here.
export const householdLearnersInputSchema = z
  .object({
    sessionId: z.string().min(1).max(256),
    status: z.enum(learnerStatuses).optional(),
  })
  .strict();

const learnerOutputSchema = z
  .object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    gradeLevel: z.string().nullable(),
    actualGradeLevel: z.string().nullable(),
    status: z.string(),
    age: z.number(),
  })
  .strict();

// MCP needs an object at the root, so the array is wrapped.
export const householdLearnersOutputSchema = z
  .object({ learners: z.array(learnerOutputSchema) })
  .strict();
